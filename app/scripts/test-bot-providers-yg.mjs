// Synthetic identities, fake resources directory and mocked provider endpoints only.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

globalThis.botProviderShell = { openExternal: async (url) => { globalThis.lastBotLoginUrl = url } }
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'electron') return { url: 'data:text/javascript,export const shell=globalThis.botProviderShell', shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(url)) return { url: url.href, shortCircuit: true }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }) }
    return next(url, context)
  }
})

const { createYoutubeBot, createGoodgameBot } = await import('../src/main/core/botproviders-yg.ts')
const { YoutubeConnector } = await import('../src/main/core/youtube.ts')
const { botSecrets } = await import('../src/main/core/botproviders-tkv.ts')
const realFetch = globalThis.fetch
const realWebSocket = globalThis.WebSocket
const values = new Map()
const secrets = { available: () => true, get: (key) => values.get(key) ?? null, has: (key) => values.has(key), set: (key, value) => value === null ? values.delete(key) : values.set(key, value) }
let primaryChanged = 0
const hub = Object.assign(new EventEmitter(), { register() { primaryChanged++ }, setStatus() { primaryChanged++ }, log() { primaryChanged++ } })
const settings = { get: () => ({ youtube: { customClientId: 'synthetic.apps.googleusercontent.com' }, goodgame: { channel: 'primary-channel' } }) }
let chatId = 'primary-live-chat'
let ggChannel = '123'
const deps = { hub, secrets, settings, resourcesDir: join(tmpdir(), 'crossember-synthetic-resources-do-not-create'), youtube: { activeChatId: () => chatId }, goodgame: { activeChannelId: () => ggChannel } }
const profile = (id, platform) => ({ id, platform, name: id, excludeAnalytics: true, excludePoints: true, hideChat: false })
const ytTokens = (name, expiresAt = Date.now() + 3600_000) => ({ access: `synthetic-access-${name}`, refresh: `synthetic-refresh-${name}`, expiresAt, channelId: `identity-${name}`, channelName: name })
const ggTokens = { access: 'synthetic-gg-access', refresh: 'synthetic-gg-refresh', expiresAt: Date.now() + 3600_000, name: 'gg-sender', userId: '44', channel: '', scope: [] }
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const calls = []
let fetchOverride = null
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options })
  if (fetchOverride) { const r = fetchOverride(String(url), options); if (r) return r }
  if (String(url).includes('goodgame.ru/api/4/user')) return response({ id: '44', nickname: 'gg-sender', token: 'synthetic-chat-token' })
  if (String(url).includes('oauth2.googleapis.com/token')) return response({ access_token: 'new-synthetic-access', refresh_token: 'new-synthetic-refresh', expires_in: 3600 })
  if (String(url).includes('/youtube/v3/channels?')) return response({ items: [{ id: 'new-synthetic-identity', snippet: { title: 'new-sender' } }] })
  if (String(url).includes('/liveChat/messages?')) return response({ id: 'synthetic-message' })
  if (String(url).includes('revoke')) return response({})
  throw new Error('Unexpected synthetic request')
}

const adapters = []
try {
  values.set('youtube.tokens', JSON.stringify(ytTokens('primary')))
  values.set('botAccounts.yt-one.youtube.tokens', JSON.stringify(ytTokens('one')))
  values.set('botAccounts.yt-two.youtube.tokens', JSON.stringify(ytTokens('two')))
  const one = createYoutubeBot(profile('yt-one', 'youtube'), () => {}, deps)
  const two = createYoutubeBot(profile('yt-two', 'youtube'), () => {}, deps)
  adapters.push(one, two)
  assert.equal(one.state().account, 'one')
  assert.equal(two.state().account, 'two')
  await one.send('Message one')
  await two.send('Message two')
  const messages = calls.filter((x) => x.url.includes('/liveChat/messages?'))
  assert.equal(messages.length, 2)
  assert.equal(messages[0].options.headers.Authorization, 'Bearer synthetic-access-one')
  assert.equal(messages[1].options.headers.Authorization, 'Bearer synthetic-access-two')
  assert.equal(JSON.parse(messages[0].options.body).snippet.liveChatId, chatId)
  assert.equal(JSON.parse(values.get('youtube.tokens')).channelName, 'primary')
  assert.equal(primaryChanged, 0, 'auxiliary auth must not overwrite primary status')
  assert.ok(!calls.some((x) => x.url.includes('liveBroadcasts')), 'auxiliary identities do not search or read streams')
  chatId = null
  await assert.rejects(one.send('No destination'), /активного чата/)
  chatId = 'primary-live-chat'

  // Delete/logout while refresh is pending cannot restore encrypted credentials or send afterwards.
  values.set('botAccounts.yt-race.youtube.tokens', JSON.stringify(ytTokens('race', 1)))
  const race = createYoutubeBot(profile('yt-race', 'youtube'), () => {}, deps)
  adapters.push(race)
  let release
  fetchOverride = (url) => url.includes('oauth2.googleapis.com/token') ? new Promise((resolve) => { release = resolve }) : null
  const pendingSend = race.send('Must not send')
  await new Promise((resolve) => setImmediate(resolve))
  await race.logout()
  release(response({ access_token: 'late-synthetic-access', expires_in: 3600 }))
  await assert.rejects(pendingSend, /изменился/)
  assert.equal(values.has('botAccounts.yt-race.youtube.tokens'), false)
  fetchOverride = null

  // A successful loopback login saves a separate identity and does not restart a reader.
  const loginSecrets = botSecrets(secrets, 'yt-login')
  const isolatedHub = Object.assign(new EventEmitter(), { register() {}, setStatus() {}, log() {} })
  const login = new YoutubeConnector(isolatedHub, settings, loginSecrets, deps.resourcesDir, { authOnly: true })
  let readerStarted = 0
  login.restart = async () => { readerStarted++ }
  await login.login()
  const authUrl = new URL(globalThis.lastBotLoginUrl)
  const callback = new URL(authUrl.searchParams.get('redirect_uri'))
  callback.searchParams.set('state', authUrl.searchParams.get('state'))
  callback.searchParams.set('code', 'synthetic-code')
  const ok = await realFetch(callback)
  assert.equal(ok.status, 200)
  assert.equal(login.state().account.name, 'new-sender')
  assert.equal(readerStarted, 0)
  assert.ok(values.has('botAccounts.yt-login.youtube.tokens'))
  login.cancelLogin()

  // Cancellation during account lookup must not save the late authorization result.
  const cancelled = new YoutubeConnector(isolatedHub, settings, botSecrets(secrets, 'yt-cancelled'), deps.resourcesDir, { authOnly: true })
  await cancelled.login()
  const secondAuth = new URL(globalThis.lastBotLoginUrl)
  const secondCallback = new URL(secondAuth.searchParams.get('redirect_uri'))
  secondCallback.searchParams.set('state', secondAuth.searchParams.get('state'))
  secondCallback.searchParams.set('code', 'synthetic-code')
  let finishLookup
  fetchOverride = (url) => url.includes('/youtube/v3/channels?') ? new Promise((resolve) => { finishLookup = resolve }) : null
  const callbackResponse = realFetch(secondCallback)
  while (!finishLookup) await new Promise((resolve) => setImmediate(resolve))
  cancelled.cancelLogin()
  finishLookup(response({ items: [{ id: 'late-account', snippet: { title: 'late-name' } }] }))
  assert.equal((await callbackResponse).status, 500)
  assert.equal(values.has('botAccounts.yt-cancelled.youtube.tokens'), false)
  fetchOverride = null

  const sockets = []
  let socketMode = 'normal'
  class FakeSocket extends EventTarget {
    constructor() {
      super(); sockets.push(this); this.sent = []; this.closed = false
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'welcome' }) })))
    }
    send(raw) {
      const m = JSON.parse(raw); this.sent.push(m)
      if (socketMode === 'waiting') return
      const emit = (type, data) => queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type, data }) })))
      if (m.type === 'auth' && socketMode !== 'reversed') emit('success_auth', { user_id: '44' })
      if (m.type === 'join') {
        emit('success_join', { channel_id: m.data.channel_id })
        if (socketMode === 'reversed') emit('success_auth', { user_id: '44' })
      }
      if (m.type === 'send_message') {
        if (socketMode === 'error') emit('error', { errorMsg: 'synthetic rejection' })
        else emit('message', { ...m.data, user_id: '44', text: m.data.text.replace(/&/g, '&amp;').replace(/</g, '&lt;') })
      }
    }
    close() { this.closed = true }
  }
  globalThis.WebSocket = FakeSocket
  values.set('botAccounts.gg-one.goodgame.tokens', JSON.stringify(ggTokens))
  const gg = createGoodgameBot(profile('gg-one', 'goodgame'), () => {}, deps)
  adapters.push(gg)
  assert.equal(gg.state().account, 'gg-sender')
  await gg.send('Message <one> & two')
  assert.equal(sockets.at(-1).sent.find((m) => m.type === 'send_message').data.channel_id, '123')
  assert.equal(sockets.at(-1).closed, true)
  assert.equal(primaryChanged, 0)
  socketMode = 'reversed'
  await gg.send('Reversed join/auth order')
  assert.equal(sockets.at(-1).sent.filter((m) => m.type === 'send_message').length, 1)
  socketMode = 'error'
  await assert.rejects(gg.send('Rejected'), /отклонил/)
  socketMode = 'waiting'
  const waiting = gg.send('Cancel me')
  await new Promise((resolve) => setImmediate(resolve))
  gg.cancel()
  await assert.rejects(waiting, /отменена/)
  assert.equal(sockets.at(-1).closed, true)
  socketMode = 'normal'
  ggChannel = null
  await assert.rejects(gg.send('No primary channel'), /основной канал/)
  one.dispose()
  await assert.rejects(one.send('Disposed'), /удалён/)
  console.log('YouTube/GoodGame bots: isolated identities, primary destinations, auth-only login, cancellation/refresh races and socket cleanup passed')
} finally {
  for (const adapter of adapters) adapter.dispose()
  globalThis.fetch = realFetch
  globalThis.WebSocket = realWebSocket
}

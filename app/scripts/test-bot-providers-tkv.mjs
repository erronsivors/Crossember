// Synthetic identities and mocked HTTP only. No database, real OAuth app file or personal configuration.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
const electron = 'data:text/javascript,export const shell={openExternal:async()=>{}};'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'electron') return { url: electron, shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
      let url = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(url)) return { url: url.href, shortCircuit: true }
      url = new URL(`${specifier}/index.ts`, context.parentURL)
      if (existsSync(url)) return { url: url.href, shortCircuit: true }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }) }
    return next(url, context)
  }
})
const { botSecrets, createTwitchBot, createKickBot, createVkBot } = await import('../src/main/core/botproviders-tkv.ts')
const { TwitchAuth } = await import('../src/main/core/twitch/auth.ts')
const { TwitchConnector } = await import('../src/main/core/twitch/index.ts')
const { KickAuth } = await import('../src/main/core/kickauth.ts')
const { VkAuth } = await import('../src/main/core/vkauth.ts')
const store = new Map()
const secrets = { available: () => true, get: (key) => store.get(key) ?? null, has: (key) => store.has(key), set: (key, value) => { if (value == null) store.delete(key); else store.set(key, value) } }
const hub = { log() {} }
const profile = (id, platform) => ({ id, platform, name: `Profile ${id}`, excludeAnalytics: true, excludePoints: true, hideChat: false })
const token = (name, scopes = []) => ({ access: `synthetic-${name}`, refresh: `synthetic-refresh-${name}`, expiresAt: Date.now() + 1_000_000, name, userId: '222', channel: name, scope: scopes })
const authToken = (name) => ({ access: `synthetic-${name}`, refresh: `synthetic-refresh-${name}`, expiresAt: Date.now() + 1_000_000, scopes: ['user:write:chat'], account: { id: name, login: name, name } })
const a = botSecrets(secrets, 'A')
const b = botSecrets(secrets, 'B')
a.set('twitch.bot.tokens', 'first')
b.set('twitch.bot.tokens', 'second')
assert.equal(a.get('twitch.bot.tokens'), 'first')
assert.equal(b.get('twitch.bot.tokens'), 'second')
assert.equal(secrets.get('twitch.bot.tokens'), null)
secrets.set('kick.customClient', JSON.stringify({ clientId: 'synthetic-app', clientSecret: 'synthetic-app-secret' }))
secrets.set('vk.customClient', JSON.stringify({ clientId: 'synthetic-app' }))
assert.equal(a.get('kick.customClient'), secrets.get('kick.customClient'))
assert.throws(() => a.set('kick.customClient', 'no'), /основном подключении/)
a.dispose()
a.set('twitch.bot.tokens', 'late')
assert.equal(store.get('botAccounts.A.twitch.bot.tokens'), 'first', 'disposed identity cannot persist a late token')

const primary = Object.create(TwitchConnector.prototype)
primary.auth = { account: () => ({ id: 'primary-channel', name: 'Streamer' }) }
primary.clientId = () => 'synthetic-app'
const cfg = { twitch: { customClientId: '' }, kick: { channel: 'streamer' }, vk: { channel: 'streamer' } }
const deps = { hub, secrets, settings: { get: () => cfg }, resourcesDir: fileURLToPath(new URL('./__missing_synthetic_resources__', import.meta.url)), twitch: primary }
const originalFetch = globalThis.fetch
const calls = []
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init })
  if (String(url).includes('/public/v1/channels?')) return Response.json({ data: [{ slug: 'streamer', broadcaster_user_id: 111 }] })
  if (String(url).includes('/public/v1/chat')) return Response.json({ data: { is_sent: true } })
  if (String(url).includes('/v1/channel?')) return Response.json({ data: { stream: { id: 'primary-stream' } } })
  if (String(url).includes('/v1/chat/message/send?')) return Response.json({ data: {} })
  if (String(url).includes('/helix/chat/messages')) return Response.json({ data: [{ is_sent: true }] })
  if (String(url).includes('/revoke')) return Response.json({})
  throw Error('Unexpected synthetic endpoint')
}
try {
  for (const id of ['one', 'two']) {
    botSecrets(secrets, id).set('twitch.bot.tokens', JSON.stringify(authToken(id)))
    const account = createTwitchBot(profile(id, 'twitch'), () => {}, deps)
    assert.equal(account.state().account, id)
    await account.send('hello')
    const request = calls.at(-1)
    const body = JSON.parse(request.init.body)
    assert.equal(body.broadcaster_id, 'primary-channel')
    assert.equal(body.sender_id, id)
    assert.equal(request.init.headers.Authorization, `Bearer synthetic-${id}`)
    account.dispose()
    await assert.rejects(account.send('late'), /удалён/)
  }
  const kickSecrets = botSecrets(secrets, 'kick-one')
  kickSecrets.set('kick.tokens', JSON.stringify(token('bot-channel', ['user:read', 'channel:read', 'chat:write'])))
  const kick = createKickBot(profile('kick-one', 'kick'), () => {}, deps)
  assert.equal(kick.state().account, 'bot-channel')
  await kick.send('hello', 'kick-12345678-abcd-abcd-abcd-123456789abc')
  const kickRequest = calls.at(-1)
  const kickBody = JSON.parse(kickRequest.init.body)
  assert.equal(kickBody.type, 'user')
  assert.equal(kickBody.broadcaster_user_id, 111, 'target is streamer, never bot user ID 222')
  assert.equal(kickBody.reply_to_message_id, '12345678-abcd-abcd-abcd-123456789abc')
  const guardedKick = new KickAuth(hub, kickSecrets, deps.resourcesDir)
  await assert.rejects(guardedKick.sendChat('wrong', undefined, 'streamer'), /Подключениях/)
  kick.dispose()

  const vkSecrets = botSecrets(secrets, 'vk-one')
  vkSecrets.set('vk.tokens', JSON.stringify(token('bot-channel', ['chat:message:send'])))
  const vk = createVkBot(profile('vk-one', 'vk'), () => {}, deps)
  await vk.send('hello')
  const vkRequest = calls.at(-1)
  assert.ok(vkRequest.url.includes('channel_url=streamer'))
  assert.ok(vkRequest.url.includes('stream_id=primary-stream'))
  assert.equal(JSON.parse(vkRequest.init.body).parts[0].text.content, 'hello')
  const guardedVk = new VkAuth(hub, vkSecrets, deps.resourcesDir, () => 'streamer')
  await assert.rejects(guardedVk.sendChat('wrong'), /Подключениях/)
  vk.dispose()

  // Cancellation during await validate cannot save credentials after the user closes the flow.
  const deviceSecrets = botSecrets(secrets, 'device')
  const auth = new TwitchAuth(deviceSecrets, () => 'synthetic-app')
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/device')) return Response.json({ device_code: 'synthetic-device', user_code: 'CONFIRM', verification_uri: 'https://example.invalid', interval: 1, expires_in: 60 })
    throw Error('Unexpected endpoint before polling')
  }
  const device = await auth.startDevice('bot')
  device.cancel()
  await assert.rejects(device.wait(), /отменён/)
  assert.equal(deviceSecrets.get('twitch.bot.tokens'), null)

  let beganValidation
  let finishValidation
  const validation = new Promise((resolve) => { beganValidation = resolve })
  const nativeTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn, ms, ...args) => nativeTimeout(fn, ms === 1000 ? 0 : ms, ...args)
  try {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/device')) return Response.json({ device_code: 'synthetic-device', user_code: 'CONFIRM', verification_uri: 'https://example.invalid', interval: 1, expires_in: 60 })
      if (String(url).endsWith('/token')) return Response.json({ access_token: 'synthetic-new', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: ['user:write:chat'] })
      if (String(url).endsWith('/validate')) {
        beganValidation()
        return new Promise((resolve) => { finishValidation = resolve })
      }
      throw Error('Unexpected synthetic OAuth endpoint')
    }
    const racing = await auth.startDevice('bot')
    const rejected = assert.rejects(racing.wait(), /отменён/)
    await validation
    racing.cancel()
    finishValidation(Response.json({ login: 'synthetic-user', user_id: 'synthetic-id' }))
    await rejected
    assert.equal(deviceSecrets.get('twitch.bot.tokens'), null, 'late validate must not persist a cancelled login')
  } finally { globalThis.setTimeout = nativeTimeout }

  // Cancel before pending is true invalidates a just-started OAuth request too.
  const oauth = new KickAuth(hub, botSecrets(secrets, 'cancelled'), deps.resourcesDir, true)
  const before = oauth.generation
  oauth.cancelLogin()
  assert.ok(oauth.generation > before)

  let primaryLogs = 0
  const originalLogin = KickAuth.prototype.login
  hub.log = () => { primaryLogs++ }
  KickAuth.prototype.login = async function () {
    queueMicrotask(() => { this.hub.log('kick', 'error', 'synthetic callback failure'); this.onChange() })
  }
  try {
    let changes = 0
    const failing = createKickBot(profile('callback-error', 'kick'), () => { changes++ }, deps)
    await failing.login()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(failing.state().error, 'synthetic callback failure')
    assert.ok(changes > 0)
    assert.equal(primaryLogs, 0, 'profile callback errors never enter primary connection logs')
    failing.dispose()
  } finally { KickAuth.prototype.login = originalLogin; hub.log = () => {} }

  // Revocation belongs to the old login and must never clear a new login after its await.
  const logoutSecrets = botSecrets(secrets, 'logout-race')
  logoutSecrets.set('kick.tokens', JSON.stringify(token('old-account', ['chat:write', 'user:read', 'channel:read'])))
  const logoutAdapter = createKickBot(profile('logout-race', 'kick'), () => {}, deps)
  let completeRevoke
  globalThis.fetch = async () => new Promise((resolve) => { completeRevoke = resolve })
  const loggingOut = logoutAdapter.logout()
  assert.equal(logoutSecrets.get('kick.tokens'), null, 'logout clears credentials before awaiting revocation')
  const replacement = JSON.stringify(token('new-account', ['chat:write', 'user:read', 'channel:read']))
  logoutSecrets.set('kick.tokens', replacement)
  completeRevoke(Response.json({}))
  await loggingOut
  assert.equal(logoutSecrets.get('kick.tokens'), replacement)
  logoutAdapter.dispose()

  const refreshSecrets = botSecrets(secrets, 'refresh-race')
  refreshSecrets.set('kick.tokens', JSON.stringify({ ...token('old-account', ['chat:write', 'user:read', 'channel:read']), expiresAt: 1 }))
  const refreshing = new KickAuth(hub, refreshSecrets, deps.resourcesDir, true)
  let beganRefresh
  let completeRefresh
  const startedRefresh = new Promise((resolve) => { beganRefresh = resolve })
  globalThis.fetch = async () => {
    beganRefresh()
    return new Promise((resolve) => { completeRefresh = resolve })
  }
  const rejectedRefresh = assert.rejects(refreshing.sendChatTo('late', undefined, 'streamer'), /сменился/)
  await startedRefresh
  refreshing.cancelLogin()
  refreshSecrets.set('kick.tokens', replacement)
  completeRefresh(Response.json({ access_token: 'synthetic-refreshed', refresh_token: 'synthetic-rotated', expires_in: 3600 }))
  await rejectedRefresh
  assert.equal(refreshSecrets.get('kick.tokens'), replacement, 'late refresh cannot overwrite a replacement login')
  console.log('Bot providers T/K/V: isolated credentials, shared app settings, send targets, primary guards, cancellation and disposal passed')
} finally { globalThis.fetch = originalFetch }

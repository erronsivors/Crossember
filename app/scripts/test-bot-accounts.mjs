// Synthetic metadata/store/adapters only. No user database, credentials or OAuth clients are read.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(url)) return { url: url.href, shortCircuit: true }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    return url.endsWith('.ts') ? { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }) } : next(url, context)
  }
})
const { BotAccounts } = await import('../src/main/core/botaccounts.ts')
const { ChatRegistry } = await import('../src/main/core/connector.ts')
const db = new Map()
const store = { get: (k, fallback) => db.has(k) ? structuredClone(db.get(k)) : fallback, set: (k, v) => db.set(k, structuredClone(v)) }
const records = new Map()
const order = []
const sends = []
const factory = (p, onChange) => {
  const record = records.get(p.id) ?? { account: null, live: true, pending: false }
  record.live = true
  records.set(p.id, record)
  return {
    state: () => ({ account: record.account, pending: record.pending, available: true }),
    async login() { record.account = `actual-${p.name}`; record.pending = false; onChange() },
    cancel() { record.pending = false },
    async logout() { assert(record.live, 'logout must clear credentials before dispose'); record.account = null; order.push('logout'); onChange() },
    async send(text) { assert(record.live); sends.push([p.id, text]) },
    dispose() { record.live = false; order.push('dispose') }
  }
}
const accounts = new BotAccounts(store, factory)
const platforms = ['twitch', 'youtube', 'vk', 'kick', 'goodgame']
for (let i = 0; i < 305; i++) accounts.add(platforms[i % platforms.length], `name${i}`)
assert.equal(accounts.state().profiles.length, 305, 'no arbitrary application profile cap')
const marked = accounts.add('twitch', '@Moderator')
assert(accounts.excluded('twitch', 'moderator', 'excludePoints'))
assert(accounts.excluded('twitch', 'Ｍｏｄｅｒａｔｏｒ', 'excludePoints'))
assert(!accounts.excluded('youtube', 'moderator', 'excludePoints'), 'same nick on another platform remains independent')
accounts.update(marked, { hideChat: true, excludePoints: false, platform: 'vk', id: 'injected' })
assert(!accounts.excluded('twitch', 'Moderator', 'excludePoints'))
assert(accounts.excluded('twitch', 'Moderator', 'excludeAnalytics'))
assert.deepEqual(accounts.hidden().twitch, ['moderator'])
assert.equal(accounts.state().profiles.find((p) => p.id === marked).platform, 'twitch')
assert.throws(() => accounts.sender('twitch', marked), /Сначала войдите/)
await accounts.login(marked)
accounts.sender('twitch', marked)
assert(accounts.canSend('twitch'))
assert(accounts.excluded('twitch', 'actual-@Moderator', 'excludeAnalytics'))
assert(!accounts.excluded('vk', 'actual-@Moderator', 'excludeAnalytics'))
assert.throws(() => accounts.sender('vk', marked), /Сначала войдите/)
const stored = JSON.stringify(db.get('botProfiles.v1'))
assert(!stored.includes('actual-'), 'authenticated identities and credentials do not enter metadata store')
const restored = new BotAccounts(store, factory)
assert.equal(restored.state().profiles.length, 306)
assert(restored.selected('twitch'))
const registry = new ChatRegistry()
let primarySends = 0
registry.add({ id: 'twitch', start: async () => {}, stop() {}, restart: async () => {}, chatState: () => ({ id: 'twitch', name: 'Twitch', configured: true, live: true, viewers: 0, canSend: true, canModerate: false, account: 'channel' }), send: async () => { primarySends++ } })
registry.alternateSend = (...args) => accounts.send(...args)
registry.alternateReady = (p) => accounts.canSend(p)
registry.alternateSelected = (p) => accounts.selected(p)
await registry.send('automatic', ['twitch'], 'auto')
assert.equal(sends.length, 1)
assert.equal(primarySends, 0)
await registry.send('explicit channel', ['twitch'], 'broadcaster')
assert.equal(primarySends, 1)
await accounts.logout(marked)
await assert.rejects(registry.send('must not impersonate channel', ['twitch'], 'auto'), /выберите отправителя/)
assert.equal(primarySends, 1)
await accounts.login(marked)
order.length = 0
await accounts.remove(marked)
assert.deepEqual(order, ['logout', 'dispose'])
assert(!accounts.selected('twitch'))
assert(!accounts.state().profiles.some((p) => p.id === marked))
await registry.send('after deliberate removal', ['twitch'], 'auto')
assert.equal(primarySends, 2)
accounts.dispose()
const reset = new BotAccounts(store, factory)
const yt = reset.add('youtube', 'yt-sender')
const vk = reset.add('vk', 'vk-sender')
await reset.login(yt)
await reset.login(vk)
reset.sender('youtube', yt)
reset.sender('vk', vk)
reset.resetPlatform('youtube')
assert(!reset.canSend('youtube'), 'changing OAuth application clears only its old identities')
assert(reset.canSend('vk'))
reset.dispose()
console.log('Bot accounts: 305+ profiles, persistence, immutable identity, platform exclusions, dispatch, logout failure and credential cleanup passed')

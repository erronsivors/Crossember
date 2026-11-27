// Synthetic state only: no credentials, user database or network.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(url)) return { url: url.href, shortCircuit: true }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }) }
    return next(url, context)
  }
})
const { Settings } = await import('../src/main/core/settings.ts')
const { Points } = await import('../src/main/core/points.ts')
const { Analytics } = await import('../src/main/core/analytics.ts')
const { textDefaults, chatHidden, botChatProfiles } = await import('../src/main/core/chatstyle.ts')
const data = new Map()
let rows = []
const store = { get: (k, fallback) => data.get(k) ?? fallback, set: (k, v) => data.set(k, v),
  sql: { exec() {}, prepare: () => ({ get: () => undefined, all: () => rows, run() {} }) } }
const settings = new Settings(store)
settings.patch({ points: { enabled: true, onlyLive: false, startBalance: 0, perMessage: 5, perMinute: 3, messageCooldownSec: 0, twitchLurkers: true } })
const excluded = new Set()
const isExcluded = (platform, name) => excluded.has(`${platform}:${name.toLowerCase().replace(/^@+/, '')}`)
const hub = new EventEmitter()
const points = new Points(store, settings, hub, () => true, () => [], isExcluded)
const message = (platform, user) => ({ id: 'synthetic', platform, user, type: 'message', ts: Date.now(), text: 'hello' })
const analytics = new Analytics(store, settings, () => ({ live: false, startedAt: null, viewers: {}, own: [] }), { timers: false, excluded: isExcluded })
try {
  hub.emit('event', message('twitch', 'Helper'))
  const old = points.byName('Helper', 'twitch')
  assert.equal(old.balance, 5)
  excluded.add('twitch:helper')
  hub.emit('event', message('twitch', 'Helper'))
  assert.equal(old.balance, 5, 'existing excluded viewer no longer earns message points')
  hub.emit('event', message('youtube', 'Helper'))
  assert.equal(points.byName('Helper', 'youtube').balance, 5, 'same name on other platform is independent')
  points.lurkers = async () => [{ id: 'excluded', name: 'Helper' }, { id: 'new', name: 'Other' }]
  points.minutes = 4
  await points.onMinute()
  assert.equal(old.balance, 5, 'excluded viewer earns neither active nor lurker minutes')
  assert.equal(points.byName('Helper', 'youtube').balance, 8)
  assert.equal(points.byName('Other', 'twitch').balance, 15)
  assert.ok(!points.top(100).some((v) => v.platform === 'twitch' && v.name === 'Helper'))
  assert.equal(points.rank(old.key), 0)
  assert.equal(points.state().count, 2, 'excluded viewer not counted in aggregate')
  hub.emit('event', { ...message('twitch', 'Helper'), type: 'sub' })
  assert.equal(old.balance, 5, 'excluded events do not award subscription points')
  analytics.onEvent(message('twitch', 'Helper'))
  analytics.onEvent(message('youtube', 'Helper'))
  assert.equal(analytics.pending.size, 1, 'analytics skips excluded profile only on its platform')
  rows = [
    { platform: 'twitch', key: 'helper', user: 'Helper', messages: 9, streams: 1, first_ts: 1, last_ts: 2 },
    { platform: 'youtube', key: 'helper', user: 'Helper', messages: 7, streams: 1, first_ts: 1, last_ts: 2 }
  ]
  assert.deepEqual(analytics.accounts().map((v) => v.platform), ['youtube'], 'saved history is hidden without deleting it')
  const profile = { id: 'one', platform: 'twitch', name: '@Helper', hideChat: true, excludeAnalytics: true, excludePoints: true, selected: false,
    auth: { account: 'OtherAccount', pending: false, available: true } }
  const map = botChatProfiles([profile, { ...profile, id: 'two', name: 'Visible', auth: { ...profile.auth, account: null }, hideChat: false }])
  const look = textDefaults()
  look.filter = { bots: '', commands: false, links: 'show', words: '', botProfiles: map }
  assert.equal(chatHidden(look, message('twitch', 'HELPER')), true)
  assert.equal(chatHidden(look, message('twitch', 'ＨＥＬＰＥＲ')), true, 'compatibility Unicode names match profiles')
  assert.equal(chatHidden(look, message('youtube', 'HELPER')), false)
  assert.equal(chatHidden(look, message('twitch', 'OtherAccount')), true)
  assert.equal(chatHidden(look, message('twitch', 'Visible')), false)
  assert.equal(chatHidden(look, { ...message('twitch', 'Helper'), type: 'sub' }), false)
  look.filter.bots = 'LegacyBot'
  assert.equal(chatHidden(look, message('youtube', 'LegacyBot')), true, 'legacy global bot filter retained')
  const source = readFileSync(new URL('../resources/overlays/chat.js', import.meta.url), 'utf8')
  const start = source.indexOf('const norm =')
  const end = source.indexOf('function emoteOnly', start)
  const context = { opts: { look }, result: null }
  vm.createContext(context)
  vm.runInContext(source.slice(start, end), context)
  for (const platform of ['twitch', 'youtube', 'vk', 'kick', 'goodgame']) {
    for (const name of ['HELPER', 'ＨＥＬＰＥＲ', '@Helper', 'OtherAccount', 'Visible', 'LegacyBot']) {
      context.event = message(platform, name)
      assert.equal(vm.runInContext('hidden(event)', context), chatHidden(look, context.event), 'renderer and OBS filters agree')
    }
  }
  console.log('Bot exclusions: per-platform points/events/minutes/lurkers/rank, analytics and renderer/OBS filters passed')
} finally {
  points.stop()
  analytics.pending.clear()
  analytics.stop()
}

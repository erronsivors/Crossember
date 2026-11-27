// node scripts/test-rule-pairs.mjs — проверка без приложения, базы и пользовательских настроек.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
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
    if (url.endsWith('.ts')) return {
      format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' })
    }
    return next(url, context)
  }
})

const { sanitizeRule, matches, RuleEngine } = await import('../src/main/core/rules.ts')
const event = (type, platform, extras = {}) => ({ id: 'event', ts: Date.now(), type, platform, user: 'Viewer', ...extras })
const raw = {
  id: 'paired', name: 'Pairs', types: ['bits'], platforms: ['youtube'],
  pairs: [{ type: 'follow', platform: 'twitch' }, { type: 'donation', platform: 'donationalerts' }],
  actions: [{ type: 'sound', sound: 'coin', volume: 80 }]
}
const rule = sanitizeRule(raw)
assert.deepEqual(sanitizeRule(JSON.parse(JSON.stringify(rule))), rule)
assert.deepEqual(rule.types, ['follow', 'donation'])
assert.deepEqual(rule.platforms, [])
assert(matches(rule, event('follow', 'twitch')))
assert(matches(rule, event('donation', 'donationalerts')))
assert(!matches(rule, event('follow', 'donationalerts')))
assert(!matches(rule, event('donation', 'twitch')))
assert(!matches(rule, event('bits', 'youtube')))
assert(matches(sanitizeRule({ pairs: [{ type: 'follow', platform: null }] }), event('follow', 'youtube')))
assert(!matches(sanitizeRule({ ...raw, pairs: [] }), event('follow', 'twitch')))
assert(!matches(sanitizeRule({ ...raw, pairs: [{ type: 'follow', platform: 'invalid' }] }), event('follow', 'twitch')))
assert.equal(sanitizeRule({ pairs: [raw.pairs[0], raw.pairs[0]] }).pairs.length, 1)
const legacy = sanitizeRule({ types: ['follow', 'donation'], platforms: ['twitch', 'donationalerts'] })
for (const type of legacy.types) for (const platform of legacy.platforms) assert(matches(legacy, event(type, platform)))
assert(!matches(legacy, event('follow', 'youtube')))
assert.equal(legacy.pairs, undefined)
assert(!matches(sanitizeRule({ ...raw, filter: { tests: 'real' } }), event('follow', 'twitch', { test: true })))
assert(!matches(sanitizeRule({ ...raw, filter: { minAmount: 100 } }), event('donation', 'donationalerts', { amount: 99 })))
assert(matches(sanitizeRule({ ...raw, filter: { minAmount: 100 } }), event('donation', 'donationalerts', { amount: 100 })))

const service = sanitizeRule({
  id: 'service', pairs: [{ type: 'stream_start', platform: 'twitch' }, { type: 'hotkey', platform: null }],
  hotkey: 'Ctrl+1', filter: { minAmount: 1000, tests: 'test' }, actions: raw.actions
})
assert.deepEqual(service.pairs[0], { type: 'stream_start', platform: null })
const hub = new EventEmitter()
const storage = new Map([['rules.v1', [rule, service]]])
const store = { get: (key, fallback) => storage.get(key) ?? fallback, set: (key, value) => storage.set(key, value) }
const played = []
const runner = { isLive: () => false, play: (plan, e, force) => played.push({ plan, e, force }), obs: async () => {} }
const engine = new RuleEngine(hub, store, {}, { initialized: () => true, get: () => undefined }, runner, { vars: () => ({}), list: () => [] })
try {
  engine.put({ ...service, name: 'Service renamed' })
  assert.deepEqual(storage.get('rules.v1').find((r) => r.id === 'service').pairs, service.pairs)
  assert.deepEqual(storage.get('rules.v1').find((r) => r.id === 'service').actions, service.actions)
  assert.deepEqual(engine.hotkeys(), [{ id: 'service', accel: 'Ctrl+1' }])
  hub.emit('event', event('follow', 'donationalerts'))
  assert.equal(engine.state().log.length, 0)
  hub.emit('event', event('follow', 'twitch'))
  assert.equal(engine.state().log[0].ruleId, 'paired')
  assert.equal(engine.state().log[0].result, 'done')
  engine.setFlags({ dryRun: true })
  hub.emit('event', event('donation', 'donationalerts'))
  assert.equal(engine.state().log[0].result, 'dry')
  engine.fireService('stream_start')
  assert.equal(engine.state().log[0].ruleId, 'service')
  assert.equal(engine.state().log[0].type, 'stream_start')
  assert(engine.test('paired', event('follow', 'twitch', { test: true })))
  assert.equal(engine.state().log[0].result, 'test')
  assert(played.some((p) => p.force))
  engine.put({ ...rule, enabled: false })
  assert.deepEqual(engine.state().rules.find((r) => r.id === 'paired').pairs, rule.pairs)
} finally { engine.dispose() }
console.log('Rule pairs: matching, legacy rules, sanitization, service triggers, dry-run and manual test passed')

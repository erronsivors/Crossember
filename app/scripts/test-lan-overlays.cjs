// Synthetic loopback server only: no user settings, interfaces, tokens or database are read.
const assert = require('node:assert/strict')
const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { EventEmitter, once } = require('node:events')
const vm = require('node:vm')
const { registerHooks, stripTypeScriptTypes } = require('node:module')
const { fileURLToPath } = require('node:url')
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
const { OverlayServer } = require('../src/main/core/server.ts')
const { Settings } = require('../src/main/core/settings.ts')
const tick = () => new Promise((resolve) => setImmediate(resolve))

async function main() {
  const values = new Map()
  const store = { get: (k, fallback) => values.has(k) ? values.get(k) : fallback, set: (k, v) => values.set(k, v) }
  const settings = new Settings(store)
  assert.equal(settings.get().lan.overlays, false, 'LAN overlays default to off')
  const hub = Object.assign(new EventEmitter(), { recentChat: () => [], recent: () => [], pinned: null })
  const extras = {}
  for (const name of ['alerts', 'counters', 'auction', 'wheel', 'goal', 'giveaway', 'vote', 'bets', 'music', 'subathon', 'rewards', 'keys']) {
    extras[name] = Object.assign(new EventEmitter(), { overlay: () => ({}), list: () => [], state: () => ({}), nowPlaying: () => null })
  }
  extras.stats = { overlay: () => ({}) }
  extras.sounds = { get: async () => ({ type: 'audio/wav', body: Buffer.from('sound') }) }
  extras.media = { get: async () => ({ type: 'video/webm', body: Buffer.from('video'), start: 0, end: 4, size: 5 }) }
  extras.tts = { get: async () => Buffer.from('voice') }
  let actions = 0
  const remote = { send: async () => { actions++ }, pin: () => { actions++ }, dock: {}, sendMod: async () => { actions++ }, moderate: async () => { actions++ } }
  const server = new OverlayServer(hub, store, settings, { get: async () => null }, join(__dirname, '../resources'), join(__dirname, '..'), remote, extras)
  const app = await server.build('lan', '127.0.0.1', 0)
  const sockets = []
  const host = '127.0.0.1:0'
  const overlayKey = values.get('server.overlayKey')
  const remoteKey = values.get('server.remoteKey')
  const get = (url, reqHost = host) => app.inject({ url, headers: { host: reqHost } })
  const connect = async (key, ov = 'chat', origin) => {
    const messages = []
    const ws = await app.injectWS(`/ws?k=${key}&o=${ov}`, { headers: { host, ...(origin ? { origin } : {}) } }, {
      onInit: (s) => s.on('message', (raw) => messages.push(JSON.parse(raw.toString())))
    })
    sockets.push(ws)
    await tick()
    return { ws, messages }
  }
  try {
    assert.equal((await get(`/o/alert?k=${overlayKey}`)).statusCode, 403)
    assert.equal((await get(`/m/test.webm?k=${overlayKey}`)).statusCode, 403)
    settings.patch({ lan: { overlays: true } })
    assert.equal((await get(`/o/alert?k=${overlayKey}`)).statusCode, 200)
    assert.equal((await get(`/o/float?k=${overlayKey}`)).statusCode, 404)
    assert.equal((await get(`/o/chat?k=${remoteKey}`)).statusCode, 403)
    assert.equal((await get(`/remote?k=${overlayKey}`)).statusCode, 403)
    assert.equal((await get(`/dock?k=${overlayKey}`)).statusCode, 404)
    assert.equal((await get(`/o/chat?k=${overlayKey}`, 'untrusted.invalid')).statusCode, 421)
    for (const path of ['s/test.wav', 'm/test.webm', 't/test.wav']) {
      assert.equal((await get(`/${path}?k=${overlayKey}`)).statusCode, 200)
      assert.equal((await get(`/${path}?k=${remoteKey}`)).statusCode, 403)
    }
    const ranged = await app.inject({ url: `/m/test.webm?k=${overlayKey}`, headers: { host, range: 'bytes=0-4' } })
    assert.equal(ranged.statusCode, 206)
    assert.equal(ranged.headers['content-range'], 'bytes 0-4/5')
    const overlay = await connect(overlayKey, 'chat', `http://${host}`)
    assert.equal(overlay.messages[0].role, 'overlay')
    assert.equal(typeof overlay.messages[0].serverTime, 'number')
    assert.ok('stats' in overlay.messages[0])
    assert.ok(!('dock' in overlay.messages[0]))
    overlay.ws.send(JSON.stringify({ kind: 'send', text: 'synthetic' }))
    overlay.ws.send(JSON.stringify({ kind: 'pin', id: null }))
    await tick()
    assert.equal(actions, 0, 'overlay key cannot invoke remote controls')
    server.broadcast({ kind: 'counters', counters: [] }, 'local')
    await tick()
    assert.ok(overlay.messages.some((m) => m.kind === 'counters'))
    const alert = await connect(overlayKey, 'alert')
    alert.ws.send(JSON.stringify({ kind: 'hi', obs: true, visible: true }))
    alert.ws.send('null')
    await tick()
    assert.ok(alert.messages.some((m) => m.kind === 'role' && m.main), 'LAN alert participates in audio election')
    server.extras.alerts.emit('play', { id: 'synthetic' })
    await tick()
    assert.ok(alert.messages.some((m) => m.kind === 'alert'))
    const wrongOrigin = await connect(overlayKey, 'chat', 'http://untrusted.invalid')
    assert.equal(wrongOrigin.messages.length, 0)
    const invalidOverlay = await connect(overlayKey, 'float')
    assert.equal(invalidOverlay.messages.length, 0)
    const closed = once(overlay.ws, 'close')
    server.rotate('overlay')
    assert.equal((await closed)[0], 4001, 'rotating overlay key disconnects LAN overlays')
    settings.patch({ lan: { overlays: false } })
    assert.equal((await get(`/o/chat?k=${values.get('server.overlayKey')}`)).statusCode, 403)
    const disabled = await connect(values.get('server.overlayKey'))
    assert.equal(disabled.messages.length, 0)
    // The OBS machine is one hour ahead: a fresh server alert must still render.
    const handlers = {}
    let mounted = 0
    const stage = { style: {}, classList: { remove() {}, add() {} } }
    const context = {
      Date: { now: () => 3_700_000 }, window: { innerWidth: 1920, innerHeight: 1080, addEventListener() {} },
      document: { getElementById: () => stage }, setTimeout, clearTimeout,
      CB: { clockOffset: -3_600_000, visible: true, key: 'synthetic', on: (name, fn) => { handlers[name] = fn }, connect() {} },
      CBSound: { play() {} }, AlertKit: { W: 1920, H: 1080, mount: () => { mounted++; return { stop() {}, pause() {} } } }
    }
    vm.runInNewContext(readFileSync(join(__dirname, '../resources/overlays/alert.js'), 'utf8'), context)
    handlers.alert({ alert: { id: 'clock-test', durationMs: 6000 }, at: 100_000 })
    assert.equal(mounted, 1, 'different device clocks do not discard fresh alerts')
    for (const socket of sockets) socket.terminate()
    for (const socket of app.websocketServer.clients) socket.terminate()
    await tick()
    settings.patch({ lan: { overlays: true } })
    const active = await connect(values.get('server.overlayKey'))
    assert.equal(active.messages[0].role, 'overlay')
    server.lan = app
    server.lanUrl = 'http://synthetic.invalid/remote?k=synthetic'
    const disconnected = once(active.ws, 'close')
    settings.patch({ lan: { enabled: false, overlays: false } })
    await server.applyLan()
    await disconnected
    assert.equal(server.lan, null, 'disabling LAN closes server and existing overlay sockets')
    assert.equal(server.lanUrl, null)
    console.log('LAN overlays: HTTP/media/Range, WebSocket, controls isolation, Host/Origin, key rotation and opt-in passed')
  } finally {
    for (const socket of sockets) socket.terminate()
    for (const socket of server.sockets.keys()) socket.terminate()
    for (const socket of app.websocketServer.clients) socket.terminate()
    await tick()
    await app.close()
    await server.stop()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

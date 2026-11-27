// node scripts/test-alert-canvas.mjs — no app, database or user settings required.
import assert from 'node:assert/strict'
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
    if (url.endsWith('.ts')) return {
      format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' })
    }
    return next(url, context)
  }
})

const { alertCanvas, resizeAlertCanvas } = await import('../src/main/core/alertcanvas.ts')
const { newLayer, sanitizeTemplate, TemplateStore } = await import('../src/main/core/templates.ts')
assert.deepEqual(alertCanvas(), { w: 1920, h: 1080 })
assert.deepEqual(alertCanvas(null), { w: 1920, h: 1080 })
assert.deepEqual(alertCanvas({ w: Infinity, h: NaN }), { w: 1920, h: 1080 })
assert.deepEqual(alertCanvas({ w: -1, h: 99999 }), { w: 240, h: 3840 })
assert.deepEqual(sanitizeTemplate({ canvas: 'invalid' }).canvas, { w: 1920, h: 1080 })
assert.deepEqual(sanitizeTemplate({ canvas: { w: '1080', h: 1920.4 } }).canvas, { w: 1920, h: 1920 })

const key = { t: 1000, x: 260, y: 200, scale: 1.5, rotate: 30, opacity: 0.5, ease: 'out' }
const original = sanitizeTemplate({ id: 'canvas-test', name: 'Canvas', layers: [
  newLayer('image', { keyframes: [key], keyframesOff: [{ ...key, x: 100, y: 50 }], keyframesFull: [{ ...key, x: 200, y: 100 }] }),
  newLayer('text', { hidden: true }), newLayer('sound')
] })
const initialJSON = JSON.stringify(original)
const keep = resizeAlertCanvas(original, { w: 1080, h: 1920 }, false)
assert.equal(keep.layers, original.layers)
assert.deepEqual(keep.canvas, { w: 1080, h: 1920 })
assert.deepEqual(sanitizeTemplate(keep), keep)

const fitted = resizeAlertCanvas(original, { w: 1280, h: 720 }, true)
assert.equal(fitted.layers[0].x, 440) // newLayer(image) starts at 660.
assert.equal(fitted.layers[0].w, 400)
assert.equal(fitted.layers[0].keyframes[0].x, 173)
assert.equal(fitted.layers[0].keyframesOff[0].x, 67)
assert.equal(fitted.layers[0].keyframesFull[0].x, 133)
assert.deepEqual(fitted.layers[0].keyframes[0], { ...key, x: 173, y: 133 })
assert.equal(fitted.layers[1].x, 440) // Hidden visual layers follow the canvas too.
assert.equal(fitted.layers[2], original.layers[2]) // Audio timeline remains untouched.
assert.deepEqual(sanitizeTemplate(fitted), fitted)
assert.equal(JSON.stringify(original), initialJSON)

const portrait = resizeAlertCanvas(original, { w: 1080, h: 1920 }, true)
assert.equal(portrait.layers[0].keyframes[0].y, 769)
assert.equal(portrait.layers[0].keyframes[0].scale, key.scale)
assert.deepEqual(sanitizeTemplate(portrait), portrait)

// Saving never silently changes a resized preview, even at the coordinate/font/size limits.
const edges = sanitizeTemplate({ id: 'limits', canvas: { w: 240, h: 240 }, layers: [newLayer('text', {
  x: -4000, y: 6000, w: 4000, h: 10, size: 400, stroke: 20,
  keyframes: [{ ...key, x: -4000, y: 6000 }],
  keyframesOff: [{ ...key, x: 6000, y: -4000 }],
  keyframesFull: [{ ...key, x: 6000, y: 6000 }]
})] })
for (const canvas of [{ w: 3840, h: 3840 }, { w: 240, h: 3840 }, { w: 3840, h: 240 }]) {
  const next = resizeAlertCanvas(edges, canvas, true)
  assert.deepEqual(sanitizeTemplate(next), next)
  for (const field of ['keyframes', 'keyframesOff', 'keyframesFull']) {
    const frame = next.layers[0][field][0]
    assert(frame.x >= -4000 && frame.x <= 6000)
    assert(frame.y >= -4000 && frame.y <= 6000)
    assert.equal(frame.t, key.t)
    assert.equal(frame.scale, key.scale)
    assert.equal(frame.rotate, key.rotate)
  }
}

const saved = new Map()
const storage = { get: (k, fallback) => saved.get(k) ?? fallback, set: (k, v) => saved.set(k, JSON.parse(JSON.stringify(v))) }
const store = new TemplateStore(storage)
store.put(portrait)
assert.deepEqual(new TemplateStore(storage).get(portrait.id), portrait)
assert.deepEqual(store.duplicate(portrait.id).canvas, portrait.canvas)

// The same mount function powers preview and OBS; it resets dimensions between different templates.
const stage = { style: {}, classList: { add() {}, remove() {} }, replaceChildren() {} }
const context = { window: {}, console }
vm.createContext(context)
vm.runInContext(readFileSync(new URL('../resources/overlays/alertkit.js', import.meta.url), 'utf8'), context)
const kit = context.window.AlertKit
kit.mount(stage, { layers: [], canvas: portrait.canvas }, { paused: true })
assert.equal(stage.style.width, '1080px')
assert.equal(stage.style.height, '1920px')
kit.mount(stage, { layers: [] }, { paused: true })
assert.equal(stage.style.width, '1920px')
assert.equal(stage.style.height, '1080px')
kit.mount(stage, { layers: [], canvas: { w: -1, h: Infinity } }, { paused: true })
assert.equal(stage.style.width, '240px')
assert.equal(stage.style.height, '1080px')

// Verify OBS fits each new alert, plus resize events, using its actual overlay entry point.
const handlers = new Map()
const overlayStage = { ...stage, style: {}, classList: { add() {}, remove() {} } }
const overlayWindow = { innerWidth: 1920, innerHeight: 1080, addEventListener: (name, fn) => handlers.set(name, fn) }
const cb = { key: 'test-key', visible: true, on: (name, fn) => handlers.set(name, fn), theme() {}, connect() {} }
const overlayContext = {
  window: overlayWindow, document: { getElementById: () => overlayStage }, AlertKit: kit, CB: cb,
  CBSound: { play() {} }, console, setTimeout, clearTimeout
}
vm.createContext(overlayContext)
vm.runInContext(readFileSync(new URL('../resources/overlays/alert.js', import.meta.url), 'utf8'), overlayContext)
handlers.get('alert')({ alert: { id: 'portrait', layers: [], canvas: portrait.canvas, durationMs: 6000 }, at: Date.now() })
assert.equal(overlayStage.style.transform, 'scale(0.5625)')
handlers.get('alert')({ alert: { id: 'legacy', layers: [], durationMs: 6000 }, at: Date.now() })
assert.equal(overlayStage.style.transform, 'scale(1)')
overlayWindow.innerWidth = 1280
overlayWindow.innerHeight = 720
handlers.get('resize')()
assert.equal(overlayStage.style.transform, `scale(${2 / 3})`)
console.log('Alert canvas: legacy, limits, keep/fit, keyframe backups, sanitization, persistence, preview and OBS sizing passed')

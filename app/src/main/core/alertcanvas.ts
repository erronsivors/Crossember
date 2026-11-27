import type { AlertTemplate, Keyframe, Layer } from './templates'

export interface AlertCanvas { w: number; h: number }
export const DEFAULT_ALERT_CANVAS: AlertCanvas = { w: 1920, h: 1080 }
export const CANVAS_MIN = 240
export const CANVAS_MAX = 3840

/** Pure helper shared by the main process and renderer; old templates keep Full HD. */
export function alertCanvas(value?: Partial<AlertCanvas> | null): AlertCanvas {
  const side = (v: unknown, fallback: number): number => typeof v === 'number' && Number.isFinite(v)
    ? Math.round(Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, v))) : fallback
  return { w: side(value?.w, DEFAULT_ALERT_CANVAS.w), h: side(value?.h, DEFAULT_ALERT_CANVAS.h) }
}

/** Optional fit keeps proportions and centres the old canvas inside the new one. */
export function resizeAlertCanvas(t: AlertTemplate, canvas: AlertCanvas, fit: boolean): AlertTemplate {
  const from = alertCanvas(t.canvas)
  const to = alertCanvas(canvas)
  if (!fit) return { ...t, canvas: to }
  const scale = Math.min(to.w / from.w, to.h / from.h)
  const dx = (to.w - from.w * scale) / 2
  const dy = (to.h - from.h * scale) / 2
  const bounded = (v: number, min: number, max: number): number => Math.round(Math.min(max, Math.max(min, v)))
  const x = (v: number): number => bounded(v * scale + dx, -4000, 6000)
  const y = (v: number): number => bounded(v * scale + dy, -4000, 6000)
  const frame = (k: Keyframe): Keyframe => ({ ...k, x: x(k.x), y: y(k.y) })
  const layer = (l: Layer): Layer => ['card', 'text', 'image', 'video'].includes(l.type) ? {
    ...l, x: x(l.x), y: y(l.y), w: bounded(l.w * scale, 10, 4000), h: bounded(l.h * scale, 10, 4000),
    size: Math.min(400, Math.max(8, Math.round(l.size * scale))), stroke: Math.min(20, Math.round(l.stroke * scale)),
    keyframes: l.keyframes.map(frame), keyframesOff: (l.keyframesOff ?? []).map(frame), keyframesFull: (l.keyframesFull ?? []).map(frame)
  } : l
  return { ...t, canvas: to, layers: t.layers.map(layer) }
}

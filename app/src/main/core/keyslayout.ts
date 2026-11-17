// Оверлей клавиатуры и мыши: клавиши, готовые раскладки и настройки.
// Без node-импортов: интерфейс берёт отсюда список клавиш и раскладки.
// Коды — скан-коды uiohook: не зависят от языка раскладки (W остаётся W и при русской раскладке).

export interface KeyDef { code: number; label: string }

const letters = 'QWERTYUIOPASDFGHJKLZXCVBNM'
const LETTER_CODES = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 30, 31, 32, 33, 34, 35, 36, 37, 38, 44, 45, 46, 47, 48, 49, 50]

export const KEY_DEFS: Record<string, KeyDef> = {
  Esc: { code: 1, label: 'Esc' },
  ...Object.fromEntries('1234567890'.split('').map((d, i) => [d, { code: i + 2, label: d }])),
  ...Object.fromEntries(letters.split('').map((l, i) => [l, { code: LETTER_CODES[i], label: l }])),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, { code: i < 10 ? 59 + i : 87 + i - 10, label: `F${i + 1}` }])),
  Tab: { code: 15, label: 'Tab' },
  Caps: { code: 58, label: 'Caps' },
  Shift: { code: 42, label: 'Shift' },
  Ctrl: { code: 29, label: 'Ctrl' },
  Alt: { code: 56, label: 'Alt' },
  Space: { code: 57, label: 'Space' },
  Enter: { code: 28, label: 'Enter' },
  Backspace: { code: 14, label: '⌫' },
  Up: { code: 57416, label: '↑' },
  Down: { code: 57424, label: '↓' },
  Left: { code: 57419, label: '←' },
  Right: { code: 57421, label: '→' }
}

/** Кнопки мыши: M1 левая, M2 правая, M3 колесо, M4/M5 боковые; WU/WD — прокрутка колеса. */
export const MOUSE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'WU', 'WD'] as const

/** Ряд раскладки: [id клавиши или '' для пустого места, ширина в клавишах]. */
export type KeyRow = [string, number][]

export type KeysPreset = 'wasd' | 'fps' | 'arrows' | 'moba' | 'none'

export const KEYS_PRESETS: Record<KeysPreset, { name: string; rows: KeyRow[] }> = {
  wasd: { name: 'WASD', rows: [[['', 1], ['W', 1]], [['A', 1], ['S', 1], ['D', 1]], [['Space', 3]]] },
  fps: {
    name: 'Шутер',
    rows: [
      [['Esc', 1], ['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1]],
      [['Tab', 1.5], ['Q', 1], ['W', 1], ['E', 1], ['R', 1], ['T', 1]],
      [['Shift', 1.75], ['A', 1], ['S', 1], ['D', 1], ['F', 1], ['G', 1]],
      [['Ctrl', 1.5], ['Z', 1], ['X', 1], ['C', 1], ['Space', 2.5]]
    ]
  },
  arrows: { name: 'Стрелки', rows: [[['', 1], ['Up', 1]], [['Left', 1], ['Down', 1], ['Right', 1]]] },
  moba: { name: 'MOBA', rows: [[['1', 1], ['2', 1], ['3', 1], ['4', 1]], [['Q', 1], ['W', 1], ['E', 1], ['R', 1]], [['D', 1], ['F', 1], ['B', 1]]] },
  none: { name: 'Без клавиатуры', rows: [] }
}

export interface KeysOverlaySettings {
  theme: 'general' | 'campfire'
  /** Перехват нажатий разрешён. Без этого оверлей показывает только раскладку. */
  capture: boolean
  preset: KeysPreset
  mouse: boolean
  /** Свои клавиши — отдельным рядом под раскладкой. */
  extra: string[]
  /** Размер клавиши, px. */
  size: number
  /** Яркость ненажатых клавиш, %. */
  idle: number
}

export const KEYS_DEFAULTS: KeysOverlaySettings = { theme: 'general', capture: false, preset: 'wasd', mouse: true, extra: [], size: 56, idle: 55 }

/** Ряды, которые рисует оверлей: раскладка + свои клавиши (без повторов). */
export function keysRows(c: KeysOverlaySettings): KeyRow[] {
  const rows = KEYS_PRESETS[c.preset].rows
  const used = new Set(rows.flat().map(([id]) => id))
  const extra = c.extra.filter((id) => !used.has(id))
  return extra.length ? [...rows, extra.map((id): [string, number] => [id, id === 'Space' ? 3 : 1])] : rows
}

/** Какие нажатия можно отправлять в оверлей: только то, что на нём нарисовано. */
export function keysAllowed(c: KeysOverlaySettings): Set<string> {
  const ids = new Set(keysRows(c).flat().map(([id]) => id).filter((id) => Object.hasOwn(KEY_DEFS, id)))
  if (c.mouse) for (const m of MOUSE_IDS) ids.add(m)
  return ids
}

const int = (v: unknown, d: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d

export function sanitizeKeys(input: unknown, base: KeysOverlaySettings = KEYS_DEFAULTS): KeysOverlaySettings {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  return {
    theme: o.theme === 'campfire' || o.theme === 'general' ? o.theme : base.theme,
    capture: typeof o.capture === 'boolean' ? o.capture : base.capture,
    preset: typeof o.preset === 'string' && Object.hasOwn(KEYS_PRESETS, o.preset) ? (o.preset as KeysPreset) : base.preset,
    mouse: typeof o.mouse === 'boolean' ? o.mouse : base.mouse,
    extra: Array.isArray(o.extra) ? [...new Set(o.extra.filter((x): x is string => typeof x === 'string' && Object.hasOwn(KEY_DEFS, x)))].slice(0, 20) : base.extra,
    size: int(o.size, base.size, 24, 140),
    idle: int(o.idle, base.idle, 0, 100)
  }
}

/** Что рисует оверлей: ряды клавиш с подписями. */
export function keysView(c: KeysOverlaySettings): { id: string; w: number; label: string }[][] {
  return keysRows(c).map((r) => r.map(([id, w]) => ({ id, w, label: KEY_DEFS[id]?.label ?? '' })))
}

/**
 * Ссылка для игрового ПК: http://<частный IPv4>:<порт>/kws?k=<ключ>. Возвращает адрес WebSocket или null.
 * Только домашняя сеть — помощник никогда не отправляет нажатия в интернет.
 */
export function parseHelperUrl(text: string): string | null {
  let u: URL
  try { u = new URL(text.trim()) } catch { return null }
  const port = Number(u.port)
  const k = u.searchParams.get('k') ?? ''
  if (u.protocol !== 'http:' || u.pathname !== '/kws' || u.username || u.password) return null
  if (!/^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(u.hostname)) return null
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[\w-]{20,100}$/.test(k)) return null
  return `ws://${u.hostname}:${port}/kws?k=${encodeURIComponent(k)}`
}

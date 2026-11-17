// Оверлей «Визуализатор звука»: настройки. Без node-импортов — их использует и интерфейс.
// Звук слушает интерфейс Crossember (Web Audio), в оверлей уходят только уровни полос 0–100.

export type VizStyle = 'bars' | 'mirror' | 'wave' | 'circle'
export const VIZ_STYLES: Record<VizStyle, string> = { bars: 'Столбики', mirror: 'Зеркальные', wave: 'Волна', circle: 'Круг' }

export interface VizSettings {
  theme: 'general' | 'campfire'
  /** Слушать звук разрешено (иначе оверлей пустой). */
  enabled: boolean
  /** system — всё, что слышно в колонках; device — устройство записи (микрофон, карта захвата). */
  source: 'system' | 'device'
  deviceId: string
  style: VizStyle
  bars: number
  /** Чувствительность, % (100 — как есть). */
  gain: number
  /** Плавность спада, 0–95. */
  smooth: number
  /** Свой цвет #rrggbb, пусто — цвет темы. */
  color: string
}

export const VIZ_DEFAULTS: VizSettings = { theme: 'general', enabled: false, source: 'system', deviceId: '', style: 'bars', bars: 48, gain: 100, smooth: 60, color: '' }

/** Что интерфейс должен слушать прямо сейчас (null — ничего). */
export interface VizRun { source: 'system' | 'device'; deviceId: string; bars: number; gain: number }

const int = (v: unknown, d: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d

export function sanitizeViz(input: unknown, base: VizSettings = VIZ_DEFAULTS): VizSettings {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  return {
    theme: o.theme === 'campfire' || o.theme === 'general' ? o.theme : base.theme,
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    source: o.source === 'system' || o.source === 'device' ? o.source : base.source,
    deviceId: typeof o.deviceId === 'string' && /^[\w=+/-]{0,200}$/.test(o.deviceId) ? o.deviceId : base.deviceId,
    style: typeof o.style === 'string' && Object.hasOwn(VIZ_STYLES, o.style) ? (o.style as VizStyle) : base.style,
    bars: int(o.bars, base.bars, 8, 96),
    gain: int(o.gain, base.gain, 10, 400),
    smooth: int(o.smooth, base.smooth, 0, 95),
    color: typeof o.color === 'string' && (o.color === '' || /^#[0-9a-fA-F]{6}$/.test(o.color)) ? o.color : base.color
  }
}

// Оформление чата для OBS: настройки, проверка, CSS и вид событий в ленте.
// Без node-импортов: этот модуль использует и ядро (оверлей в OBS), и интерфейс (живой предпросмотр) —
// так OBS и предпросмотр всегда выглядят одинаково.
import type { HubEvent, Platform } from './types'

export const CHAT_FONTS = ['manrope', 'unbounded', 'arial', 'segoe', 'verdana', 'tahoma', 'georgia', 'impact', 'consolas', 'comic'] as const
export type ChatFont = (typeof CHAT_FONTS)[number]
export const FONT_LABEL: Record<ChatFont, string> = {
  manrope: 'Manrope', unbounded: 'Unbounded', arial: 'Arial', segoe: 'Segoe UI', verdana: 'Verdana', tahoma: 'Tahoma',
  georgia: 'Georgia', impact: 'Impact', consolas: 'Consolas', comic: 'Comic Sans MS'
}
const FONT_CSS: Record<ChatFont, string> = {
  manrope: "'Manrope', sans-serif", unbounded: "'Unbounded', sans-serif", arial: 'Arial, sans-serif', segoe: "'Segoe UI', sans-serif",
  verdana: 'Verdana, sans-serif', tahoma: 'Tahoma, sans-serif', georgia: 'Georgia, serif', impact: 'Impact, sans-serif',
  consolas: 'Consolas, monospace', comic: "'Comic Sans MS', cursive"
}

export const ANIM_IN = ['none', 'fade', 'slide', 'pop', 'blur', 'bounce'] as const
export const ANIM_OUT = ['none', 'fade', 'slide', 'shrink'] as const
export const ANIM_IN_LABEL: Record<(typeof ANIM_IN)[number], string> = { none: 'Без анимации', fade: 'Проявление', slide: 'Выезд', pop: 'Пружина', blur: 'Из размытия', bounce: 'Подскок' }
export const ANIM_OUT_LABEL: Record<(typeof ANIM_OUT)[number], string> = { none: 'Сразу', fade: 'Растворение', slide: 'Уезжает', shrink: 'Сжатие' }

export const BG_STYLES = ['card', 'plain', 'strip'] as const
export const BG_LABEL: Record<(typeof BG_STYLES)[number], string> = { card: 'Карточки', plain: 'Без подложки', strip: 'Полоса' }
export const HIGHLIGHTS = ['none', 'frame', 'fill', 'both', 'bar'] as const
export const HIGHLIGHT_LABEL: Record<(typeof HIGHLIGHTS)[number], string> = { none: 'Нет', frame: 'Рамка', fill: 'Заливка', both: 'Рамка и заливка', bar: 'Полоса слева' }

/** События, которые можно показывать в ленте чата (каждое — своей галочкой). */
export const CHAT_EVENTS = ['donation', 'follow', 'sub', 'gift', 'raid', 'bits', 'reward', 'mention'] as const
export type ChatEventKind = (typeof CHAT_EVENTS)[number]
export const CHAT_EVENT_LABEL: Record<ChatEventKind, string> = {
  donation: 'Донаты', follow: 'Фолловы', sub: 'Подписки', gift: 'Подарочные подписки', raid: 'Рейды', bits: 'Биты', reward: 'Награды за баллы', mention: 'Обращения к стримеру'
}

export const CHAT_SOURCES = ['twitch', 'youtube', 'vk', 'kick', 'goodgame'] as const
/** Чьим цветом красится событие: площадка или сервис доната. */
export const COLOR_KEYS = ['twitch', 'youtube', 'vk', 'kick', 'goodgame', 'donationalerts', 'donatepay', 'donatex', 'boosty', 'hub'] as const
export type ColorKey = (typeof COLOR_KEYS)[number]
export const COLOR_LABEL: Record<ColorKey, string> = {
  twitch: 'Twitch', youtube: 'YouTube', vk: 'VK Видео', kick: 'Kick', goodgame: 'GoodGame', donationalerts: 'DonationAlerts',
  donatepay: 'DonatePay', donatex: 'DonateX', boosty: 'Boosty', hub: 'Ручные донаты'
}
export const DEFAULT_COLORS: Record<ColorKey, string> = {
  twitch: '#9146ff', youtube: '#ff3355', vk: '#2f7dff', kick: '#53fc18', goodgame: '#7d9cff', donationalerts: '#f57d07',
  donatepay: '#2fbf71', donatex: '#ff4f8b', boosty: '#f15f2c', hub: '#ffb27a'
}

/** Роли зрителей, которые можно выделять в ленте (если площадка их сообщает). */
export const CHAT_ROLES = ['broadcaster', 'mod', 'vip', 'sub'] as const
export type ChatRole = (typeof CHAT_ROLES)[number]
export const ROLE_LABEL: Record<ChatRole, string> = { broadcaster: 'Стример', mod: 'Модераторы', vip: 'VIP', sub: 'Подписчики' }
export const DEFAULT_ROLE_COLORS: Record<ChatRole, string> = { broadcaster: '#ff5c5c', mod: '#2fbf71', vip: '#e05cff', sub: '#ffb24a' }

export const LINK_MODES = ['show', 'mask', 'hide'] as const
export const LINK_LABEL: Record<(typeof LINK_MODES)[number], string> = { show: 'Показывать', mask: 'Заменять на «[ссылка]»', hide: 'Скрывать сообщение' }
export const LAYOUTS = ['inline', 'stacked'] as const
export const LAYOUT_LABEL: Record<(typeof LAYOUTS)[number], string> = { inline: 'В одну строку', stacked: 'Ник над сообщением' }
export const ALIGNS = ['stretch', 'left', 'right'] as const
export const ALIGN_LABEL: Record<(typeof ALIGNS)[number], string> = { stretch: 'На всю ширину', left: 'По левому краю', right: 'По правому краю' }
/** Как в аналитике: известные боты, чьи сообщения обычно не нужны на экране. */
export const DEFAULT_BOTS = 'nightbot, streamelements, streamlabs, moobot, fossabot, wizebot, botrix, kicklet, kickbot'

export interface ChatFilter {
  /** Ники через запятую или пробел — их сообщения не показываются. */
  bots: string
  /** Скрывать команды (сообщения, которые начинаются с «!»). */
  commands: boolean
  links: (typeof LINK_MODES)[number]
  /** Слова через запятую — сообщение с любым из них не показывается. */
  words: string
}

export interface TextStyle {
  font: ChatFont
  /** px; 0 — как основной размер шрифта. */
  size: number
  weight: 400 | 600 | 800
  italic: boolean
  upper: boolean
  /** '' — цвет по умолчанию (у ника — цвет из чата площадки). */
  color: string
  /** Межбуквенный интервал, px. */
  letter: number
  /** Высота строки, % от размера. */
  line: number
  /** Обводка, px (0 — нет). */
  stroke: number
  strokeColor: string
  /** Размытие тени, px (0 — нет). */
  shadow: number
  shadowColor: string
}

export interface ChatLook {
  animIn: (typeof ANIM_IN)[number]
  animOut: (typeof ANIM_OUT)[number]
  animMs: number
  /** Вертикальный чат: новые сообщения сверху (по умолчанию — снизу). */
  newestTop: boolean
  gap: number
  radius: number
  bg: (typeof BG_STYLES)[number]
  /** Непрозрачность подложки, %. */
  opacity: number
  /** Значок площадки: цветная точка или короткая подпись (Tw, YT). */
  plat: 'dot' | 'tag'
  showName: boolean
  /** Знак после ника. */
  sep: string
  showEmotes: boolean
  /** Размер смайлов, % от строки. */
  emoteScale: number
  /** Чьи чаты показывать; пусто — все подключённые. */
  platforms: string[]
  events: Record<ChatEventKind, boolean>
  highlight: (typeof HIGHLIGHTS)[number]
  colors: Record<ColorKey, string>
  textMode: 'all' | 'split'
  /** Ник отдельной строкой над текстом или всё в одну строку. */
  layout: (typeof LAYOUTS)[number]
  /** Сообщения на всю ширину или по размеру текста у левого/правого края (вертикальный чат и поверх игры). */
  align: (typeof ALIGNS)[number]
  /** Свой цвет подложки; '' — цвет темы. */
  bgColor: string
  /** Время (ЧЧ:ММ) перед сообщением. */
  time: boolean
  /** Сообщение только из смайлов показывать крупно. */
  bigEmotes: boolean
  /** Размер крупных смайлов, % от строки. */
  bigEmoteScale: number
  roles: Record<ChatRole, boolean>
  roleColors: Record<ChatRole, string>
  /** Как выделять сообщения выбранных ролей. */
  roleHl: (typeof HIGHLIGHTS)[number]
  filter: ChatFilter
  text: TextStyle
  name: TextStyle
  msg: TextStyle
  event: TextStyle
}

export const textDefaults = (over: Partial<TextStyle> = {}): TextStyle => ({
  font: 'manrope', size: 0, weight: 600, italic: false, upper: false, color: '', letter: 0, line: 135,
  stroke: 0, strokeColor: '#000000', shadow: 0, shadowColor: '#000000', ...over
})

export const lookDefaults = (over: Partial<ChatLook> = {}): ChatLook => ({
  animIn: 'slide', animOut: 'fade', animMs: 300, newestTop: false, gap: 8, radius: 14, bg: 'card', opacity: 72,
  plat: 'dot', showName: true, sep: ':', showEmotes: true, emoteScale: 160, platforms: [],
  events: { donation: true, follow: true, sub: true, gift: true, raid: true, bits: true, reward: true, mention: true },
  highlight: 'fill', colors: { ...DEFAULT_COLORS }, textMode: 'all',
  layout: 'inline', align: 'stretch', bgColor: '', time: false, bigEmotes: true, bigEmoteScale: 300,
  roles: { broadcaster: false, mod: false, vip: false, sub: false }, roleColors: { ...DEFAULT_ROLE_COLORS }, roleHl: 'bar',
  filter: { bots: DEFAULT_BOTS, commands: false, links: 'show', words: '' },
  text: textDefaults(), name: textDefaults({ weight: 800 }), msg: textDefaults(), event: textDefaults({ weight: 800, size: 0 }),
  ...over
})

// ---------- Проверка ----------

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const int = (v: unknown, d: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d)
const hex = (v: unknown, d: string, allowEmpty = false): string =>
  typeof v === 'string' && (/^#[0-9a-fA-F]{6}$/.test(v) || (allowEmpty && v === '')) ? v.toLowerCase() : d

export function sanitizeText(v: unknown, d: TextStyle): TextStyle {
  const o = obj(v)
  const w = o.weight === 400 || o.weight === 600 || o.weight === 800 ? o.weight : d.weight
  return {
    font: oneOf(o.font, CHAT_FONTS, d.font), size: int(o.size, d.size, 0, 96), weight: w, italic: bool(o.italic, d.italic), upper: bool(o.upper, d.upper),
    color: hex(o.color, d.color, true), letter: int(o.letter, d.letter, -2, 20), line: int(o.line, d.line, 90, 220),
    stroke: int(o.stroke, d.stroke, 0, 8), strokeColor: hex(o.strokeColor, d.strokeColor), shadow: int(o.shadow, d.shadow, 0, 30), shadowColor: hex(o.shadowColor, d.shadowColor)
  }
}

export function sanitizeLook(v: unknown, d: ChatLook): ChatLook {
  const o = obj(v)
  const ev = obj(o.events)
  const events = {} as Record<ChatEventKind, boolean>
  for (const k of CHAT_EVENTS) events[k] = bool(ev[k], d.events[k])
  const co = obj(o.colors)
  const colors = {} as Record<ColorKey, string>
  for (const k of COLOR_KEYS) colors[k] = hex(co[k], d.colors[k] ?? DEFAULT_COLORS[k])
  const ro = obj(o.roles)
  const rc = obj(o.roleColors)
  const roles = {} as Record<ChatRole, boolean>
  const roleColors = {} as Record<ChatRole, string>
  for (const k of CHAT_ROLES) { roles[k] = bool(ro[k], d.roles[k]); roleColors[k] = hex(rc[k], d.roleColors[k] ?? DEFAULT_ROLE_COLORS[k]) }
  const fo = obj(o.filter)
  const list = (v: unknown, def: string): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 2000) : def)
  const filter: ChatFilter = { bots: list(fo.bots, d.filter.bots), commands: bool(fo.commands, d.filter.commands), links: oneOf(fo.links, LINK_MODES, d.filter.links), words: list(fo.words, d.filter.words) }
  const platforms = Array.isArray(o.platforms)
    ? [...new Set(o.platforms.filter((p): p is string => typeof p === 'string' && (CHAT_SOURCES as readonly string[]).includes(p)))]
    : d.platforms
  return {
    animIn: oneOf(o.animIn, ANIM_IN, d.animIn), animOut: oneOf(o.animOut, ANIM_OUT, d.animOut), animMs: int(o.animMs, d.animMs, 100, 2000),
    newestTop: bool(o.newestTop, d.newestTop), gap: int(o.gap, d.gap, 0, 40), radius: int(o.radius, d.radius, 0, 30),
    bg: oneOf(o.bg, BG_STYLES, d.bg), opacity: int(o.opacity, d.opacity, 0, 100),
    plat: o.plat === 'dot' || o.plat === 'tag' ? o.plat : d.plat, showName: bool(o.showName, d.showName),
    sep: typeof o.sep === 'string' ? o.sep.replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, 4) : d.sep,
    showEmotes: bool(o.showEmotes, d.showEmotes), emoteScale: int(o.emoteScale, d.emoteScale, 50, 300), platforms, events,
    highlight: oneOf(o.highlight, HIGHLIGHTS, d.highlight), colors, textMode: o.textMode === 'split' || o.textMode === 'all' ? o.textMode : d.textMode,
    layout: oneOf(o.layout, LAYOUTS, d.layout), align: oneOf(o.align, ALIGNS, d.align), bgColor: hex(o.bgColor, d.bgColor, true), time: bool(o.time, d.time),
    bigEmotes: bool(o.bigEmotes, d.bigEmotes), bigEmoteScale: int(o.bigEmoteScale, d.bigEmoteScale, 150, 600),
    roles, roleColors, roleHl: oneOf(o.roleHl, HIGHLIGHTS, d.roleHl), filter,
    text: sanitizeText(o.text, d.text), name: sanitizeText(o.name, d.name), msg: sanitizeText(o.msg, d.msg), event: sanitizeText(o.event, d.event)
  }
}

// ---------- Вид события в ленте ----------

export interface ChatEventView {
  kind: ChatEventKind
  icon: string
  label: string
  detail: string
  /** Текст под плашкой (сообщение зрителя). */
  body: string
  /** Ключ цвета: площадка или сервис доната. */
  color: ColorKey
}

const CUR: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€', UAH: '₴', KZT: '₸', BYN: 'Br' }
const money = (n: number | undefined, cur: string | undefined): string => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return ''
  const v = n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  const c = (cur || 'RUB').toUpperCase()
  return `${v} ${CUR[c] ?? c}`
}
const isColorKey = (p: string): p is ColorKey => (COLOR_KEYS as readonly string[]).includes(p)

/** Как событие выглядит в ленте чата; null — это не событие для чата. */
export function eventView(e: HubEvent): ChatEventView | null {
  const color: ColorKey = isColorKey(e.platform) ? e.platform : 'hub'
  const n = typeof e.amount === 'number' && Number.isFinite(e.amount) ? Math.round(e.amount) : 0
  const text = e.text ?? ''
  switch (e.type) {
    case 'donation': return { kind: 'donation', icon: '◆', label: e.manual ? 'Донат вручную' : 'Донат', detail: money(e.amount, e.currency), body: text, color }
    case 'follow': return { kind: 'follow', icon: '♥', label: 'Новый фолловер', detail: '', body: '', color }
    case 'sub': return { kind: 'sub', icon: '★', label: 'Подписка', detail: '', body: text, color }
    case 'gift': return { kind: 'gift', icon: '✚', label: 'Дарит подписки', detail: n ? `× ${n}` : '', body: '', color }
    case 'raid': return { kind: 'raid', icon: '➜', label: 'Рейд', detail: n ? `${n} зрителей` : '', body: '', color }
    case 'bits': return { kind: 'bits', icon: '◇', label: 'Биты', detail: n ? String(n) : '', body: text.replace(/^cheer\d+\s*/i, ''), color }
    case 'reward': {
      const name = e.reward ?? ''
      const body = name && text.startsWith(name) ? text.slice(name.length).replace(/^\s*—\s*/, '') : text
      return { kind: 'reward', icon: '✦', label: 'Награда', detail: name, body, color }
    }
    default: return null
  }
}

/** Обращение к стримеру: «@ник» или ник отдельным словом. */
export function isMention(text: string, own: string[]): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е')
  return own.some((o) => {
    const n = o.toLowerCase().replace(/ё/g, 'е').replace(/^@/, '')
    if (n.length < 2) return false
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^\\p{L}\\p{N}_])@?${esc}($|[^\\p{L}\\p{N}_])`, 'u').test(t)
  })
}

// ---------- Фильтры (та же логика повторена в overlays/chat.js: оверлей — обычный JS без сборки) ----------

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е')
export const wordList = (s: string): string[] => norm(s).split(/[\s,;]+/).map((w) => w.replace(/^@/, '')).filter(Boolean)
const LINK_SRC = String.raw`(?:https?:\/\/|www\.)\S+|[\p{L}\p{N}-]+\.(?:ru|com|net|org|tv|gg|io|me|рф|su|xyz|info|ly|be|link|app|dev)(?:\/\S*)?`
export const hasLink = (t: string): boolean => new RegExp(LINK_SRC, 'iu').test(t)
export const maskLinks = (t: string): string => t.replace(new RegExp(LINK_SRC, 'giu'), '[ссылка]')

/** Скрыть сообщение чата по фильтрам (боты, команды, ссылки, слова). События не фильтруются. */
export function chatHidden(look: ChatLook, e: Pick<HubEvent, 'type' | 'user' | 'text'>): boolean {
  if (e.type !== 'message') return false
  const f = look.filter
  if (wordList(f.bots).includes(norm(e.user))) return true
  const text = e.text ?? ''
  if (f.commands && /^\s*!/.test(text)) return true
  if (f.links === 'hide' && hasLink(text)) return true
  const words = wordList(f.words)
  if (words.length) { const t = norm(text); if (words.some((w) => t.includes(w))) return true }
  return false
}

/** Сообщение только из смайлов (пробелы между ними не в счёт). */
export function emoteOnly(e: Pick<HubEvent, 'parts'>): boolean {
  const p = e.parts ?? []
  return p.some((x) => x.t === 'emote') && p.every((x) => x.t === 'emote' || !x.v.trim())
}

// ---------- CSS ----------

const THEMES = `
{R}.t-general { --fg:#ffffff; --muted:#c8c8d0; --cardrgb:16,16,20; --edge:rgba(255,255,255,.10); --accent:#8e7dff; --accentf:#8e7dff4d; }
{R}.t-campfire { --fg:#f3e9e2; --muted:#b9a69b; --cardrgb:26,19,17; --edge:#9a3fd6; --accent:#ffb27a; --accentf:#ffb27a4d; }`

function rgb(h: string): string {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',')
}

/** Светлый цвет: белый текст на нём не читается (повторено в overlays/chat.js). */
export function isLight(h: string): boolean {
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return false
  const [r, g, b] = rgb(h).split(',').map(Number)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6
}

/** Выделение строки цветом c (событие, упоминание, роль). */
function hlCss(kind: (typeof HIGHLIGHTS)[number], c: string, cf: string, op: number): string {
  const fill = `background-color:rgba(var(--cardrgb),${Math.max(op, 0.55)}); background-image:linear-gradient(${cf},${cf})`
  switch (kind) {
    case 'frame': return `box-shadow:inset 0 0 0 2px ${c}`
    case 'fill': return fill
    case 'both': return `box-shadow:inset 0 0 0 2px ${c}; ${fill}`
    case 'bar': return `box-shadow:inset 4px 0 0 ${c}; padding-left:calc(.75em + 4px)`
    default: return ''
  }
}

function textCss(t: TextStyle, base: number, nameColor = false): string {
  const out: string[] = [`font-family:${FONT_CSS[t.font]}`, `font-weight:${t.weight}`, `font-style:${t.italic ? 'italic' : 'normal'}`,
    `text-transform:${t.upper ? 'uppercase' : 'none'}`, `letter-spacing:${t.letter}px`, `line-height:${t.line / 100}`]
  if (t.size > 0) out.push(`font-size:${t.size}px`)
  else out.push(`font-size:${base}px`)
  if (t.color && !nameColor) out.push(`color:${t.color}`)
  if (t.stroke > 0) out.push(`-webkit-text-stroke:${t.stroke}px ${t.strokeColor}`, 'paint-order:stroke fill')
  else out.push('-webkit-text-stroke:0')
  out.push(t.shadow > 0 ? `text-shadow:0 1px ${t.shadow}px ${t.shadowColor}, 0 0 ${Math.round(t.shadow / 2)}px ${t.shadowColor}` : 'text-shadow:none')
  return out.join(';')
}

/**
 * CSS ленты чата. root — корень (в OBS — body, в предпросмотре — контейнер), mode: v — колонка, h — строка, f — поверх игры.
 * Все значения уже проверены sanitizeLook, поэтому в CSS попадают только числа, цвета #rrggbb и шрифты из списка.
 */
export function chatCss(look: ChatLook, fontSize: number, root: string, mode: 'v' | 'h' | 'f'): string {
  const R = root
  const ms = look.animMs
  const op = look.opacity / 100
  const bg = look.bg === 'plain' ? 'transparent' : `rgba(var(--cardrgb),${op})`
  const edge = look.bg === 'card' && look.opacity > 0 ? 'box-shadow:0 0 0 1.5px var(--edge)' : 'box-shadow:none'
  const radius = look.bg === 'strip' ? Math.min(look.radius, 4) : look.radius
  const pad = look.bg === 'plain' ? '.15em .2em' : '.45em .75em'
  const slideFrom = mode === 'h' ? 'translateX(-24px)' : look.newestTop ? 'translateY(-14px)' : 'translateY(14px)'
  const css: string[] = [THEMES.replace(/\{R\}/g, R)]
  css.push(`${R} { --fs:${fontSize}px; color:var(--fg); }`)
  if (look.bgColor) {
    // На светлой подложке приглушённый цвет темы (время, разделитель) почти не виден.
    const light = look.bg !== 'plain' && isLight(look.bgColor)
    css.push(`${R} .msg { --cardrgb:${rgb(look.bgColor)};${light ? ' --muted:rgba(20,20,24,.55); --edge:rgba(0,0,0,.12);' : ''} }`)
  }
  css.push(`${R} .msg { position:relative; padding:${pad}; border-radius:${radius}px; background:${bg}; ${edge}; overflow-wrap:anywhere; animation:cx-in ${ms}ms ease both; }`)
  if (look.bg === 'strip') css.push(`${R} .msg { border-radius:${radius}px; }`)
  css.push(`${R} .msg.gone { animation:cx-out ${ms}ms ease forwards; }`)
  css.push(`${R} .msg.still { animation:none; }`)
  css.push(`${R} #list, ${R} .cx-list { gap:${look.gap}px; }`)
  if (mode !== 'h' && look.align !== 'stretch') {
    css.push(`${R} #list, ${R} .cx-list { align-items:${look.align === 'left' ? 'flex-start' : 'flex-end'}; }`)
    css.push(`${R} .msg { max-width:100%; }`)
    if (look.align === 'right') css.push(`${R} .msg { text-align:right; } ${R} .ev-head { justify-content:flex-end; }`)
  }
  if (mode !== 'h' && look.layout === 'stacked') {
    css.push(`${R} .msg:not(.ev):not(.system) > .text { display:block; margin-top:.1em; }`)
    css.push(`${R} .msg:not(.ev) .sep { display:none; }`)
  }
  css.push(`${R} .time { color:var(--muted); font-size:.75em; font-weight:600; margin-right:.45em; font-variant-numeric:tabular-nums; }`)
  css.push(`${R} .msg.emo-only .emote { height:${(look.bigEmoteScale / 100).toFixed(2)}em; margin:.05em .08em; }`)
  // Текст
  if (look.textMode === 'all') {
    css.push(`${R} .msg { ${textCss(look.text, fontSize)} }`)
    css.push(`${R} .msg .name { font-weight:${Math.max(look.text.weight, 800)}; }`)
  } else {
    css.push(`${R} .msg { ${textCss(look.msg, fontSize)} }`)
    css.push(`${R} .msg .name { ${textCss(look.name, fontSize, true)} }`)
    if (look.name.color) css.push(`${R} .msg .name.fixed { color:${look.name.color} !important; }`)
    css.push(`${R} .msg .ev-head { ${textCss(look.event, fontSize)} }`)
  }
  css.push(`${R} .sep { color:var(--muted); margin-right:.3em; }`)
  css.push(`${R} .name { margin-right:0; }`)
  css.push(`${R} .name.nosep { margin-right:.35em; }`)
  css.push(`${R} .emote { height:${(look.emoteScale / 100).toFixed(2)}em; vertical-align:middle; margin:-.25em .05em; }`)
  css.push(`${R} .badge { height:1em; vertical-align:-.12em; margin-right:.25em; }`)
  // Значок площадки
  if (look.plat === 'dot') css.push(`${R} .plat { display:inline-block; width:.55em; height:.55em; border-radius:50%; margin-right:.4em; vertical-align:.12em; background:var(--pc); }`)
  else css.push(`${R} .plat { display:inline-block; padding:.05em .4em; border-radius:.35em; margin-right:.4em; font:800 .62em/1.5 'Manrope',sans-serif; color:#fff; vertical-align:.18em; background:var(--pc); text-shadow:none; -webkit-text-stroke:0; letter-spacing:.02em; text-transform:none; font-style:normal; }`)
  // События
  css.push(`${R} .ev-head { display:flex; align-items:baseline; flex-wrap:wrap; gap:.15em .45em; }`)
  css.push(`${R} .ev-label { color:var(--ec); }`)
  css.push(`${R} .ev-detail { opacity:.9; }`)
  css.push(`${R} .ev-body { margin-top:.2em; }`)
  // Роли — раньше событий и упоминаний: при совпадении выделение упоминания важнее.
  if (look.roleHl !== 'none') {
    for (const r of CHAT_ROLES) {
      if (!look.roles[r]) continue
      const c = look.roleColors[r]
      css.push(`${R} .msg.role-${r} { ${hlCss(look.roleHl, c, c + '33', op)}; }`)
    }
  }
  if (look.highlight !== 'none') css.push(`${R} .msg.ev, ${R} .msg.mention { ${hlCss(look.highlight, 'var(--ec)', 'var(--ecf)', op)}; }`)
  css.push(`${R} .msg.mention { --ec:var(--accent); --ecf:var(--accentf); }`)
  css.push(`${R} .msg.system { color:#ffb24a; font-size:.85em; }`)
  // Анимации
  const inKf: Record<string, string> = {
    none: 'from{} to{}',
    fade: 'from{opacity:0}',
    slide: `from{opacity:0;transform:${slideFrom}}`,
    pop: 'from{opacity:0;transform:scale(.7)} 70%{transform:scale(1.04)}',
    blur: 'from{opacity:0;filter:blur(8px)}',
    bounce: `from{opacity:0;transform:translateY(${mode === 'h' ? 0 : 20}px)} 60%{opacity:1;transform:translateY(-5px)} 80%{transform:translateY(2px)}`
  }
  const outKf: Record<string, string> = {
    none: 'to{opacity:0}',
    fade: 'to{opacity:0}',
    slide: `to{opacity:0;transform:${mode === 'h' ? 'translateX(24px)' : 'translateX(-30px)'}}`,
    shrink: 'to{opacity:0;transform:scale(.8)}'
  }
  css.push(`@keyframes cx-in { ${inKf[look.animIn]} }`)
  css.push(`@keyframes cx-out { ${outKf[look.animOut]} }`)
  if (look.animIn === 'none') css.push(`${R} .msg { animation:none; }`)
  if (look.animOut === 'none') css.push(`${R} .msg.gone { animation-duration:1ms; }`)
  return css.join('\n')
}

// ---------- Тестовые сообщения (предпросмотр и «Тест в OBS») ----------

const NAMES = ['pixel_fox', 'night_raven', 'Ёжик_в_тумане', 'kotleta228', 'SashaPlays', 'lumen', 'moroz_ivan', 'crow_ru', 'tihiy_omut', 'Bublik', 'Marisha', 'old_gamer']
const TEXTS = ['всем привет у костра!', 'го ещё катку', 'это было мощно', 'ахахах', 'а что за игра?', 'стример, ты лучший', 'звук отличный сегодня', 'лол', 'как прошёл день?', 'GG', 'давай босса', 'я с работы, всем привет']
const COLORS = ['#ff7a90', '#7ad3ff', '#ffd27a', '#a8ff7a', '#d17aff', '#ffb27a']

/** i-е тестовое событие ленты: в основном сообщения, иногда донат, подписка, рейд, упоминание. */
export function sampleChat(i: number, own: string): HubEvent {
  const plat = CHAT_SOURCES[i % CHAT_SOURCES.length] as Platform
  const user = NAMES[(i * 7) % NAMES.length]
  const base = { id: `cxtest-${Date.now()}-${i}`, ts: Date.now(), platform: plat, user, test: true }
  const k = i % 11
  const role = (['mod', undefined, 'sub', 'vip', undefined, 'sub', undefined] as const)[i % 7]
  if (k === 3) return { ...base, platform: 'donationalerts', type: 'donation', amount: [100, 300, 500, 1500][i % 4], currency: 'RUB', amountRub: 500, text: 'Спасибо за стрим!' }
  if (k === 6) return { ...base, platform: 'twitch', type: 'sub', text: `${(i % 12) + 1} мес. вместе` }
  if (k === 8) return { ...base, type: 'message', text: `@${own} ${TEXTS[i % TEXTS.length]}`, parts: [{ t: 'text', v: `@${own} ${TEXTS[i % TEXTS.length]}` }], color: COLORS[i % COLORS.length] }
  if (k === 9) return { ...base, platform: 'twitch', type: 'raid', amount: 40 + i, text: `${40 + i} зрителей` }
  if (k === 10) return { ...base, platform: 'twitch', type: 'reward', reward: 'Заказ трека', text: 'Заказ трека — Кино, Группа крови' }
  if (k === 1) { const t = 'глянь клип twitch.tv/clip/abc'; return { ...base, type: 'message', text: t, parts: [{ t: 'text', v: t }], color: COLORS[i % COLORS.length], role } }
  if (k === 5) { const t = '!команды — список в описании'; return { ...base, user: 'Nightbot', type: 'message', text: t, parts: [{ t: 'text', v: t }], color: '#7d7d7d' } }
  const t = TEXTS[(i * 5) % TEXTS.length]
  return { ...base, type: 'message', text: t, parts: [{ t: 'text', v: t }], color: COLORS[i % COLORS.length], role }
}

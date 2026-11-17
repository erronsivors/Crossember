// Настройки разделов второй волны: очки зрителей, бот, ставки, награды, музыка, модераторы, сабатон.
// Без node-импортов: интерфейс берёт отсюда значения по умолчанию и ограничения.
import { KEYS_DEFAULTS, sanitizeKeys, type KeysOverlaySettings } from './keyslayout'
import { VIZ_DEFAULTS, sanitizeViz, type VizSettings } from './viz'

export type Access = 'all' | 'sub' | 'vip' | 'mod'
export const ACCESS_LABEL: Record<Access, string> = { all: 'Все', sub: 'Подписчики и выше', vip: 'VIP и выше', mod: 'Модераторы' }

/** Очки зрителей Crossember: копятся на всех площадках, тратятся в боте, ставках, голосовании и заказе треков. */
export interface PointsSettings {
  enabled: boolean
  /** Название валюты во множественном числе: «угольки». */
  name: string
  /** За сообщение в чате (не чаще раза в messageCooldownSec). */
  perMessage: number
  messageCooldownSec: number
  /** Каждую минуту эфира — тем, кто писал в чат за последние activeMin минут. */
  perMinute: number
  activeMin: number
  /** Twitch: начислять и молчащим зрителям из списка чата (нужно право moderator:read:chatters). */
  twitchLurkers: boolean
  /** За каждый 1 ₽ доната. */
  perRub: number
  perFollow: number
  perSub: number
  /** За каждую подаренную подписку. */
  perGift: number
  /** Тому, кто пришёл рейдом (за рейд целиком). */
  perRaid: number
  /** За каждые 100 битов. */
  perBits100: number
  /** Сообщения и минуты считаются только во время эфира. */
  onlyLive: boolean
  /** Сколько очков у нового зрителя. */
  startBalance: number
}

export interface BotCommand {
  id: string
  /** «!дс» — с префиксом, без пробелов. */
  trigger: string
  aliases: string[]
  response: string
  cooldownSec: number
  userCooldownSec: number
  access: Access
  /** Цена в очках зрителей (0 — бесплатно). */
  cost: number
  enabled: boolean
}

export interface BotTimer {
  id: string
  text: string
  everyMin: number
  /** Сколько сообщений чата должно пройти с прошлого раза (чтобы не писать в пустоту). */
  minMessages: number
  enabled: boolean
}

export interface BotSettings {
  enabled: boolean
  commands: BotCommand[]
  timers: BotTimer[]
  /** Встроенные команды; пустая строка — выключена. */
  balanceCmd: string
  topCmd: string
  giveCmd: string
  gambleCmd: string
  duelCmd: string
  uptimeCmd: string
  listCmd: string
  /** Шанс выигрыша в рулетке, %. */
  gambleChance: number
  gambleMin: number
  gambleMax: number
  gambleCooldownSec: number
  /** Сколько секунд ждать «!принять» в дуэли. */
  duelSec: number
}

/** Ставки (прогнозы): свои очки со всех площадок или родной прогноз Twitch. */
export interface BetsSettings {
  cmd: string
  minBet: number
  maxBet: number
  /** Приём ставок по умолчанию, секунд. */
  defaultSec: number
  announce: boolean
  startText: string
  lockText: string
  winText: string
}

/** Награды за баллы канала Twitch. Действия наград хранятся в rewards.v1. */
export interface RewardsSettings {
  /** Возвращать баллы, если действие награды не удалось (только наградам Crossember). */
  refundOnFail: boolean
}

export interface MusicSettings {
  /** Client ID своего приложения Spotify (developer.spotify.com). */
  spotifyClientId: string
  /** Следить за любым плеером Windows (Яндекс Музыка, браузер) через медиа-кнопки. */
  smtc: boolean
  /** Какой источник показывать в «Сейчас играет»: Spotify, плеер Windows или кто играет. */
  nowSource: 'auto' | 'spotify' | 'smtc'
  requests: boolean
  requestCmd: string
  nowCmd: string
  /** Цена заказа в очках зрителей (0 — бесплатно). */
  requestCost: number
  requestAccess: Access
  maxPerUser: number
  maxDurationMin: number
  cooldownSec: number
  /** Запрещённые слова в названии и исполнителе, через запятую. */
  blocked: string
}

/** Режим модератора: команды в чате и пульт в домашней сети. */
export interface ModSettings {
  enabled: boolean
  /** Пустая строка — команда выключена. */
  skipAlertCmd: string
  pauseAlertsCmd: string
  resumeAlertsCmd: string
  skipTrackCmd: string
  pointsAddCmd: string
  pointsTakeCmd: string
  betLockCmd: string
  betWinCmd: string
  betCancelCmd: string
  titleCmd: string
  gameCmd: string
  /** VIP тоже считаются модераторами для этих команд. */
  vipAsMod: boolean
  /** Пульт модератора в домашней сети (отдельный ключ). */
  web: boolean
}

export interface SubathonSettings {
  startMin: number
  perSubSec: number
  perGiftSec: number
  perFollowSec: number
  /** За каждые 100 ₽ доната. */
  perRub100Sec: number
  perBits100Sec: number
  perRaidSec: number
  /** Таймер не может быть больше стольких часов (0 — без предела). */
  maxHours: number
  /** Множитель «счастливого часа». */
  multiplier: number
}

export interface ExtSettings {
  points: PointsSettings
  bot: BotSettings
  bets: BetsSettings
  rewards: RewardsSettings
  music: MusicSettings
  mod: ModSettings
  subathon: SubathonSettings
}

export const EXT_DEFAULTS: ExtSettings = {
  points: {
    enabled: true, name: 'угольки', perMessage: 5, messageCooldownSec: 60, perMinute: 1, activeMin: 10, twitchLurkers: true,
    perRub: 1, perFollow: 50, perSub: 500, perGift: 300, perRaid: 200, perBits100: 50, onlyLive: true, startBalance: 0
  },
  bot: {
    enabled: true,
    commands: [
      { id: 'c-hello', trigger: '!привет', aliases: [], response: 'Привет, {user}! Устраивайся у костра 🔥', cooldownSec: 10, userCooldownSec: 60, access: 'all', cost: 0, enabled: true }
    ],
    timers: [],
    balanceCmd: '!очки', topCmd: '!топ', giveCmd: '!передать', gambleCmd: '!рулетка', duelCmd: '!дуэль', uptimeCmd: '!аптайм', listCmd: '!команды',
    gambleChance: 45, gambleMin: 10, gambleMax: 10000, gambleCooldownSec: 30, duelSec: 60
  },
  bets: {
    cmd: '!ставка', minBet: 10, maxBet: 100000, defaultSec: 120, announce: true,
    startText: 'Ставки: {вопрос} {исходы} — пишите {команда} номер сумма', lockText: 'Ставки закрыты! В банке {банк}.', winText: 'Итог «{вопрос}»: {исход}. Выиграли: {победители}'
  },
  rewards: { refundOnFail: true },
  music: {
    spotifyClientId: '', smtc: true, nowSource: 'auto', requests: false, requestCmd: '!трек', nowCmd: '!песня', requestCost: 0, requestAccess: 'all',
    maxPerUser: 2, maxDurationMin: 8, cooldownSec: 60, blocked: ''
  },
  mod: {
    enabled: true, skipAlertCmd: '!скипалерт', pauseAlertsCmd: '!паузаалерты', resumeAlertsCmd: '!алерты', skipTrackCmd: '!скип',
    pointsAddCmd: '!выдать', pointsTakeCmd: '!забрать', betLockCmd: '!закрытьставки', betWinCmd: '!итог', betCancelCmd: '!отменаставок',
    titleCmd: '!название', gameCmd: '!игра', vipAsMod: false, web: false
  },
  subathon: { startMin: 120, perSubSec: 300, perGiftSec: 300, perFollowSec: 10, perRub100Sec: 60, perBits100Sec: 60, perRaidSec: 120, maxHours: 0, multiplier: 2 }
}

/** Оверлеи второй волны. */
export interface ExtOverlays {
  bets: { theme: 'general' | 'campfire'; fontSize: number; showTop: boolean }
  music: { theme: 'general' | 'campfire'; fontSize: number; showRequester: boolean; showProgress: boolean; hideWhenPaused: boolean }
  subathon: { theme: 'general' | 'campfire'; fontSize: number; showAdds: boolean }
  keys: KeysOverlaySettings
  viz: VizSettings
}

export const EXT_OVERLAY_DEFAULTS: ExtOverlays = {
  bets: { theme: 'general', fontSize: 24, showTop: true },
  music: { theme: 'general', fontSize: 22, showRequester: true, showProgress: true, hideWhenPaused: true },
  subathon: { theme: 'general', fontSize: 64, showAdds: true },
  keys: KEYS_DEFAULTS,
  viz: VIZ_DEFAULTS
}

// ---------- проверка ----------

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const int = (v: unknown, d: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d
const text = (v: unknown, d: string, max = 80): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : d)
const theme = (v: unknown, d: 'general' | 'campfire'): 'general' | 'campfire' => (v === 'general' || v === 'campfire' ? v : d)
const access = (v: unknown, d: Access): Access => (v === 'all' || v === 'sub' || v === 'vip' || v === 'mod' ? v : d)
const id = (v: unknown, fallback: string): string => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : fallback)

/** Команда чата: одно слово в нижнем регистре; пусто — выключена. Слово без «!» дополняется им. */
export function cleanCmd(v: unknown, d: string): string {
  if (typeof v !== 'string') return d
  const x = v.trim().toLowerCase().replace(/\s+/g, '')
  if (!x) return ''
  const c = /^[!#.?$%&*+~]/.test(x) ? x : `!${x}`
  return c.length <= 30 ? c : d
}

function command(v: unknown, i: number): BotCommand | null {
  const o = obj(v)
  const trigger = cleanCmd(o.trigger, '')
  if (!trigger) return null
  const aliases = (Array.isArray(o.aliases) ? o.aliases : []).map((a) => cleanCmd(a, '')).filter((a) => a && a !== trigger).slice(0, 5)
  return {
    id: id(o.id, `c-${i}-${trigger.slice(1, 12).replace(/[^\w]/g, '') || 'cmd'}`),
    trigger,
    aliases: [...new Set(aliases)],
    response: text(o.response, '', 450),
    cooldownSec: int(o.cooldownSec, 5, 0, 86_400),
    userCooldownSec: int(o.userCooldownSec, 0, 0, 86_400),
    access: access(o.access, 'all'),
    cost: int(o.cost, 0, 0, 10_000_000),
    enabled: bool(o.enabled, true)
  }
}

function timer(v: unknown, i: number): BotTimer | null {
  const o = obj(v)
  const t = text(o.text, '', 450).trim()
  if (!t) return null
  return { id: id(o.id, `t-${i}`), text: t, everyMin: int(o.everyMin, 15, 1, 1440), minMessages: int(o.minMessages, 5, 0, 1000), enabled: bool(o.enabled, true) }
}

export function sanitizeExt(input: Record<string, unknown>, base: ExtSettings): ExtSettings {
  const b = { ...EXT_DEFAULTS, ...base }
  const p = obj(input.points)
  const pb = b.points ?? EXT_DEFAULTS.points
  const bo = obj(input.bot)
  const bb = b.bot ?? EXT_DEFAULTS.bot
  const be = obj(input.bets)
  const beb = b.bets ?? EXT_DEFAULTS.bets
  const mu = obj(input.music)
  const mub = b.music ?? EXT_DEFAULTS.music
  const mo = obj(input.mod)
  const mob = b.mod ?? EXT_DEFAULTS.mod
  const su = obj(input.subathon)
  const sub = b.subathon ?? EXT_DEFAULTS.subathon
  const cmds = Array.isArray(bo.commands) ? bo.commands.slice(0, 200).map(command).filter((c): c is BotCommand => !!c) : bb.commands
  const seen = new Set<string>()
  const commands = cmds.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
  const timers = Array.isArray(bo.timers) ? bo.timers.slice(0, 50).map(timer).filter((t): t is BotTimer => !!t) : bb.timers
  const clientId = typeof mu.spotifyClientId === 'string' ? mu.spotifyClientId.trim() : mub.spotifyClientId
  return {
    points: {
      enabled: bool(p.enabled, pb.enabled),
      name: text(p.name, pb.name, 24).trim() || EXT_DEFAULTS.points.name,
      perMessage: int(p.perMessage, pb.perMessage, 0, 100_000),
      messageCooldownSec: int(p.messageCooldownSec, pb.messageCooldownSec, 0, 3600),
      perMinute: int(p.perMinute, pb.perMinute, 0, 100_000),
      activeMin: int(p.activeMin, pb.activeMin, 1, 120),
      twitchLurkers: bool(p.twitchLurkers, pb.twitchLurkers),
      perRub: int(p.perRub, pb.perRub, 0, 100_000),
      perFollow: int(p.perFollow, pb.perFollow, 0, 1_000_000),
      perSub: int(p.perSub, pb.perSub, 0, 1_000_000),
      perGift: int(p.perGift, pb.perGift, 0, 1_000_000),
      perRaid: int(p.perRaid, pb.perRaid, 0, 1_000_000),
      perBits100: int(p.perBits100, pb.perBits100, 0, 1_000_000),
      onlyLive: bool(p.onlyLive, pb.onlyLive),
      startBalance: int(p.startBalance, pb.startBalance, 0, 1_000_000)
    },
    bot: {
      enabled: bool(bo.enabled, bb.enabled),
      commands,
      timers,
      balanceCmd: cleanCmd(bo.balanceCmd, bb.balanceCmd),
      topCmd: cleanCmd(bo.topCmd, bb.topCmd),
      giveCmd: cleanCmd(bo.giveCmd, bb.giveCmd),
      gambleCmd: cleanCmd(bo.gambleCmd, bb.gambleCmd),
      duelCmd: cleanCmd(bo.duelCmd, bb.duelCmd),
      uptimeCmd: cleanCmd(bo.uptimeCmd, bb.uptimeCmd),
      listCmd: cleanCmd(bo.listCmd, bb.listCmd),
      gambleChance: int(bo.gambleChance, bb.gambleChance, 1, 95),
      gambleMin: int(bo.gambleMin, bb.gambleMin, 1, 10_000_000),
      gambleMax: int(bo.gambleMax, bb.gambleMax, 1, 100_000_000),
      gambleCooldownSec: int(bo.gambleCooldownSec, bb.gambleCooldownSec, 0, 3600),
      duelSec: int(bo.duelSec, bb.duelSec, 10, 600)
    },
    bets: {
      cmd: cleanCmd(be.cmd, beb.cmd) || EXT_DEFAULTS.bets.cmd,
      minBet: int(be.minBet, beb.minBet, 1, 10_000_000),
      maxBet: int(be.maxBet, beb.maxBet, 1, 100_000_000),
      defaultSec: int(be.defaultSec, beb.defaultSec, 0, 86_400),
      announce: bool(be.announce, beb.announce),
      startText: text(be.startText, beb.startText, 300),
      lockText: text(be.lockText, beb.lockText, 300),
      winText: text(be.winText, beb.winText, 300)
    },
    rewards: { refundOnFail: bool(obj(input.rewards).refundOnFail, (b.rewards ?? EXT_DEFAULTS.rewards).refundOnFail) },
    music: {
      spotifyClientId: /^[a-f0-9]{0,64}$/i.test(clientId) ? clientId : mub.spotifyClientId,
      smtc: bool(mu.smtc, mub.smtc),
      nowSource: mu.nowSource === 'auto' || mu.nowSource === 'spotify' || mu.nowSource === 'smtc' ? mu.nowSource : mub.nowSource,
      requests: bool(mu.requests, mub.requests),
      requestCmd: cleanCmd(mu.requestCmd, mub.requestCmd),
      nowCmd: cleanCmd(mu.nowCmd, mub.nowCmd),
      requestCost: int(mu.requestCost, mub.requestCost, 0, 10_000_000),
      requestAccess: access(mu.requestAccess, mub.requestAccess),
      maxPerUser: int(mu.maxPerUser, mub.maxPerUser, 1, 50),
      maxDurationMin: int(mu.maxDurationMin, mub.maxDurationMin, 1, 60),
      cooldownSec: int(mu.cooldownSec, mub.cooldownSec, 0, 3600),
      blocked: text(mu.blocked, mub.blocked, 2000)
    },
    mod: {
      enabled: bool(mo.enabled, mob.enabled),
      skipAlertCmd: cleanCmd(mo.skipAlertCmd, mob.skipAlertCmd),
      pauseAlertsCmd: cleanCmd(mo.pauseAlertsCmd, mob.pauseAlertsCmd),
      resumeAlertsCmd: cleanCmd(mo.resumeAlertsCmd, mob.resumeAlertsCmd),
      skipTrackCmd: cleanCmd(mo.skipTrackCmd, mob.skipTrackCmd),
      pointsAddCmd: cleanCmd(mo.pointsAddCmd, mob.pointsAddCmd),
      pointsTakeCmd: cleanCmd(mo.pointsTakeCmd, mob.pointsTakeCmd),
      betLockCmd: cleanCmd(mo.betLockCmd, mob.betLockCmd),
      betWinCmd: cleanCmd(mo.betWinCmd, mob.betWinCmd),
      betCancelCmd: cleanCmd(mo.betCancelCmd, mob.betCancelCmd),
      titleCmd: cleanCmd(mo.titleCmd, mob.titleCmd),
      gameCmd: cleanCmd(mo.gameCmd, mob.gameCmd),
      vipAsMod: bool(mo.vipAsMod, mob.vipAsMod),
      web: bool(mo.web, mob.web)
    },
    subathon: {
      startMin: int(su.startMin, sub.startMin, 1, 100_000),
      perSubSec: int(su.perSubSec, sub.perSubSec, 0, 86_400),
      perGiftSec: int(su.perGiftSec, sub.perGiftSec, 0, 86_400),
      perFollowSec: int(su.perFollowSec, sub.perFollowSec, 0, 86_400),
      perRub100Sec: int(su.perRub100Sec, sub.perRub100Sec, 0, 86_400),
      perBits100Sec: int(su.perBits100Sec, sub.perBits100Sec, 0, 86_400),
      perRaidSec: int(su.perRaidSec, sub.perRaidSec, 0, 86_400),
      maxHours: int(su.maxHours, sub.maxHours, 0, 10_000),
      multiplier: int(su.multiplier, sub.multiplier, 1, 10)
    }
  }
}

export function sanitizeExtOverlays(input: Record<string, unknown>, base: Partial<ExtOverlays>): ExtOverlays {
  const bt = obj(input.bets)
  const btb = base.bets ?? EXT_OVERLAY_DEFAULTS.bets
  const m = obj(input.music)
  const mb = base.music ?? EXT_OVERLAY_DEFAULTS.music
  const s = obj(input.subathon)
  const sb = base.subathon ?? EXT_OVERLAY_DEFAULTS.subathon
  return {
    bets: { theme: theme(bt.theme, btb.theme), fontSize: int(bt.fontSize, btb.fontSize, 12, 72), showTop: bool(bt.showTop, btb.showTop) },
    music: {
      theme: theme(m.theme, mb.theme), fontSize: int(m.fontSize, mb.fontSize, 12, 72), showRequester: bool(m.showRequester, mb.showRequester),
      showProgress: bool(m.showProgress, mb.showProgress), hideWhenPaused: bool(m.hideWhenPaused, mb.hideWhenPaused)
    },
    subathon: { theme: theme(s.theme, sb.theme), fontSize: int(s.fontSize, sb.fontSize, 16, 200), showAdds: bool(s.showAdds, sb.showAdds) },
    keys: sanitizeKeys(input.keys, base.keys ?? KEYS_DEFAULTS),
    viz: sanitizeViz(input.viz, base.viz ?? VIZ_DEFAULTS)
  }
}

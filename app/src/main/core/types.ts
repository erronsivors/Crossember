// Общие типы ядра. Те же типы использует интерфейс (через preload).
import type { AppSettings } from './settings'
import type { CrashInfo } from './logger'
import type { ChatPlatformState } from './connector'
import type { AlertQueueState } from './alerts'
import type { DonationServiceState } from './donations/common'
import type { SoundInfo } from './sounds'
import type { MediaInfo } from './media'
import type { AlertTemplate } from './templates'
import type { RulesState } from './rules'
import type { Counter } from './counters'
import type { ProfileState } from './profile'
import type { StreamInfoState } from './streaminfo'
import type { KickAuthState } from './kickauth'
import type { AuctionState } from './auction'
import type { VoteState } from './vote'
import type { WheelState } from './wheel'
import type { GoalState } from './goal'
import type { GiveawayState } from './giveaway'
import type { PointsState } from './points'
import type { BotState } from './bot'
import type { BetsState } from './bets'
import type { RewardsState } from './rewards'
import type { MusicState } from './music'
import type { SubathonState } from './subathon'
import type { MemealertsState } from './memealerts'
import type { UpdateState } from './updater'
import type { KeyHelperState } from './keyhelper'

export type Platform = 'twitch' | 'youtube' | 'vk' | 'kick' | 'goodgame' | 'donationalerts' | 'donatepay' | 'donatex' | 'boosty' | 'obs' | 'hub'

export type ViewerRole = 'broadcaster' | 'mod' | 'vip' | 'sub'

export type HubEventType = 'message' | 'donation' | 'follow' | 'sub' | 'gift' | 'raid' | 'bits' | 'reward' | 'system'

/** Кусок сообщения: текст или смайл. URL смайлов собираются ядром только из проверенных ID. */
export type MsgPart = { t: 'text'; v: string } | { t: 'emote'; v: string; url: string }

export interface Badge {
  title: string
  url: string
}

/** Единое событие хаба: чат, донат, подписка и т.д. со всех площадок. */
export interface HubEvent {
  id: string
  ts: number
  platform: Platform
  type: HubEventType
  user: string
  userId?: string
  text?: string
  parts?: MsgPart[]
  badges?: Badge[]
  color?: string
  amount?: number
  currency?: string
  /** Сумма в рублях (для статистики и условий алертов), если сервис её сообщает или валюта RUB. */
  amountRub?: number
  /** Тестовое событие: показывается в оверлеях, но не идёт в статистику. */
  test?: boolean
  /** Донат, добавленный вручную (наличные, перевод). В базе такие события — с площадкой hub. */
  manual?: boolean
  /** Награда за баллы канала: её название (текст события — «название — ввод зрителя»). */
  reward?: string
  /** Кто пишет в чате: стример, модератор, VIP, подписчик (если площадка сообщает). */
  role?: ViewerRole
  /** Награда за баллы Twitch: id активации и награды (для «выполнено» и возврата баллов). */
  redemption?: { id: string; rewardId: string }
  /** Значения счётчиков на момент срабатывания правила (для подстановки {ключ}); в базу не пишется. */
  vars?: Record<string, string>
}

export type ConnState = 'off' | 'connecting' | 'ok' | 'error'

export interface ConnLogEntry {
  ts: number
  level: 'info' | 'warn' | 'error'
  text: string
}

export interface ConnStatus {
  id: Platform
  name: string
  state: ConnState
  detail: string
  since: number
  log: ConnLogEntry[]
}

export interface ObsState {
  connected: boolean
  scene: string | null
  streaming: boolean
  streamStartedAt: number | null
  recording: boolean
  resolution: string | null
  fps: number | null
}

export interface OverlayInfo {
  id: string
  name: string
  url: string
  size: string
}

export interface ServerInfo {
  port: number
  baseUrl: string
  overlays: OverlayInfo[]
  /** Ссылка на док для OBS (свой ключ, с кнопками управления). */
  dockUrl: string
  /** Ключ оверлеев: редактор алертов берёт по нему картинки, видео и озвучку для предпросмотра. */
  overlayKey: string
  lan: { running: boolean; url: string | null; error: string | null; addresses: string[] }
  /** Пульт модератора (домашняя сеть, свой ключ); null — сеть или пульт выключены. */
  modUrl: string | null
  /** Ссылка для помощника на игровом ПК (null — сервер второго ПК выключен) и сколько помощников подключено. */
  keysHelper: { url: string | null; connected: number }
}

export interface TwitchAccount {
  login: string
  name: string
  id: string
}

export interface TwitchState {
  clientIdSource: 'shared' | 'custom' | 'none'
  broadcaster: TwitchAccount | null
  bot: TwitchAccount | null
  /** Идёт вход по коду: показать пользователю код и ссылку. */
  pending: { role: 'broadcaster' | 'bot'; userCode: string; uri: string; expiresAt: number } | null
  live: boolean
  viewers: number | null
  emotes: { twitch: boolean; thirdParty: number }
}

/** Состояние входа YouTube для интерфейса (без токенов). */
export interface YoutubeState {
  clientIdSource: 'shared' | 'custom' | 'none'
  hasCustomSecret: boolean
  account: { id: string; name: string } | null
  pending: boolean
  live: boolean
  viewers: number | null
}

export interface HubSnapshot {
  connections: ConnStatus[]
  obs: ObsState
  events: HubEvent[]
  chat: HubEvent[]
  pinned: HubEvent | null
  server: ServerInfo | null
  keyHelper: KeyHelperState
  viz: { state: 'off' | 'on' | 'error'; error: string | null }
  obsConfig: { url: string; hasPassword: boolean }
  settings: AppSettings
  twitch: TwitchState
  youtube: YoutubeState
  platforms: ChatPlatformState[]
  alerts: AlertQueueState
  donations: DonationServiceState[]
  sounds: SoundInfo[]
  media: MediaInfo[]
  templates: AlertTemplate[]
  rules: RulesState
  counters: Counter[]
  profile: ProfileState
  streamInfo: StreamInfoState
  kickAuth: KickAuthState
  auction: AuctionState
  wheel: WheelState
  goal: GoalState
  giveaway: GiveawayState
  vote: VoteState
  points: PointsState
  bot: BotState
  bets: BetsState
  rewards: RewardsState
  music: MusicState
  subathon: SubathonState
  memealerts: MemealertsState
  /** Права Twitch для новых разделов: есть (ok), нужен вход (login) или повторный вход (relogin). */
  twitchScopes: Record<string, 'ok' | 'login' | 'relogin'>
  /** Обратная связь: адрес автора и последняя серьёзная ошибка (для плашки «Сообщить об ошибке»). */
  feedback: { email: string; crash: CrashInfo | null }
  /** Обновления из GitHub Releases. */
  update: UpdateState
  /** Сколько копий оверлея «Алерты» сейчас открыто (0 — алерты и озвучку некому показать). */
  alertOverlays: number
  float: { open: boolean; editing: boolean; hotkey: string }
}

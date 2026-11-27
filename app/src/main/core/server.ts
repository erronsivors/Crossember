import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import websocket, { type WebSocket } from '@fastify/websocket'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { Hub } from './hub'
import type { Store } from './db'
import type { Settings, ChatOverlaySettings } from './settings'
import type { BotPlatform } from './botaccounttypes'
import type { ImageCache } from './imgcache'
import type { HubEvent, ServerInfo } from './types'
import type { AlertEngine, AlertItem } from './alerts'
import type { Stats } from './stats'
import type { SoundLibrary } from './sounds'
import type { MediaLibrary } from './media'
import { ART_FILES } from './art'
import { packPath } from './alertpack'
import type { WindowsTts } from './tts'
import type { Counter, Counters } from './counters'
import type { Auction } from './auction'
import type { Wheel } from './wheel'
import type { Fundraiser } from './goal'
import type { Giveaway } from './giveaway'
import type { Vote } from './vote'
import type { Bets } from './bets'
import type { Music } from './music'
import type { Subathon } from './subathon'
import type { Rewards } from './rewards'
import type { Points } from './points'
import { MOD_ACTIONS, MOD_BLOCKS, dockView, parseAction, runAction, type DockActionTable } from './dock'
import { chatCss, eventView, sampleChat } from './chatstyle'
import type { KeyCapture } from './keys'
import { keysAllowed, keysView } from './keyslayout'

/** Оверлеи для OBS. id = имя файла в resources/overlays, key = ключ настроек. */
const OVERLAYS = [
  { id: 'alert', key: 'alert', name: 'Алерты', size: '1920 × 1080 или размер холста' },
  { id: 'chat', key: 'chat', name: 'Чат вертикальный', size: '500 × 900' },
  { id: 'chat-h', key: 'chatH', name: 'Чат горизонтальный', size: '1920 × 80' },
  { id: 'pinned', key: 'pinned', name: 'Закреплённое сообщение', size: '1200 × 300' },
  { id: 'top', key: 'top', name: 'Топ донатеров', size: '500 × 400' },
  { id: 'last', key: 'last', name: 'Последний донат', size: '800 × 140' },
  { id: 'counter', key: 'counter', name: 'Счётчики', size: '600 × 300' },
  { id: 'auction', key: 'auction', name: 'Аукцион', size: '700 × 500' },
  { id: 'wheel', key: 'wheel', name: 'Колесо', size: '900 × 900' },
  { id: 'goal', key: 'goal', name: 'Сбор средств', size: '800 × 260' },
  { id: 'giveaway', key: 'giveaway', name: 'Розыгрыш', size: '800 × 300' },
  { id: 'vote', key: 'vote', name: 'Голосование', size: '700 × 500' },
  { id: 'bets', key: 'bets', name: 'Ставки', size: '700 × 500' },
  { id: 'music', key: 'music', name: 'Сейчас играет', size: '700 × 160' },
  { id: 'subathon', key: 'subathon', name: 'Сабатон', size: '800 × 260' },
  { id: 'keys', key: 'keys', name: 'Клавиатура и мышь', size: '600 × 300' },
  { id: 'viz', key: 'viz', name: 'Визуализатор звука', size: '800 × 200' },
  // Окно «чат поверх игры» — открывается самим Crossember, в списке для OBS не показывается.
  { id: 'float', key: 'float', name: 'Чат поверх игры', size: '', hidden: true }
] as { id: string; key: string; name: string; size: string; hidden?: boolean }[]

/** Общие файлы оверлеев и пульта — только этот список. */
const ASSETS: Record<string, string> = {
  'overlay.css': 'text/css; charset=utf-8',
  'overlay.js': 'text/javascript; charset=utf-8',
  'alert.js': 'text/javascript; charset=utf-8',
  'alertkit.js': 'text/javascript; charset=utf-8',
  'alertkit.css': 'text/css; charset=utf-8',
  'chat.js': 'text/javascript; charset=utf-8',
  'pinned.js': 'text/javascript; charset=utf-8',
  'dock.js': 'text/javascript; charset=utf-8',
  'top.js': 'text/javascript; charset=utf-8',
  'last.js': 'text/javascript; charset=utf-8',
  'counter.js': 'text/javascript; charset=utf-8',
  'auction.js': 'text/javascript; charset=utf-8',
  'wheel.js': 'text/javascript; charset=utf-8',
  'goal.js': 'text/javascript; charset=utf-8',
  'giveaway.js': 'text/javascript; charset=utf-8',
  'vote.js': 'text/javascript; charset=utf-8',
  'bets.js': 'text/javascript; charset=utf-8',
  'music.js': 'text/javascript; charset=utf-8',
  'subathon.js': 'text/javascript; charset=utf-8',
  'keys.js': 'text/javascript; charset=utf-8',
  'viz.js': 'text/javascript; charset=utf-8',
  'sounds.js': 'text/javascript; charset=utf-8'
}

/** Шрифты — только этот список файлов, никаких произвольных путей. */
const FONTS: Record<string, string> = {
  'unbounded-800-cyr.woff2': '@fontsource/unbounded/files/unbounded-cyrillic-800-normal.woff2',
  'unbounded-800-lat.woff2': '@fontsource/unbounded/files/unbounded-latin-800-normal.woff2',
  'manrope-600-cyr.woff2': '@fontsource/manrope/files/manrope-cyrillic-600-normal.woff2',
  'manrope-600-lat.woff2': '@fontsource/manrope/files/manrope-latin-600-normal.woff2',
  'manrope-800-cyr.woff2': '@fontsource/manrope/files/manrope-cyrillic-800-normal.woff2',
  'manrope-800-lat.woff2': '@fontsource/manrope/files/manrope-latin-800-normal.woff2'
}


const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY'
}

/** Оверлеи-чаты: им в hello нужны недавние события и оформление. */
const CHAT_OVERLAYS = new Set(['chat', 'chat-h', 'float'])

const PAGE_CSP = `default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data: blob:; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'`

const newKey = (): string => randomBytes(24).toString('base64url')

function sameKey(a: unknown, b: string): boolean {
  if (typeof a !== 'string' || !b) return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Адреса этого ПК в домашней сети (только частные диапазоны). */
export function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address)
    }
  }
  return out
}

/** Движок алертов, статистика и звуки (этап 3). */
export interface OverlayExtras {
  alerts: AlertEngine
  stats: Stats
  sounds: SoundLibrary
  media: MediaLibrary
  tts: WindowsTts
  counters: Counters
  auction: Auction
  wheel: Wheel
  goal: Fundraiser
  giveaway: Giveaway
  vote: Vote
  bets: Bets
  music: Music
  subathon: Subathon
  rewards: Rewards
  points: Points
  keys: KeyCapture
  /** Свои аккаунты (каналы, бот) — для выделения обращений к стримеру в чате. */
  own?: () => string[]
  botProfiles?: () => Partial<Record<BotPlatform, string[]>>
}

export interface RemoteActions {
  send: (text: string) => Promise<void>
  pin: (id: string | null) => void
  /** Кнопки дока: имя → действие. Только этот список, аргументы проверяются ещё и в модулях. */
  dock: DockActionTable
  /** Пульт модератора: написать от имени бота (или стримера, если бота нет). */
  sendMod: (text: string) => Promise<void>
  /** Пульт модератора: удалить сообщение, таймаут на 10 минут или бан. */
  moderate: (id: string, op: 'delete' | 'timeout' | 'ban') => Promise<void>
}

/** local — оверлеи (только чтение), dock — док для OBS на этом ПК, lan — пульт второго устройства, mod — пульт модератора. */
type Kind = 'local' | 'lan-overlay' | 'lan' | 'dock' | 'mod'
const isOverlay = (kind: Kind): boolean => kind === 'local' || kind === 'lan-overlay'

/**
 * Сервер Crossember.
 * - local: оверлеи для OBS, слушает ТОЛЬКО 127.0.0.1, ключ оверлеев, только чтение.
 * - dock: док для OBS — тот же сервер 127.0.0.1, но свой ключ (ключ оверлеев кнопки не открывает).
 * - lan: тот же док для второго ПК, слушает выбранный адрес домашней сети, отдельный ключ пульта;
 *   кнопки там работают, только если включены в настройках, иначе — только чат.
 * - mod: пульт модератора на том же адресе домашней сети, свой ключ; только чат с модерацией и кнопки из MOD_ACTIONS.
 * Везде: ключ в каждом запросе (сравнение за постоянное время), проверка Host (DNS-rebinding) и Origin у WebSocket.
 */
export class OverlayServer {
  private local: FastifyInstance | null = null
  private lan: FastifyInstance | null = null
  private sockets = new Map<WebSocket, Kind>()
  /** Какой оверлей открыт в каком сокете (чтобы знать, есть ли кому показать алерт). */
  private socketOverlay = new Map<WebSocket, string>()
  /** Где открыта копия оверлея и видна ли она — для выбора «главной» копии алертов (она одна играет звук). */
  private socketMeta = new Map<WebSocket, { obs: boolean; visible: boolean; since: number; main: boolean | null }>()
  /** Изменилось число открытых оверлеев. */
  onClients: () => void = () => undefined
  private overlayKey: string
  private remoteKey: string
  private dockKey: string
  private modKey: string
  /** Ключ помощника на игровом ПК (нажатия клавиш по домашней сети). */
  private keysKey: string
  /** Кто держит клавишу: 'local' — этот ПК, 'h1', 'h2'… — помощники. Оверлей видит объединение. */
  private keySrc = new Map<string, Set<string>>()
  private helpers = new Map<WebSocket, string>()
  private helperSeq = 0
  private dockTimer: NodeJS.Timeout | null = null
  private lanError: string | null = null
  private lanUrl: string | null = null
  private lanApply: Promise<void> = Promise.resolve()
  /** Отпечаток файлов оверлеев: изменился (новая версия Crossember) — открытые оверлеи перезагрузятся сами. */
  private overlayBuild = ''
  port: number

  constructor(
    private hub: Hub,
    private store: Store,
    private settings: Settings,
    private images: ImageCache,
    private resourcesDir: string,
    private appDir: string,
    private actions: RemoteActions,
    private extras: OverlayExtras
  ) {
    this.port = store.get('server.port', 47832)
    this.overlayKey = store.get('server.overlayKey', '') || this.rotate('overlay')
    this.remoteKey = store.get('server.remoteKey', '') || this.rotate('remote')
    this.dockKey = store.get('server.dockKey', '') || this.rotate('dock')
    this.modKey = store.get('server.modKey', '') || this.rotate('mod')
    this.keysKey = store.get('server.keysKey', '') || this.rotate('keys')
    hub.on('event', (e: HubEvent) => this.broadcast({ kind: 'event', event: e, view: eventView(e) }))
    hub.on('delete', (d: unknown) => this.broadcast({ kind: 'delete', ...(d as object) }))
    hub.on('pinned', (m: HubEvent | null) => this.broadcast({ kind: 'pinned', event: m }))
    // Алерты идут только в оверлеи (локальные и сетевые), пульту второго ПК они не нужны.
    extras.alerts.on('play', (a: AlertItem) => this.broadcast({ kind: 'alert', alert: a, at: Date.now() }, 'local'))
    extras.alerts.on('end', (id: string) => this.broadcast({ kind: 'alert-end', id }, 'local'))
    extras.counters.on('change', (list: Counter[]) => this.broadcast({ kind: 'counters', counters: list }, 'local'))
    extras.auction.on('change', () => this.broadcast({ kind: 'auction', auction: extras.auction.overlay() }, 'local'))
    extras.wheel.on('change', () => this.broadcast({ kind: 'wheel', wheel: extras.wheel.overlay() }, 'local'))
    extras.goal.on('change', () => this.broadcast({ kind: 'goal', goal: extras.goal.overlay() }, 'local'))
    extras.giveaway.on('change', () => this.broadcast({ kind: 'giveaway', giveaway: extras.giveaway.overlay() }, 'local'))
    extras.vote.on('change', () => this.broadcast({ kind: 'vote', vote: extras.vote.overlay() }, 'local'))
    extras.bets.on('change', () => this.broadcast({ kind: 'bets', bets: extras.bets.overlay() }, 'local'))
    extras.music.on('change', () => this.broadcast({ kind: 'music', music: extras.music.overlay() }, 'local'))
    extras.subathon.on('change', () => this.broadcast({ kind: 'subathon', subathon: extras.subathon.state() }, 'local'))
    extras.subathon.on('added', (a: unknown) => this.broadcast({ kind: 'subathon-add', add: a }, 'local'))
    // Нажатия — только копиям оверлея «Клавиатура», никому больше (ни доку, ни второму ПК).
    extras.keys.on('key', (id: string, down: boolean) => this.pressKey('local', id, down))
    // Док: любое изменение — одно обновление состояния (не чаще раза в 100 мс).
    for (const src of [extras.alerts, extras.auction, extras.goal, extras.giveaway, extras.wheel, extras.counters, extras.vote, extras.bets, extras.music, extras.subathon, extras.rewards]) src.on('change', () => this.scheduleDock())
    hub.on('event', (e: HubEvent) => {
      if (e.type !== 'message' && e.type !== 'system' && !e.test) this.pushStats()
    })
  }

  private statsData(): unknown {
    const t = this.settings.get().overlays.top
    return this.extras.stats.overlay(t.period, t.count)
  }

  /** Обновить оверлеи «Топ донатеров» и «Последний донат». */
  pushStats(): void {
    this.broadcast({ kind: 'stats', stats: this.statsData() }, 'local')
  }

  rotate(which: 'overlay' | 'remote' | 'dock' | 'mod' | 'keys'): string {
    const k = newKey()
    if (which === 'keys') {
      this.keysKey = k
      this.store.set('server.keysKey', k)
      for (const sock of this.helpers.keys()) sock.close(4001, 'key rotated')
      return k
    }
    if (which === 'overlay') this.overlayKey = k
    else if (which === 'dock') this.dockKey = k
    else if (which === 'mod') this.modKey = k
    else this.remoteKey = k
    this.store.set(`server.${which}Key`, k)
    const kindOf: Kind = which === 'overlay' ? 'local' : which === 'dock' ? 'dock' : which === 'mod' ? 'mod' : 'lan'
    for (const [s, kind] of this.sockets) if (kind === kindOf || (which === 'overlay' && kind === 'lan-overlay')) s.close(4001, 'key rotated')
    if (which === 'remote' && this.lanUrl) this.lanUrl = this.lanUrl.replace(/k=.*$/, `k=${k}`)
    return k
  }

  /** Оформление чатов для OBS: готовый CSS (тот же, что в предпросмотре) и свои ники для выделения обращений. */
  private chatStyle(): { css: Record<string, string>; own: string[] } {
    const s = this.settings.get()
    const o = s.overlays
    return {
      css: {
        chat: chatCss(o.chat.look, o.chat.fontSize, 'body', 'v'),
        chatH: chatCss(o.chatH.look, o.chatH.fontSize, 'body', 'h'),
        float: chatCss({ ...s.float.look, opacity: s.float.bgOpacity }, s.float.fontSize, 'body', 'f')
      },
      own: (this.extras.own?.() ?? []).slice(0, 10)
    }
  }

  private overlaySettings() {
    const s = this.settings.get()
    const botProfiles = this.extras.botProfiles?.() ?? {}
    const withBots = (c: ChatOverlaySettings) => ({ ...c, look: { ...c.look, filter: { ...c.look.filter, botProfiles } } })
    return { ...s.overlays, chat: withBots(s.overlays.chat), chatH: withBots(s.overlays.chatH), float: { ...s.float, look: withBots(s.float).look } }
  }

  /** «Тест в OBS»: короткий поток выдуманных сообщений и событий — только в чаты, мимо алертов, правил и базы. */
  testChat(): void {
    if (this.chatTestTimer) return
    const own = this.extras.own?.()[0] ?? 'streamer'
    let i = 0
    const tick = (): void => {
      const e = sampleChat(Math.floor(Math.random() * 1000) + i, own)
      this.broadcast({ kind: 'chattest', event: e, view: eventView(e) }, 'local')
      if (++i < 12) this.chatTestTimer = setTimeout(tick, 700)
      else this.chatTestTimer = null
    }
    tick()
  }
  private chatTestTimer: NodeJS.Timeout | null = null

  /** Сообщить оверлеям о новых настройках (тема, размер шрифта…). */
  pushConfig(): void {
    const s = this.settings.get()
    this.broadcast({ kind: 'config', overlays: this.overlaySettings(), chatStyle: this.chatStyle(), dockBlocks: s.dock.blocks, lanControl: s.lan.control, keysLayout: keysView(s.overlays.keys) })
    this.pushStats()
    this.pushDock()
  }

  private dockData(): unknown {
    return dockView(this.extras)
  }

  private scheduleDock(): void {
    if (!this.dockTimer) this.dockTimer = setTimeout(() => { this.dockTimer = null; this.pushDock() }, 100)
  }

  /** Состояние для дока: в док OBS всегда, на второе устройство — только если там разрешены кнопки. */
  private pushDock(): void {
    let data: string | null = null
    const control = this.settings.get().lan.control
    for (const [s, kind] of this.sockets) {
      if (s.readyState !== s.OPEN || (kind !== 'dock' && kind !== 'mod' && !(kind === 'lan' && control))) continue
      data ??= JSON.stringify({ kind: 'dock', dock: this.dockData() })
      s.send(data)
    }
  }

  info(): ServerInfo {
    const baseUrl = `http://127.0.0.1:${this.port}`
    return {
      port: this.port,
      baseUrl,
      overlayKey: this.overlayKey,
      overlays: OVERLAYS.filter((o) => !o.hidden).map((o) => ({
        id: o.id, name: o.name, size: o.size, url: `${baseUrl}/o/${o.id}?k=${this.overlayKey}`,
        lanUrl: this.lan && this.settings.get().lan.overlays && this.lanUrl
          ? this.lanUrl.replace(/\/remote\?k=.*$/, `/o/${o.id}?k=${this.overlayKey}`) : null
      })),
      dockUrl: `${baseUrl}/dock?k=${this.dockKey}`,
      lan: { running: !!this.lan, url: this.lanUrl, error: this.lanError, addresses: lanAddresses() },
      modUrl: this.lan && this.lanUrl ? this.lanUrl.replace(/\/remote\?k=.*$/, `/mod?k=${this.modKey}`) : null,
      keysHelper: {
        url: this.lan && this.lanUrl ? this.lanUrl.replace(/\/remote\?k=.*$/, `/kws?k=${this.keysKey}`) : null,
        connected: this.helpers.size
      }
    }
  }

  private broadcast(msg: unknown, only?: Kind): void {
    const data = JSON.stringify(msg)
    for (const [s, kind] of this.sockets) if ((!only || kind === only || (only === 'local' && kind === 'lan-overlay')) && s.readyState === s.OPEN) s.send(data)
  }

  /**
   * Выбрать «главную» копию оверлея «Алерты»: видимая важнее скрытой, OBS важнее браузера, при равенстве — открытая раньше.
   * Только она играет звук и озвучку, остальные показывают молча.
   */
  private electMain(): void {
    let best: WebSocket | null = null
    for (const [sock, ov] of this.socketOverlay) {
      if (ov !== 'alert') continue
      const m = this.socketMeta.get(sock)
      if (!m) continue
      const b = best ? this.socketMeta.get(best)! : null
      if (!b || (m.visible !== b.visible ? m.visible : m.obs !== b.obs ? m.obs : m.since < b.since)) best = sock
    }
    for (const [sock, m] of this.socketMeta) {
      const main = sock === best
      if (main === m.main) continue
      m.main = main
      if (sock.readyState === sock.OPEN) sock.send(JSON.stringify({ kind: 'role', main }))
    }
  }

  private hello(kind: Kind, ov = ''): string {
    const s = this.settings.get()
    const isDock = !isOverlay(kind)
    const isMod = kind === 'mod'
    return JSON.stringify({
      kind: 'hello',
      serverTime: Date.now(),
      build: this.overlayBuild,
      role: kind === 'lan' ? 'remote' : kind === 'dock' ? 'dock' : isMod ? 'mod' : 'overlay',
      overlays: this.overlaySettings(),
      chat: this.hub.recentChat().slice(0, 50),
      events: isDock ? this.hub.recent().slice(0, 30) : CHAT_OVERLAYS.has(ov) ? this.hub.recent().slice(0, 30).map((e) => ({ ...e, view: eventView(e) })) : [],
      ...(CHAT_OVERLAYS.has(ov) ? { chatStyle: this.chatStyle() } : {}),
      pinned: this.hub.pinned,
      ...(isDock ? (isMod ? { dockBlocks: MOD_BLOCKS, lanControl: true } : { dockBlocks: s.dock.blocks, lanControl: s.lan.control }) : {}),
      ...(kind === 'dock' || isMod || (kind === 'lan' && s.lan.control) ? { dock: this.dockData() } : {}),
      ...(isOverlay(kind) ? { stats: this.statsData(), counters: this.extras.counters.list(), auction: this.extras.auction.overlay(), wheel: this.extras.wheel.overlay(), goal: this.extras.goal.overlay(), giveaway: this.extras.giveaway.overlay(), vote: this.extras.vote.overlay(), bets: this.extras.bets.overlay(), music: this.extras.music.overlay(), subathon: this.extras.subathon.state() } : {}),
      // Снимок для оверлея алертов после (пере)подключения: что идёт сейчас и с какого момента.
      ...(ov === 'alert' ? { alert: this.extras.alerts.nowPlaying() } : {}),
      ...(ov === 'keys' && isOverlay(kind) ? { pressed: [...this.keySrc.keys()], keysLayout: keysView(s.overlays.keys) } : {})
    })
  }

  private async build(kind: Kind, host: string, port: number): Promise<FastifyInstance> {
    const app = Fastify({ logger: false, bodyLimit: 16 * 1024 })
    await app.register(websocket, { options: { maxPayload: 4 * 1024 } })
    const allowedHosts = kind === 'local' ? [`127.0.0.1:${port}`, `localhost:${port}`] : [`${host}:${port}`]
    const origins = allowedHosts.map((h) => `http://${h}`)
    const key = (): string => (kind === 'local' ? this.overlayKey : this.remoteKey)
    const overlayAccess = (k: unknown): boolean => (kind === 'local' || this.settings.get().lan.overlays) && sameKey(k, this.overlayKey)
    const modOn = (): boolean => this.settings.get().mod.enabled && this.settings.get().mod.web
    const asset = async (rel: string): Promise<string> => readFile(join(this.resourcesDir, 'overlays', rel), 'utf8')

    app.addHook('onRequest', async (req: FastifyRequest, reply) => {
      reply.headers(SECURITY_HEADERS)
      if (!allowedHosts.includes(req.headers.host ?? '')) return reply.code(421).send({ error: 'bad host' })
    })

    app.get('/health', async () => ({ ok: true }))

    if (kind === 'local') {
      app.get<{ Querystring: { k?: string } }>('/dock', async (req, reply) => {
        if (!sameKey(req.query.k, this.dockKey)) return reply.code(403).type('text/plain; charset=utf-8').send('Нет доступа: неверный ключ дока. Скопируйте ссылку заново в Crossember → Оверлеи → Док для OBS.')
        return reply.header('Content-Security-Policy', PAGE_CSP).type('text/html; charset=utf-8').send(await asset('dock.html'))
      })
    } else {
      app.get<{ Querystring: { k?: string } }>('/remote', async (req, reply) => {
        if (!sameKey(req.query.k, key())) return reply.code(403).type('text/plain; charset=utf-8').send('Нет доступа: неверный ключ. Скопируйте ссылку заново в Crossember → Настройки → Второй ПК.')
        return reply.header('Content-Security-Policy', PAGE_CSP).type('text/html; charset=utf-8').send(await asset('dock.html'))
      })
      app.get<{ Querystring: { k?: string } }>('/mod', async (req, reply) => {
        if (!modOn()) return reply.code(403).type('text/plain; charset=utf-8').send('Пульт модератора выключен: Crossember → Бот и модераторы → Модераторы.')
        if (!sameKey(req.query.k, this.modKey)) return reply.code(403).type('text/plain; charset=utf-8').send('Нет доступа: неверный ключ. Попросите стримера прислать новую ссылку.')
        return reply.header('Content-Security-Policy', PAGE_CSP).type('text/html; charset=utf-8').send(await asset('dock.html'))
      })
      // Помощник на игровом ПК: присылает нажатия клавиш. Это программа, не страница: запрос с Origin
      // (любой браузер) отклоняется, чтобы чужой сайт на игровом ПК не мог ни слать, ни читать нажатия.
      app.get<{ Querystring: { k?: string } }>('/kws', { websocket: true }, (socket, req) => {
        if (req.headers.origin || !sameKey(req.query.k, this.keysKey)) {
          socket.close(4003, 'forbidden')
          return
        }
        const src = `h${++this.helperSeq}`
        this.helpers.set(socket, src)
        socket.send(JSON.stringify({ kind: 'allow', ids: this.keysWanted() }))
        this.onClients()
        let count = 0
        const reset = setInterval(() => { count = 0 }, 1000)
        // Связь жива? Раз в 10 с ping; не ответил — рвём соединение, его клавиши отпускаются в close.
        let alive = true
        let flooded = false
        socket.on('pong', () => { alive = true })
        const beat = setInterval(() => {
          if (!alive) { socket.terminate(); return }
          alive = false
          socket.ping()
          if (socket.readyState === socket.OPEN) socket.send('{"kind":"hb"}')
        }, 10_000)
        socket.on('message', (raw: Buffer) => {
          // Слишком часто — отключаем целиком: так не теряется отпускание уже зажатой клавиши.
          if (flooded) return
          if (++count > 120 || raw.length > 100) {
            flooded = true
            for (const id of [...this.keySrc.keys()]) this.pressKey(src, id, false)
            socket.terminate()
            return
          }
          let m: { kind?: unknown; id?: unknown; down?: unknown }
          try { m = JSON.parse(raw.toString('utf8')) } catch { return }
          if (!m || typeof m !== 'object' || Array.isArray(m)) return
          if (m.kind !== 'key' || typeof m.id !== 'string' || typeof m.down !== 'boolean') return
          // Разрешено ровно то, что сейчас нарисовано на открытом оверлее; отпускание — всегда.
          if (m.down && !this.keysWanted().includes(m.id)) return
          this.pressKey(src, m.id, m.down)
        })
        socket.on('close', () => {
          clearInterval(reset)
          clearInterval(beat)
          this.helpers.delete(socket)
          for (const id of [...this.keySrc.keys()]) this.pressKey(src, id, false)
          this.onClients()
        })
      })
    }

    app.get<{ Params: { id: string }; Querystring: { k?: string } }>('/o/:id', async (req, reply) => {
      if (!overlayAccess(req.query.k)) return reply.code(403).type('text/plain; charset=utf-8').send('Нет доступа: проверьте ключ и разрешение оверлеев на другом ПК')
      const o = OVERLAYS.find((x) => x.id === req.params.id && (kind === 'local' || !x.hidden))
      if (!o) return reply.code(404).send({ error: 'not found' })
      return reply.header('Content-Security-Policy', PAGE_CSP).type('text/html; charset=utf-8').send(await asset(`${o.id}.html`))
    })

    app.get<{ Params: { file: string } }>('/a/:file', async (req, reply) => {
      const type = ASSETS[req.params.file]
      if (!type) return reply.code(404).send({ error: 'not found' })
      return reply.type(type).send(await asset(req.params.file))
    })

    // Встроенные картинки алертов (общие для всех, без ключа).
    app.get<{ Params: { file: string } }>('/b/:file', async (req, reply) => {
      const name = req.params.file.replace(/\.svg$/, '')
      if (!ART_FILES.has(name)) return reply.code(404).send({ error: 'not found' })
      return reply.header('Cache-Control', 'public, max-age=86400').header('Cross-Origin-Resource-Policy', 'cross-origin').type('image/svg+xml').send(await asset(`art/${name}.svg`))
    })

    // Слои основного набора алертов (resources/alertpack, общие для всех, без ключа). Разрешено чтение из
    // приложения (fetch в blob): так анимированный WebP каждый показ начинается с первого кадра.
    const packFile = async (reply: FastifyReply, media: string, parts: string[]): Promise<FastifyReply> => {
      if (!packPath(media)) return reply.code(404).send({ error: 'not found' })
      try {
        const body = await readFile(join(this.resourcesDir, 'alertpack', ...parts))
        return reply.header('Cache-Control', 'public, max-age=86400').header('Cross-Origin-Resource-Policy', 'cross-origin')
          .header('Access-Control-Allow-Origin', '*').type(media.endsWith('.png') ? 'image/png' : 'image/webp').send(body)
      } catch {
        return reply.code(404).send({ error: 'not found' })
      }
    }
    app.get<{ Params: { id: string; file: string } }>('/p/:id/:file', async (req, reply) =>
      packFile(reply, `p:${req.params.id}/${req.params.file}`, [req.params.id, req.params.file]))
    app.get<{ Params: { id: string; sub: string; file: string } }>('/p/:id/corner/:sub/:file', async (req, reply) =>
      packFile(reply, `p:${req.params.id}/corner/${req.params.sub}/${req.params.file}`, [req.params.id, 'corner', req.params.sub, req.params.file]))

    // Смайлы и бейджи из локального кэша (без ключа: это публичные картинки; Host всё равно проверяется).
    app.get<{ Params: { hash: string } }>('/e/:hash', async (req, reply) => {
      const img = await this.images.get(req.params.hash)
      if (!img) return reply.code(404).send({ error: 'not found' })
      return reply.header('Cache-Control', 'public, max-age=604800, immutable').header('Cross-Origin-Resource-Policy', 'cross-origin').type(img.type).send(img.body)
    })

    // Свои звуки алертов — только для оверлеев, с ключом.
    {
      app.get<{ Params: { file: string }; Querystring: { k?: string } }>('/s/:file', async (req, reply) => {
        if (!overlayAccess(req.query.k)) return reply.code(403).send({ error: 'forbidden' })
        const snd = await this.extras.sounds.get(req.params.file)
        if (!snd) return reply.code(404).send({ error: 'not found' })
        return reply.header('Cross-Origin-Resource-Policy', 'cross-origin').type(snd.type).send(snd.body)
      })
      // Картинки и видео конструктора (с ключом; видео браузер просит кусками — Range).
      app.get<{ Params: { file: string }; Querystring: { k?: string } }>('/m/:file', async (req, reply) => {
        if (!overlayAccess(req.query.k)) return reply.code(403).send({ error: 'forbidden' })
        const range = typeof req.headers.range === 'string' ? req.headers.range : undefined
        const m = await this.extras.media.get(req.params.file, range)
        if (!m) return reply.code(range ? 416 : 404).send({ error: 'not found' })
        reply.header('Cross-Origin-Resource-Policy', 'cross-origin').header('Accept-Ranges', 'bytes').type(m.type)
        if (range) reply.code(206).header('Content-Range', `bytes ${m.start}-${m.end}/${m.size}`)
        return reply.send(m.body)
      })
      // Готовая озвучка.
      app.get<{ Params: { file: string }; Querystring: { k?: string } }>('/t/:file', async (req, reply) => {
        if (!overlayAccess(req.query.k)) return reply.code(403).send({ error: 'forbidden' })
        const body = await this.extras.tts.get(req.params.file)
        if (!body) return reply.code(404).send({ error: 'not found' })
        return reply.header('Cross-Origin-Resource-Policy', 'cross-origin').type('audio/wav').send(body)
      })
    }

    app.get<{ Params: { file: string } }>('/f/:file', async (req, reply) => {
      const rel = FONTS[req.params.file]
      if (!rel) return reply.code(404).send({ error: 'not found' })
      return reply.header('Cache-Control', 'max-age=86400').type('font/woff2').send(await readFile(join(this.appDir, 'node_modules', rel)))
    })

    app.get<{ Querystring: { k?: string } }>('/ws', { websocket: true }, (socket, req) => {
      const origin = req.headers.origin
      // На локальном сервере ключ дока превращает подключение в док (с кнопками), ключ оверлеев — в оверлей.
      const asDock = kind === 'local' && sameKey(req.query.k, this.dockKey)
      const asMod = kind === 'lan' && modOn() && sameKey(req.query.k, this.modKey)
      const asOverlay = overlayAccess(req.query.k)
      if ((origin && !origins.includes(origin)) || (!asDock && !asMod && !asOverlay && !sameKey(req.query.k, key()))) {
        socket.close(4003, 'forbidden')
        return
      }
      if (asDock || asMod) {
        const k: 'dock' | 'mod' = asDock ? 'dock' : 'mod'
        this.sockets.set(socket, k)
        socket.on('close', () => this.sockets.delete(socket))
        socket.send(this.hello(k))
        this.controlSocket(socket, k)
        return
      }
      const ov = typeof (req.query as { o?: unknown }).o === 'string' ? String((req.query as { o?: unknown }).o).slice(0, 20) : ''
      if (asOverlay && kind === 'lan' && !OVERLAYS.some((o) => o.id === ov && !o.hidden)) {
        socket.close(4003, 'forbidden')
        return
      }
      const clientKind: Kind = asOverlay ? (kind === 'local' ? 'local' : 'lan-overlay') : kind
      this.sockets.set(socket, clientKind)
      if (asOverlay && ov) this.socketOverlay.set(socket, ov)
      this.onClients()
      socket.on('close', () => {
        this.sockets.delete(socket)
        this.socketOverlay.delete(socket)
        if (this.socketMeta.delete(socket)) this.electMain()
        this.onClients()
      })
      socket.send(this.hello(clientKind, ov))
      if (asOverlay) {
        // Оверлеи только слушают; единственное, что они сообщают, — где открыты и видны ли (для оверлея «Алерты»).
        if (ov !== 'alert') {
          socket.on('message', () => undefined)
          return
        }
        let count = 0
        const since = Date.now()
        const reset = setInterval(() => { count = 0 }, 10_000)
        socket.on('close', () => clearInterval(reset))
        socket.on('message', (raw: Buffer) => {
          if (++count > 30 || raw.length > 200) return
          let m: { kind?: unknown; obs?: unknown; visible?: unknown }
          try {
            m = JSON.parse(raw.toString('utf8'))
          } catch {
            return
          }
          if (!m || typeof m !== 'object' || Array.isArray(m)) return
          // main: null — роль этой копии ещё не сообщали.
          const meta = this.socketMeta.get(socket) ?? { obs: false, visible: true, since, main: null }
          if (m.kind === 'hi') meta.obs = m.obs === true
          else if (m.kind !== 'vis') return
          if (typeof m.visible === 'boolean') meta.visible = m.visible
          this.socketMeta.set(socket, meta)
          this.electMain()
        })
        return
      }
      this.controlSocket(socket, 'lan')
    })

    await app.listen({ host, port })
    return app
  }

  /**
   * Команды от дока и пульта: написать в чат, закрепить, кнопки дока (act).
   * Ограничение частоты: сообщение в чат — не чаще раза в 0,5 с, кнопки — не больше 12 за 3 с.
   * Со второго устройства кнопки работают, только если это включено в настройках (проверяется на каждую команду).
   */
  private controlSocket(socket: WebSocket, kind: 'dock' | 'lan' | 'mod'): void {
    let lastSend = 0
    let acts = 0
    const reset = setInterval(() => { acts = 0 }, 3000)
    socket.on('close', () => clearInterval(reset))
    const fail = (text: string): void => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ kind: 'error', text })) }
    socket.on('message', (raw: Buffer) => {
      let m: { kind?: unknown; text?: unknown; id?: unknown; op?: unknown }
      try {
        m = JSON.parse(raw.toString('utf8'))
      } catch {
        return
      }
      // Только объект: «null», число или массив от устройства не должны ронять обработчик.
      if (!m || typeof m !== 'object' || Array.isArray(m)) return
      if (m.kind === 'send' && typeof m.text === 'string') {
        const now = Date.now()
        if (now - lastSend < 500) return
        lastSend = now
        const send = kind === 'mod' ? this.actions.sendMod : this.actions.send
        send(m.text.slice(0, 500)).catch((e) => fail((e as Error).message))
      } else if (m.kind === 'mod' && kind === 'mod' && typeof m.id === 'string' && m.id.length <= 100 && (m.op === 'delete' || m.op === 'timeout' || m.op === 'ban')) {
        if (++acts > 12) return fail('Слишком часто — подождите пару секунд')
        this.actions.moderate(m.id, m.op).catch((e) => fail((e as Error).message))
      } else if (m.kind === 'pin' && (m.id === null || (typeof m.id === 'string' && m.id.length <= 100))) {
        this.actions.pin(m.id as string | null)
      } else if (m.kind === 'act') {
        if (kind === 'lan' && !this.settings.get().lan.control) return fail('Кнопки на этом устройстве выключены: Crossember → Настройки → Чат на другом устройстве')
        if (++acts > 12) return fail('Слишком часто — подождите пару секунд')
        const a = parseAction(m, this.actions.dock)
        if (!a) return
        if (kind === 'mod' && !MOD_ACTIONS.includes(a.name)) return fail('Эта кнопка модератору недоступна')
        void runAction(this.actions.dock, a.name, a.args).then((err) => { if (err) fail(err) })
      }
    })
  }

  async start(): Promise<void> {
    try {
      const dir = join(this.resourcesDir, 'overlays')
      const h = createHash('md5')
      for (const f of (await readdir(dir)).sort()) h.update(f).update(await readFile(join(dir, f)))
      this.overlayBuild = h.digest('hex').slice(0, 12)
    } catch {
      this.overlayBuild = String(Date.now())
    }
    this.local = await this.build('local', '127.0.0.1', this.port)
    this.hub.setStatus('hub', 'ok', `Сервер оверлеев: 127.0.0.1:${this.port}`)
    await this.applyLan()
  }

  /** Уровни полос звука (0–100) — только копиям оверлея «Визуализатор». */
  vizFrame(levels: number[]): void {
    const data = JSON.stringify({ kind: 'viz', v: levels })
    for (const [sock, ov] of this.socketOverlay) if (ov === 'viz' && sock.readyState === sock.OPEN) sock.send(data)
  }

  /** Какие нажатия нужны прямо сейчас: показ включён и оверлей «Клавиатура» открыт. */
  private keysWanted(): string[] {
    const s = this.settings.get()
    const k = s.overlays.keys
    return s.role === 'main' && k.capture && this.openCount('keys') > 0 ? [...keysAllowed(k)] : []
  }

  /** Сообщить помощникам, какие клавиши присылать (пустой список — выключить перехват на игровом ПК). */
  pushHelpers(): void {
    const ids = this.keysWanted()
    const data = JSON.stringify({ kind: 'allow', ids })
    for (const sock of this.helpers.keys()) if (sock.readyState === sock.OPEN) sock.send(data)
    // Клавиши, которых больше нет в списке, у помощников отпускаем сразу (раскладку сменили или показ выключен).
    const keep = new Set(ids)
    for (const id of [...this.keySrc.keys()]) if (!keep.has(id)) for (const src of this.helpers.values()) this.pressKey(src, id, false)
  }

  /** Нажатие от этого ПК или помощника: в оверлей уходит только смена общего состояния клавиши. */
  private pressKey(src: string, id: string, down: boolean): void {
    const set = this.keySrc.get(id) ?? new Set<string>()
    const was = set.size > 0
    if (down) set.add(src)
    else set.delete(src)
    if (set.size) this.keySrc.set(id, set)
    else this.keySrc.delete(id)
    if (was === set.size > 0) return
    const data = JSON.stringify({ kind: 'key', id, down: set.size > 0 })
    for (const [sock, ov] of this.socketOverlay) if (ov === 'keys' && sock.readyState === sock.OPEN) sock.send(data)
  }

  /** Подключены ли док, пульт второго ПК или модератора (им может понадобиться «что играет»). */
  controlClients(): number {
    let n = 0
    for (const k of this.sockets.values()) if (!isOverlay(k)) n++
    return n
  }

  /** Сколько копий оверлея открыто (в OBS, браузере). */
  openCount(id: string): number {
    let n = 0
    for (const v of this.socketOverlay.values()) if (v === id) n++
    return n
  }

  /** Ссылка на оверлей по id (для окна «чат поверх игры»). */
  overlayUrl(id: string): string {
    return `http://127.0.0.1:${this.port}/o/${id}?k=${this.overlayKey}`
  }

  /** Включить/выключить/перезапустить сервер «Чат на другом устройстве» (любой режим). */
  applyLan(): Promise<void> {
    const task = this.lanApply.then(() => this.rebuildLan())
    this.lanApply = task.catch(() => undefined)
    return task
  }

  private async rebuildLan(): Promise<void> {
    const s = this.settings.get()
    const want = s.lan.enabled && !!s.lan.host
    if (this.lan) {
      for (const [sock, kind] of this.sockets) if (kind === 'lan' || kind === 'mod' || kind === 'lan-overlay') sock.close()
      await this.lan.close().catch(() => undefined)
      this.lan = null
      this.lanUrl = null
    }
    this.lanError = null
    if (!want) return
    if (!lanAddresses().includes(s.lan.host)) {
      this.lanError = `Адрес ${s.lan.host} не найден на этом ПК — выберите другой`
      this.hub.log('hub', 'error', this.lanError)
      return
    }
    try {
      this.lan = await this.build('lan', s.lan.host, s.lan.port)
      this.lanUrl = `http://${s.lan.host}:${s.lan.port}/remote?k=${this.remoteKey}`
      this.hub.log('hub', 'info', `Чат для второго ПК доступен: ${s.lan.host}:${s.lan.port}`)
    } catch (e) {
      this.lanError = `Не удалось открыть порт ${s.lan.port}: ${(e as Error).message}`
      this.hub.log('hub', 'error', this.lanError)
    }
  }

  async stop(): Promise<void> {
    await this.lanApply
    if (this.dockTimer) clearTimeout(this.dockTimer)
    for (const s of this.sockets.keys()) s.close()
    await this.lan?.close()
    await this.local?.close()
  }
}

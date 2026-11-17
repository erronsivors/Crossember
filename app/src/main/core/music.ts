import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { Hub } from './hub'
import type { Settings } from './settings'
import type { Points } from './points'
import type { Spotify, SpotifyState, SpotifyTrack } from './spotify'
import type { Smtc } from './smtc'
import type { Access } from './extsettings'
import type { HubEvent, Platform, ViewerRole } from './types'

/**
 * Музыка: «сейчас играет» из Spotify или любого плеера Windows, кнопки управления и заказ треков.
 * Заказ работает только со Spotify (у Яндекс Музыки нет открытого API): команда в чате (можно за свои очки)
 * или награда за баллы Twitch с действием «заказ трека».
 */

export interface NowPlaying {
  source: 'spotify' | 'smtc'
  app: string
  title: string
  artist: string
  album: string
  /** Обложка: data:-ссылка (оверлей не ходит в интернет). */
  image: string
  playing: boolean
  posMs: number
  durMs: number
  at: number
  uri: string
  requester: string
}

export interface SongRequest {
  id: string
  ts: number
  user: string
  platform: Platform
  title: string
  artist: string
  uri: string
  durationMs: number
  via: 'chat' | 'reward' | 'manual'
  status: 'queued' | 'playing' | 'played'
}

export interface MusicState {
  now: NowPlaying | null
  spotify: SpotifyState
  /** Плеер Windows отвечает (SMTC доступен). */
  smtc: boolean
  requests: SongRequest[]
  error: string
}

export interface MusicOverlayView {
  now: NowPlaying | null
  next: { title: string; artist: string; user: string }[]
}

const RANK: Record<ViewerRole | 'none', number> = { none: 0, sub: 1, vip: 2, mod: 3, broadcaster: 4 }
const NEED: Record<Access, number> = { all: 0, sub: 1, vip: 2, mod: 3 }
const REQ_LIMIT = 60
const lower = (x: string): string => x.toLowerCase().trim()

/** Ссылка или URI трека Spotify → id. */
export function spotifyTrackId(q: string): string | null {
  const m = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{10,40})|spotify:track:([A-Za-z0-9]{10,40})/.exec(q)
  return m ? (m[1] ?? m[2]) : null
}

export class Music extends EventEmitter {
  private nowSp: NowPlaying | null = null
  private nowWin: NowPlaying | null = null
  private smtcOk = false
  private requests: SongRequest[] = []
  private error = ''
  private timer: NodeJS.Timeout | null = null
  private spBackoffUntil = 0
  private images = new Map<string, string>()
  private lastReq = new Map<string, number>()
  private sig = ''
  reply: (platform: Platform, text: string) => void = () => undefined

  constructor(private settings: Settings, hub: Hub, private points: Points, private spotify: Spotify, private smtc: Smtc) {
    super()
    hub.on('event', (e: HubEvent) => { if (e.type === 'message' && !e.test) void this.onMessage(e) })
    this.timer = setInterval(() => void this.poll(), 3000)
  }

  private cfg() {
    return this.settings.get().music
  }

  now(): NowPlaying | null {
    const src = this.cfg().nowSource
    const sp = this.spotify.connected ? this.nowSp : null
    const win = this.cfg().smtc ? this.nowWin : null
    if (src === 'spotify') return sp
    if (src === 'smtc') return win
    if (sp && (sp.playing || !win || !win.playing)) return sp
    return win ?? sp
  }

  state(): MusicState {
    return { now: this.now(), spotify: this.spotify.state(), smtc: this.smtcOk, requests: this.requests.slice(0, 40), error: this.error }
  }

  overlay(): MusicOverlayView {
    return { now: this.now(), next: this.requests.filter((r) => r.status === 'queued').slice(-3).reverse().map((r) => ({ title: r.title, artist: r.artist, user: r.user })) }
  }

  private async image(url: string): Promise<string> {
    if (!url) return ''
    const hit = this.images.get(url)
    if (hit !== undefined) return hit
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      const type = res.headers.get('content-type') ?? ''
      const buf = Buffer.from(await res.arrayBuffer())
      const data = res.ok && /^image\/(jpeg|png|webp)$/.test(type) && buf.length < 500_000 ? `data:${type};base64,${buf.toString('base64')}` : ''
      this.images.set(url, data)
      if (this.images.size > 30) this.images.delete(this.images.keys().next().value as string)
      return data
    } catch {
      return ''
    }
  }

  /**
   * Кому-то нужен «что играет» прямо сейчас (оверлей, док, раздел «Музыка» или блок на главной на экране).
   * Иначе плеер Windows не опрашиваем — фоновый PowerShell закрывается и не держит память.
   */
  wanted: () => boolean = () => true
  /** До этого времени опрашивать в любом случае (после команды в чате). */
  private demandUntil = 0

  private async poll(): Promise<void> {
    const cfg = this.cfg()
    if (this.spotify.connected && Date.now() >= this.spBackoffUntil) {
      try {
        const n = await this.spotify.now()
        this.nowSp = n
          ? { source: 'spotify', app: 'Spotify', title: n.title, artist: n.artist, album: n.album, image: await this.image(n.image), playing: n.playing, posMs: n.progressMs, durMs: n.durationMs, at: n.at, uri: n.uri, requester: '' }
          : null
        this.error = ''
        this.trackRequests()
      } catch (e) {
        this.error = (e as Error).message
        this.spBackoffUntil = Date.now() + 15_000
      }
    } else if (!this.spotify.connected) this.nowSp = null
    if (cfg.smtc && !this.wanted() && Date.now() >= this.demandUntil) {
      // Никто не смотрит: прошлое значение оставляем, процесс сам закроется через минуту.
    } else if (cfg.smtc) {
      const w = await this.smtc.poll()
      this.smtcOk = !!w || this.smtcOk
      // Spotify уже читается напрямую — его копию из SMTC не дублируем (там нет обложки).
      this.nowWin = w && !(this.spotify.connected && /spotify/i.test(w.app))
        ? { source: 'smtc', app: w.app, title: w.title, artist: w.artist, album: w.album, image: '', playing: w.playing, posMs: Math.round(w.pos * 1000), durMs: Math.round(w.end * 1000), at: w.upd || Date.now(), uri: '', requester: '' }
        : null
    } else this.nowWin = null
    const n = this.now()
    if (n) n.requester = n.uri ? (this.requests.find((r) => r.uri === n.uri && r.status === 'playing')?.user ?? '') : ''
    const sig = JSON.stringify([n?.title, n?.artist, n?.playing, n?.requester, n?.image.length, Math.round((n?.posMs ?? 0) / 15000), this.error, this.smtcOk])
    if (sig !== this.sig) {
      this.sig = sig
      this.emit('change')
    }
  }

  /** Заказанный трек заиграл — отметить; прошлый заказ — сыгран. */
  private trackRequests(): void {
    const uri = this.nowSp?.uri
    if (!uri) return
    let changed = false
    for (const r of this.requests) {
      if (r.status === 'playing' && r.uri !== uri) { r.status = 'played'; changed = true }
    }
    const q = [...this.requests].reverse().find((r) => r.status === 'queued' && r.uri === uri)
    if (q) { q.status = 'playing'; changed = true }
    if (changed) this.emit('change')
  }

  async control(op: 'toggle' | 'next' | 'prev'): Promise<void> {
    const n = this.now()
    if (n?.source === 'spotify' || (!n && this.spotify.connected)) {
      await this.spotify.control(op === 'toggle' ? (n?.playing ? 'pause' : 'play') : op)
      this.spBackoffUntil = 0
      setTimeout(() => void this.poll(), 600)
      return
    }
    if (!(await this.smtc.control(op))) throw new Error('Плеер не ответил — включите музыку в Яндекс Музыке, Spotify или браузере')
    setTimeout(() => void this.poll(), 600)
  }

  async volume(pct: number): Promise<void> {
    await this.spotify.volume(pct)
  }

  async skip(): Promise<string> {
    try {
      const n = this.now()
      await this.control('next')
      return n ? `Пропущено: ${n.artist ? `${n.artist} — ` : ''}${n.title}` : 'Трек пропущен'
    } catch (e) {
      return (e as Error).message
    }
  }

  nowText(): string {
    const n = this.now()
    if (!n || !n.title) return 'Сейчас ничего не играет'
    return `Сейчас играет: ${n.artist ? `${n.artist} — ` : ''}${n.title}${n.requester ? ` (заказал ${n.requester})` : ''}`
  }

  async search(q: string): Promise<SpotifyTrack[]> {
    return this.spotify.search(q, 8)
  }

  /** Заказать трек. Возвращает '' при успехе или текст ошибки (для ответа в чат). */
  async request(who: { user: string; platform: Platform }, query: string, via: SongRequest['via']): Promise<{ error: string; track?: SpotifyTrack }> {
    const cfg = this.cfg()
    if (!this.spotify.connected) return { error: 'Заказ треков работает только со Spotify, а он не подключён' }
    const q = query.trim()
    if (!q) return { error: 'Напиши название трека или ссылку Spotify' }
    let track: SpotifyTrack | null = null
    try {
      const id = spotifyTrackId(q)
      track = id ? await this.spotify.track(id) : (await this.spotify.search(q, 1))[0] ?? null
    } catch (e) {
      return { error: (e as Error).message }
    }
    if (!track) return { error: `Не нашёл «${q.slice(0, 60)}»` }
    const blocked = cfg.blocked.split(',').map((w) => lower(w)).filter(Boolean)
    const hay = lower(`${track.artist} ${track.title}`)
    if (blocked.some((w) => hay.includes(w))) return { error: 'Этот трек заказывать нельзя' }
    if (track.durationMs > cfg.maxDurationMin * 60_000) return { error: `Трек длиннее ${cfg.maxDurationMin} мин` }
    const mine = this.requests.filter((r) => r.status === 'queued' && lower(r.user) === lower(who.user) && r.platform === who.platform).length
    if (via !== 'manual' && mine >= cfg.maxPerUser) return { error: `Уже есть ${mine} заказ(а) в очереди — подожди` }
    if (this.requests.some((r) => r.status === 'queued' && r.uri === track!.uri)) return { error: 'Этот трек уже в очереди' }
    try {
      await this.spotify.enqueue(track.uri)
    } catch (e) {
      return { error: (e as Error).message }
    }
    this.requests.unshift({ id: randomUUID(), ts: Date.now(), user: who.user, platform: who.platform, title: track.title, artist: track.artist, uri: track.uri, durationMs: track.durationMs, via, status: 'queued' })
    if (this.requests.length > REQ_LIMIT) this.requests.length = REQ_LIMIT
    this.emit('change')
    this.emit('request', { user: who.user, platform: who.platform, title: `${track.artist} — ${track.title}` })
    return { error: '', track }
  }

  clearRequests(): void {
    this.requests = this.requests.filter((r) => r.status === 'queued' || r.status === 'playing')
    this.emit('change')
  }

  private async onMessage(e: HubEvent): Promise<void> {
    const cfg = this.cfg()
    const text = (e.text ?? '').trim()
    const low = text.toLowerCase()
    const is = (c: string): boolean => !!c && (low === c || low.startsWith(c + ' '))
    if (is(cfg.nowCmd)) {
      // Плеер давно не спрашивали — спросить сейчас, чтобы не ответить устаревшим треком.
      if (cfg.smtc && !this.wanted() && Date.now() >= this.demandUntil) {
        this.demandUntil = Date.now() + 60_000
        await this.poll()
      }
      this.reply(e.platform, this.nowText())
      return
    }
    if (!cfg.requests || !is(cfg.requestCmd)) return
    const query = text.slice(cfg.requestCmd.length).trim()
    if (!query) { this.reply(e.platform, `@${e.user}, так: ${cfg.requestCmd} исполнитель — трек (или ссылка Spotify)`); return }
    if (RANK[e.role ?? 'none'] < NEED[cfg.requestAccess]) return
    const uk = `${e.platform}:${lower(e.user)}`
    const isMod = RANK[e.role ?? 'none'] >= RANK.mod
    if (!isMod && Date.now() - (this.lastReq.get(uk) ?? 0) < cfg.cooldownSec * 1000) return
    this.lastReq.set(uk, Date.now())
    const v = this.points.ensure(e.platform, e.userId, e.user)
    const cost = this.settings.get().points.enabled ? cfg.requestCost : 0
    if (cost > 0 && !this.points.spend(v.key, cost, 'заказ трека')) {
      this.reply(e.platform, `@${e.user}, заказ стоит ${cost.toLocaleString('ru-RU')} ${this.settings.get().points.name} (у тебя ${v.balance.toLocaleString('ru-RU')})`)
      return
    }
    const r = await this.request({ user: e.user, platform: e.platform }, query, 'chat')
    if (r.error) {
      if (cost > 0) this.points.add(v.key, cost, 'возврат за заказ')
      this.reply(e.platform, `@${e.user}, ${r.error}`)
    } else if (r.track) this.reply(e.platform, `@${e.user}, добавил в очередь: ${r.track.artist} — ${r.track.title}`)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.smtc.stop()
    this.spotify.cancelLogin()
  }
}

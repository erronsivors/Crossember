import { EventEmitter } from 'node:events'
import type { Store } from './db'
import type { Hub } from './hub'
import type { Settings } from './settings'
import type { HubEvent, Platform } from './types'

/**
 * Очки зрителей Crossember. Копятся за сообщения, минуты на эфире, донаты, подписки и т.д. на всех площадках,
 * тратятся в боте (команды, рулетка, дуэли), ставках, голосовании и заказе треков. Хранятся только локально (points.v1).
 * Зритель — «площадка:id» (или «площадка:ник», если id нет). Донатеров ищем по нику среди зрителей чата.
 */

export interface Viewer {
  key: string
  name: string
  platform: Platform
  balance: number
  earned: number
  spent: number
  firstSeen: number
  lastSeen: number
  /** Когда последний раз писал в чат (для начисления за минуты). */
  lastActive: number
  /** Когда последний раз получил очки за сообщение. */
  lastMsgAward: number
  /** Хоть раз писал в чат (молчащие из списка зрителей Twitch — нет). */
  chatted: boolean
}

export interface PointsLogEntry {
  ts: number
  name: string
  platform: Platform
  delta: number
  reason: string
}

export interface PointsState {
  count: number
  total: number
  top: Viewer[]
  log: PointsLogEntry[]
  /** Сейчас начисляются очки за минуты (эфир идёт или «только в эфире» выключено). */
  earning: boolean
  /** Последний опрос списка зрителей Twitch: сколько молчащих получили очки, или почему не удалось. */
  lurkers: { ts: number; count: number; error: string } | null
}

interface Data {
  viewers: Record<string, Viewer>
  log: PointsLogEntry[]
}

const VIEWER_LIMIT = 50_000
const LOG_LIMIT = 200
const LURKER_EVERY_MIN = 5

const lower = (s: string): string => s.toLowerCase().replace(/^@/, '').trim()
export const viewerKey = (platform: Platform, userId: string | undefined, name: string): string =>
  `${platform}:${userId && userId.length <= 64 ? userId : lower(name)}`

function load(raw: unknown): Data {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const viewers: Record<string, Viewer> = {}
  const src = o.viewers && typeof o.viewers === 'object' ? (o.viewers as Record<string, Record<string, unknown>>) : {}
  for (const [k, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object' || typeof v.name !== 'string' || k.length > 120) continue
    const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0)
    viewers[k] = {
      key: k, name: String(v.name).slice(0, 64), platform: String(v.platform ?? 'hub') as Platform,
      balance: Math.max(0, n(v.balance)), earned: n(v.earned), spent: n(v.spent), firstSeen: n(v.firstSeen), lastSeen: n(v.lastSeen),
      lastActive: 0, lastMsgAward: 0, chatted: v.c !== false
    }
  }
  const log = Array.isArray(o.log) ? (o.log as PointsLogEntry[]).filter((x) => x && typeof x.name === 'string').slice(0, LOG_LIMIT) : []
  return { viewers, log }
}

export class Points extends EventEmitter {
  private d: Data
  /** «площадка:ник» → ключ зрителя (для «@ник» в командах). */
  private names = new Map<string, string>()
  private saveTimer: NodeJS.Timeout | null = null
  private tick: NodeJS.Timeout | null = null
  private minutes = 0
  /** Кто уже писал в этом эфире (для повода «первое сообщение за эфир»). */
  private streamSeen = new Set<string>()
  private wasLive = false
  private lurkerInfo: PointsState['lurkers'] = null
  /** Список зрителей чата Twitch (задаёт index.ts); null — недоступно. */
  lurkers: (() => Promise<{ id: string; name: string }[] | null>) | null = null

  constructor(private store: Store, private settings: Settings, hub: Hub, private isLive: () => boolean, private own: () => string[]) {
    super()
    this.d = load(store.get<unknown>('points.v1', null))
    for (const v of Object.values(this.d.viewers)) this.names.set(`${v.platform}:${lower(v.name)}`, v.key)
    hub.on('event', (e: HubEvent) => this.onEvent(e))
    this.tick = setInterval(() => void this.onMinute(), 60_000)
  }

  private cfg() {
    return this.settings.get().points
  }

  get currency(): string {
    return this.cfg().name
  }

  state(): PointsState {
    const all = Object.values(this.d.viewers)
    const cfg = this.cfg()
    return {
      count: all.length,
      total: all.reduce((a, v) => a + v.balance, 0),
      top: all.filter((v) => v.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 30).map((v) => ({ ...v })),
      log: this.d.log.slice(0, 60),
      earning: cfg.enabled && (!cfg.onlyLive || this.isLive()),
      lurkers: this.lurkerInfo
    }
  }

  private changed(): void {
    this.emit('change')
    if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush() }, 2000)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.store.set('points.v1', {
      viewers: Object.fromEntries(Object.entries(this.d.viewers).map(([k, v]) => [k, { name: v.name, platform: v.platform, balance: v.balance, earned: v.earned, spent: v.spent, firstSeen: v.firstSeen, lastSeen: v.lastSeen, ...(v.chatted ? {} : { c: false }) }])),
      log: this.d.log
    })
  }

  private isOwn(name: string): boolean {
    const n = lower(name)
    return this.own().some((x) => lower(x) === n)
  }

  /** Найти или завести зрителя. */
  ensure(platform: Platform, userId: string | undefined, name: string): Viewer {
    const key = viewerKey(platform, userId, name)
    let v = this.d.viewers[key]
    const now = Date.now()
    if (!v) {
      // Тот же ник на этой площадке раньше был без id — переносим.
      const old = this.names.get(`${platform}:${lower(name)}`)
      const prev = old ? this.d.viewers[old] : undefined
      if (prev && old !== key) {
        delete this.d.viewers[old!]
        v = { ...prev, key }
      } else {
        v = { key, name: name.slice(0, 64), platform, balance: this.cfg().startBalance, earned: 0, spent: 0, firstSeen: now, lastSeen: now, lastActive: 0, lastMsgAward: 0, chatted: false }
      }
      this.d.viewers[key] = v
      this.prune()
    }
    if (name && v.name !== name) {
      this.names.delete(`${platform}:${lower(v.name)}`)
      v.name = name.slice(0, 64)
    }
    this.names.set(`${platform}:${lower(v.name)}`, key)
    v.lastSeen = now
    return v
  }

  private prune(): void {
    const all = Object.values(this.d.viewers)
    if (all.length <= VIEWER_LIMIT) return
    // Сначала уходят давно не заходившие без очков.
    all.sort((a, b) => (a.balance > 0 ? 1 : 0) - (b.balance > 0 ? 1 : 0) || a.lastSeen - b.lastSeen)
    for (const v of all.slice(0, all.length - VIEWER_LIMIT)) {
      delete this.d.viewers[v.key]
      this.names.delete(`${v.platform}:${lower(v.name)}`)
    }
  }

  get(key: string): Viewer | null {
    return this.d.viewers[key] ?? null
  }

  /** Зритель по нику: на этой площадке, иначе самый недавний с таким ником на любой. */
  byName(name: string, platform?: Platform): Viewer | null {
    const n = lower(name)
    if (!n) return null
    if (platform) {
      const k = this.names.get(`${platform}:${n}`)
      if (k && this.d.viewers[k]) return this.d.viewers[k]
    }
    let best: Viewer | null = null
    for (const v of Object.values(this.d.viewers)) if (lower(v.name) === n && (!best || v.lastSeen > best.lastSeen)) best = v
    return best
  }

  balanceOf(e: { platform: Platform; userId?: string; user: string }): number {
    return this.d.viewers[viewerKey(e.platform, e.userId, e.user)]?.balance ?? (this.byName(e.user, e.platform)?.balance ?? 0)
  }

  private log(v: Viewer, delta: number, reason: string): void {
    this.d.log.unshift({ ts: Date.now(), name: v.name, platform: v.platform, delta, reason: reason.slice(0, 80) })
    if (this.d.log.length > LOG_LIMIT) this.d.log.length = LOG_LIMIT
  }

  /** Начислить (n > 0) или снять (n < 0, не ниже нуля). Возвращает новый баланс. */
  add(key: string, n: number, reason = '', logIt = true): number {
    const v = this.d.viewers[key]
    if (!v || !Number.isFinite(n) || n === 0) return v?.balance ?? 0
    const delta = n > 0 ? Math.round(n) : -Math.min(v.balance, Math.round(-n))
    v.balance += delta
    if (delta > 0) v.earned += delta
    else v.spent -= delta
    if (logIt && delta !== 0) this.log(v, delta, reason)
    this.changed()
    return v.balance
  }

  /** Потратить: true, если хватило. */
  spend(key: string, n: number, reason: string): boolean {
    const v = this.d.viewers[key]
    const amount = Math.round(n)
    if (!v || amount < 0 || v.balance < amount) return false
    if (amount === 0) return true
    v.balance -= amount
    v.spent += amount
    this.log(v, -amount, reason)
    this.changed()
    return true
  }

  /** Передать очки от одного зрителя другому. */
  transfer(from: string, to: string, n: number): boolean {
    if (from === to || !this.d.viewers[to]) return false
    if (!this.spend(from, n, `передал ${this.d.viewers[to].name}`)) return false
    this.add(to, n, `от ${this.d.viewers[from]?.name ?? '?'}`)
    return true
  }

  setBalance(key: string, n: unknown): void {
    const v = this.d.viewers[key]
    if (!v || typeof n !== 'number' || !Number.isFinite(n)) return
    const target = Math.max(0, Math.min(1_000_000_000, Math.round(n)))
    this.add(key, target - v.balance, 'вручную')
  }

  /** Добавить очки по нику (из интерфейса): создаёт зрителя, если такого ещё нет. */
  adjustByName(name: unknown, platform: unknown, n: unknown): number {
    if (typeof name !== 'string' || !name.trim() || typeof n !== 'number' || !Number.isFinite(n)) throw new Error('Укажите ник и число')
    const p = (typeof platform === 'string' && platform ? platform : 'twitch') as Platform
    const v = this.byName(name.trim(), p) ?? this.ensure(p, undefined, name.trim().replace(/^@/, '').slice(0, 64))
    return this.add(v.key, n, n > 0 ? 'выдано вручную' : 'снято вручную')
  }

  remove(key: string): void {
    const v = this.d.viewers[key]
    if (!v) return
    delete this.d.viewers[key]
    this.names.delete(`${v.platform}:${lower(v.name)}`)
    this.changed()
  }

  search(q: unknown, limit = 50): Viewer[] {
    const n = typeof q === 'string' ? lower(q) : ''
    const all = Object.values(this.d.viewers)
    const list = n ? all.filter((v) => lower(v.name).includes(n)) : all
    return list.sort((a, b) => b.balance - a.balance).slice(0, Math.min(200, limit)).map((v) => ({ ...v }))
  }

  top(n: number): Viewer[] {
    return Object.values(this.d.viewers).filter((v) => v.balance > 0 && !this.isOwn(v.name)).sort((a, b) => b.balance - a.balance).slice(0, n)
  }

  /** Место зрителя в рейтинге (1 — первый). */
  rank(key: string): number {
    const v = this.d.viewers[key]
    if (!v) return 0
    return Object.values(this.d.viewers).filter((x) => x.balance > v.balance).length + 1
  }

  resetAll(): void {
    for (const v of Object.values(this.d.viewers)) { v.balance = this.cfg().startBalance; v.earned = 0; v.spent = 0 }
    this.d.log = []
    this.changed()
  }

  clearLog(): void {
    this.d.log = []
    this.changed()
  }

  private earningNow(): boolean {
    const cfg = this.cfg()
    return cfg.enabled && (!cfg.onlyLive || this.isLive())
  }

  private onEvent(e: HubEvent): void {
    if (e.test || e.type === 'system') return
    const cfg = this.cfg()
    if (e.type === 'message') {
      if (!e.user || this.isOwn(e.user)) return
      const v = this.ensure(e.platform, e.userId, e.user)
      // Впервые пишет в чат — повод «новый зритель» (молчащий зритель Twitch тоже, когда заговорит).
      if (!v.chatted) {
        v.chatted = true
        this.emit('new', v, e)
      }
      const now = Date.now()
      v.lastActive = now
      // Первое сообщение зрителя за эфир — повод для правил.
      if (this.isLive() && !this.streamSeen.has(v.key)) {
        this.streamSeen.add(v.key)
        this.emit('first', v, e)
      }
      if (this.earningNow() && cfg.perMessage > 0 && now - v.lastMsgAward >= cfg.messageCooldownSec * 1000) {
        v.lastMsgAward = now
        this.add(v.key, cfg.perMessage, '', false)
      } else this.changed()
      return
    }
    if (!cfg.enabled || !e.user) return
    let n = 0
    let reason = ''
    switch (e.type) {
      case 'donation': n = Math.floor((e.amountRub ?? 0) * cfg.perRub); reason = 'донат'; break
      case 'follow': n = cfg.perFollow; reason = 'фоллоу'; break
      case 'sub': n = cfg.perSub; reason = 'подписка'; break
      case 'gift': n = cfg.perGift * Math.max(1, e.amount ?? 1); reason = 'подарил подписки'; break
      case 'raid': n = cfg.perRaid; reason = 'рейд'; break
      case 'bits': n = Math.floor((e.amount ?? 0) / 100) * cfg.perBits100; reason = 'биты'; break
      default: return
    }
    if (n <= 0 || e.user === 'Аноним') return
    // Донат приходит с сайта донатов — ищем того же зрителя в чатах по нику.
    const v = e.type === 'donation' ? (this.byName(e.user) ?? this.ensure(e.platform, undefined, e.user)) : this.ensure(e.platform, e.userId, e.user)
    this.add(v.key, n, reason)
  }

  private async onMinute(): Promise<void> {
    const live = this.isLive()
    if (live && !this.wasLive) this.streamSeen.clear()
    this.wasLive = live
    if (!this.earningNow()) return
    const cfg = this.cfg()
    const now = Date.now()
    const active = new Set<string>()
    if (cfg.perMinute > 0) {
      for (const v of Object.values(this.d.viewers)) {
        if (v.lastActive && now - v.lastActive <= cfg.activeMin * 60_000) {
          active.add(v.key)
          v.balance += cfg.perMinute
          v.earned += cfg.perMinute
        }
      }
      if (active.size) this.changed()
    }
    // Молчащие зрители Twitch — раз в несколько минут, сразу за все эти минуты.
    this.minutes++
    if (cfg.twitchLurkers && cfg.perMinute > 0 && this.lurkers && this.minutes % LURKER_EVERY_MIN === 0) {
      try {
        const list = await this.lurkers()
        if (!list) { this.lurkerInfo = { ts: now, count: 0, error: 'Нужно право на список зрителей — войдите в Twitch заново' }; return }
        let count = 0
        for (const u of list) {
          if (!u.name || this.isOwn(u.name)) continue
          const v = this.ensure('twitch', u.id, u.name)
          if (active.has(v.key)) continue
          v.balance += cfg.perMinute * LURKER_EVERY_MIN
          v.earned += cfg.perMinute * LURKER_EVERY_MIN
          count++
        }
        this.lurkerInfo = { ts: now, count, error: '' }
        this.changed()
      } catch (e) {
        this.lurkerInfo = { ts: now, count: 0, error: (e as Error).message.slice(0, 200) }
      }
    }
  }

  stop(): void {
    if (this.tick) clearInterval(this.tick)
    this.tick = null
    this.flush()
  }
}

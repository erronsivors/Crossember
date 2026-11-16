import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { Store } from './db'
import type { Hub } from './hub'
import type { Settings } from './settings'
import type { Points } from './points'
import { parseAmount } from './bot'
import type { HubEvent, Platform } from './types'
import type { TwitchPredictionEvent } from './twitch'

/**
 * Ставки (прогнозы) с оверлеем. Два источника:
 * - «свои очки»: зрители всех площадок ставят очки Crossember командой «!ставка 1 500», выплата как у Twitch
 *   (банк проигравших делится между угадавшими пропорционально ставкам);
 * - «Twitch»: родной прогноз Twitch на баллы канала (компаньоны и партнёры), банк и ставки приходят из EventSub.
 */

export type BetStatus = 'open' | 'locked' | 'resolved' | 'canceled'
export type BetSource = 'own' | 'twitch'

export interface BetOutcome {
  id: string
  num: number
  name: string
  pool: number
  users: number
  twId?: string
  top: { name: string; amount: number }[]
}

export interface BetEntry {
  key: string
  name: string
  platform: Platform
  outcome: string
  amount: number
  ts: number
}

export interface Bet {
  id: string
  source: BetSource
  title: string
  outcomes: BetOutcome[]
  status: BetStatus
  createdAt: number
  locksAt: number | null
  winner: string | null
  twitchId: string | null
  entries: BetEntry[]
  /** Итог: кто сколько выиграл (только свои очки). */
  payouts: { name: string; won: number }[]
  endedAt: number | null
}

export interface BetView extends Omit<Bet, 'entries'> {
  total: number
  bettors: number
  recent: BetEntry[]
}

export interface BetsArchiveItem {
  id: string
  ts: number
  source: BetSource
  title: string
  winner: string
  total: number
  bettors: number
  canceled: boolean
}

export interface BetsState {
  bet: BetView | null
  archive: BetsArchiveItem[]
  twitch: 'ok' | 'login' | 'relogin'
  currency: string
}

export interface BetsOverlayView {
  bet: (BetView & { coefs: Record<string, number> }) | null
  currency: string
  cmd: string
}

export interface TwitchPredictions {
  access: () => 'ok' | 'login' | 'relogin'
  create: (title: string, outcomes: string[], sec: number) => Promise<{ id: string; outcomes: { id: string; title: string }[]; locksAt: number | null }>
  end: (id: string, status: 'LOCKED' | 'RESOLVED' | 'CANCELED', winner?: string) => Promise<void>
}

const ARCHIVE_LIMIT = 30
const s = (v: unknown, max = 200): string => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)

/** Коэффициент исхода: весь банк / банк исхода (сколько получит 1 очко при победе). */
export function coefficient(total: number, pool: number): number {
  return pool > 0 ? Math.round((total / pool) * 100) / 100 : 0
}

/** Выплаты по системе тотализатора: угадавшие делят весь банк пропорционально ставкам. */
export function payouts(entries: BetEntry[], winner: string): { key: string; name: string; won: number }[] {
  const total = entries.reduce((a, x) => a + x.amount, 0)
  const win = entries.filter((x) => x.outcome === winner)
  const pool = win.reduce((a, x) => a + x.amount, 0)
  if (!pool) return []
  return win.map((x) => ({ key: x.key, name: x.name, won: Math.floor((x.amount * total) / pool) }))
}

function load(raw: unknown): { bet: Bet | null; archive: BetsArchiveItem[] } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { bet?: Bet | null; archive?: BetsArchiveItem[] }
  const bet = o.bet && typeof o.bet === 'object' && Array.isArray(o.bet.outcomes) && Array.isArray(o.bet.entries) ? o.bet : null
  return { bet, archive: Array.isArray(o.archive) ? o.archive.slice(0, ARCHIVE_LIMIT) : [] }
}

export class Bets extends EventEmitter {
  private bet: Bet | null
  private archive: BetsArchiveItem[]
  private saveTimer: NodeJS.Timeout | null = null
  private tick: NodeJS.Timeout | null = null
  private tw: TwitchPredictions | null = null

  constructor(private store: Store, private settings: Settings, hub: Hub, private points: Points) {
    super()
    const d = load(store.get<unknown>('bets.v1', null))
    this.bet = d.bet
    this.archive = d.archive
    hub.on('event', (e: HubEvent) => this.onEvent(e))
    this.syncTick()
  }

  setTwitch(t: TwitchPredictions): void {
    this.tw = t
  }

  private view(b: Bet | null): BetView | null {
    if (!b) return null
    const { entries, ...rest } = b
    return {
      ...rest,
      outcomes: b.outcomes.map((o) => ({ ...o, top: [...o.top] })),
      total: b.outcomes.reduce((a, o) => a + o.pool, 0),
      bettors: b.outcomes.reduce((a, o) => a + o.users, 0),
      recent: entries.slice(-15).reverse()
    }
  }

  state(): BetsState {
    return { bet: this.view(this.bet), archive: [...this.archive], twitch: this.tw?.access() ?? 'login', currency: this.settings.get().points.name }
  }

  overlay(): BetsOverlayView {
    const v = this.view(this.bet)
    const cfg = this.settings.get()
    return {
      bet: v ? { ...v, coefs: Object.fromEntries(v.outcomes.map((o) => [o.id, coefficient(v.total, o.pool)])) } : null,
      currency: v?.source === 'twitch' ? 'баллов' : cfg.points.name,
      cmd: cfg.bets.cmd
    }
  }

  private changed(): void {
    this.emit('change')
    if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush() }, 500)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.store.set('bets.v1', { bet: this.bet, archive: this.archive })
  }

  private syncTick(): void {
    const need = !!this.bet && this.bet.status === 'open' && !!this.bet.locksAt
    if (need && !this.tick) this.tick = setInterval(() => this.onTick(), 1000)
    if (!need && this.tick) { clearInterval(this.tick); this.tick = null }
  }

  private onTick(): void {
    const b = this.bet
    if (!b || b.status !== 'open' || !b.locksAt) return this.syncTick()
    if (Date.now() >= b.locksAt) {
      // Прогноз Twitch закрывает сам Twitch (придёт событие lock).
      if (b.source === 'own') void this.lock()
      else this.syncTick()
    }
  }

  /** Начать ставки. Предыдущие завершённые уходят в архив; идущие — нельзя. */
  async start(raw: unknown): Promise<void> {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if (this.bet && (this.bet.status === 'open' || this.bet.status === 'locked')) throw new Error('Сначала подведите итог или отмените текущие ставки')
    const source: BetSource = o.source === 'twitch' ? 'twitch' : 'own'
    const title = s(o.title, source === 'twitch' ? 45 : 120)
    const names = (Array.isArray(o.outcomes) ? o.outcomes : []).map((x) => s(x, source === 'twitch' ? 25 : 60)).filter(Boolean).slice(0, 10)
    if (!title) throw new Error('Напишите вопрос')
    if (names.length < 2) throw new Error('Нужно хотя бы два исхода')
    const secRaw = typeof o.sec === 'number' && Number.isFinite(o.sec) ? Math.round(o.sec) : this.settings.get().bets.defaultSec
    const sec = Math.max(0, Math.min(86_400, secRaw))
    this.retire()
    const now = Date.now()
    const outcomes: BetOutcome[] = names.map((name, i) => ({ id: randomUUID().slice(0, 8), num: i + 1, name, pool: 0, users: 0, top: [] }))
    let twitchId: string | null = null
    let locksAt = sec > 0 ? now + sec * 1000 : null
    if (source === 'twitch') {
      if (!this.tw) throw new Error('Twitch не подключён')
      const r = await this.tw.create(title, names, sec > 0 ? sec : 300)
      twitchId = r.id
      locksAt = r.locksAt
      r.outcomes.forEach((x, i) => { if (outcomes[i]) outcomes[i].twId = x.id })
    }
    this.bet = { id: randomUUID(), source, title, outcomes, status: 'open', createdAt: now, locksAt, winner: null, twitchId, entries: [], payouts: [], endedAt: null }
    this.changed()
    this.syncTick()
    this.emit('started', this.view(this.bet))
  }

  /** Убрать завершённые ставки в архив. */
  private retire(): void {
    const b = this.bet
    if (!b || b.status === 'open' || b.status === 'locked') return
    this.archive.unshift({
      id: b.id, ts: b.endedAt ?? Date.now(), source: b.source, title: b.title,
      winner: b.outcomes.find((o) => o.id === b.winner)?.name ?? '', total: b.outcomes.reduce((a, o) => a + o.pool, 0),
      bettors: b.outcomes.reduce((a, o) => a + o.users, 0), canceled: b.status === 'canceled'
    })
    if (this.archive.length > ARCHIVE_LIMIT) this.archive.length = ARCHIVE_LIMIT
    this.bet = null
  }

  close(): void {
    if (this.bet && (this.bet.status === 'open' || this.bet.status === 'locked')) throw new Error('Ставки ещё идут — подведите итог или отмените')
    this.retire()
    this.changed()
  }

  async lock(): Promise<string> {
    const b = this.bet
    if (!b || b.status !== 'open') return 'Ставки сейчас не принимаются'
    if (b.source === 'twitch' && b.twitchId && this.tw) await this.tw.end(b.twitchId, 'LOCKED')
    b.status = 'locked'
    b.locksAt = null
    this.changed()
    this.syncTick()
    this.emit('locked', this.view(b))
    return `Ставки закрыты. В банке ${b.outcomes.reduce((a, o) => a + o.pool, 0).toLocaleString('ru-RU')}`
  }

  /** Подвести итог: победил исход с номером num (1…). */
  async resolve(num: number): Promise<string> {
    const b = this.bet
    if (!b || (b.status !== 'open' && b.status !== 'locked')) return 'Нет ставок, по которым можно подвести итог'
    const win = b.outcomes.find((o) => o.num === num)
    if (!win) return `Нет исхода №${num}`
    if (b.source === 'twitch') {
      if (b.twitchId && this.tw && win.twId) await this.tw.end(b.twitchId, 'RESOLVED', win.twId)
    } else {
      const list = payouts(b.entries, win.id)
      for (const p of list) this.points.add(p.key, p.won, `ставка «${b.title.slice(0, 30)}»`)
      b.payouts = list.map((p) => ({ name: p.name, won: p.won })).sort((x, y) => y.won - x.won)
    }
    b.status = 'resolved'
    b.winner = win.id
    b.locksAt = null
    b.endedAt = Date.now()
    this.changed()
    this.syncTick()
    this.emit('resolved', this.view(b))
    const who = b.payouts.slice(0, 5).map((p) => `${p.name} +${p.won.toLocaleString('ru-RU')}`).join(', ')
    return `Итог: ${win.name}${b.source === 'own' ? (who ? `. Выиграли: ${who}` : '. Никто не угадал') : ''}`
  }

  /** Отменить: свои очки возвращаются всем. */
  async cancel(): Promise<string> {
    const b = this.bet
    if (!b || (b.status !== 'open' && b.status !== 'locked')) return 'Нет идущих ставок'
    if (b.source === 'twitch' && b.twitchId && this.tw) await this.tw.end(b.twitchId, 'CANCELED')
    if (b.source === 'own') for (const x of b.entries) this.points.add(x.key, x.amount, 'возврат ставки')
    b.status = 'canceled'
    b.locksAt = null
    b.endedAt = Date.now()
    this.changed()
    this.syncTick()
    this.emit('canceled', this.view(b))
    return 'Ставки отменены, очки возвращены'
  }

  /** Продлить или сократить приём: +sec (может быть отрицательным). Только свои очки. */
  extend(sec: unknown): void {
    const b = this.bet
    if (!b || b.status !== 'open' || b.source !== 'own' || typeof sec !== 'number' || !Number.isFinite(sec)) return
    const base = b.locksAt ?? Date.now()
    b.locksAt = Math.max(Date.now() + 5000, base + Math.round(sec) * 1000)
    this.changed()
    this.syncTick()
  }

  /** Ставка вручную из интерфейса (например, за зрителя без чата). */
  manual(name: unknown, platform: unknown, num: unknown, amount: unknown): void {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Укажите ник')
    const p = (typeof platform === 'string' && platform ? platform : 'twitch') as Platform
    const v = this.points.byName(name.trim(), p) ?? this.points.ensure(p, undefined, name.trim())
    const r = this.place({ key: v.key, name: v.name, platform: v.platform }, Number(num), String(amount))
    if (r) throw new Error(r)
  }

  /** Принять ставку. Возвращает текст ошибки или '' при успехе. */
  private place(who: { key: string; name: string; platform: Platform }, num: number, rawAmount: string): string {
    const b = this.bet
    const cfg = this.settings.get().bets
    if (!b || b.status !== 'open' || b.source !== 'own') return 'Ставки сейчас не принимаются'
    const out = b.outcomes.find((o) => o.num === num)
    if (!out) return `Нет исхода №${num}`
    const v = this.points.get(who.key)
    if (!v) return 'Зритель не найден'
    const amount = parseAmount(rawAmount, Math.min(v.balance, cfg.maxBet))
    if (!amount) return `Сумма: число от ${cfg.minBet}`
    const prev = b.entries.find((x) => x.key === who.key)
    if (prev && prev.outcome !== out.id) return `Ставка уже на «${b.outcomes.find((o) => o.id === prev.outcome)?.name}» — на другой исход нельзя`
    const already = prev?.amount ?? 0
    if (amount < cfg.minBet && !prev) return `Минимальная ставка ${cfg.minBet}`
    if (already + amount > cfg.maxBet) return `Максимум ${cfg.maxBet.toLocaleString('ru-RU')} на одни ставки`
    if (!this.points.spend(who.key, amount, `ставка «${b.title.slice(0, 30)}»`)) return `Не хватает (у тебя ${v.balance.toLocaleString('ru-RU')})`
    if (prev) { prev.amount += amount; prev.ts = Date.now() } else {
      b.entries.push({ key: who.key, name: who.name, platform: who.platform, outcome: out.id, amount, ts: Date.now() })
      out.users++
    }
    out.pool += amount
    out.top = b.entries.filter((x) => x.outcome === out.id).sort((x, y) => y.amount - x.amount).slice(0, 5).map((x) => ({ name: x.name, amount: x.amount }))
    this.changed()
    return ''
  }

  private onEvent(e: HubEvent): void {
    if (e.type !== 'message' || e.test) return
    const b = this.bet
    if (!b || b.status !== 'open' || b.source !== 'own' || !this.settings.get().points.enabled) return
    const cmd = this.settings.get().bets.cmd
    const text = (e.text ?? '').trim()
    const low = text.toLowerCase()
    if (low !== cmd && !low.startsWith(cmd + ' ')) return
    const m = /^(\d{1,2})\s+(\S+)$/.exec(text.slice(cmd.length).trim())
    if (!m) return
    const v = this.points.ensure(e.platform, e.userId, e.user)
    const err = this.place({ key: v.key, name: v.name, platform: e.platform }, Number(m[1]), m[2])
    if (err) this.emit('reject', e, err)
  }

  /** События прогноза Twitch: банк, ставки и итог приходят оттуда. Прогноз, начатый на Twitch, тоже подхватываем. */
  twitchEvent(ev: TwitchPredictionEvent): void {
    let b = this.bet
    if (!b || b.twitchId !== ev.id) {
      if (ev.phase !== 'begin' && ev.phase !== 'progress') return
      if (b && (b.status === 'open' || b.status === 'locked')) return
      this.retire()
      b = this.bet = {
        id: randomUUID(), source: 'twitch', title: s(ev.title, 45), status: 'open', createdAt: Date.now(), locksAt: ev.locksAt, winner: null,
        twitchId: ev.id, entries: [], payouts: [], endedAt: null,
        outcomes: ev.outcomes.map((o, i) => ({ id: randomUUID().slice(0, 8), num: i + 1, name: s(o.title, 25), pool: 0, users: 0, twId: o.id, top: [] }))
      }
      this.emit('started', this.view(b))
    }
    for (const o of ev.outcomes) {
      const mine = b.outcomes.find((x) => x.twId === o.id)
      if (!mine) continue
      mine.pool = o.points
      mine.users = o.users
      mine.top = o.top.map((t) => ({ name: s(t.name, 64), amount: t.points }))
    }
    if (ev.phase === 'lock' && b.status === 'open') { b.status = 'locked'; b.locksAt = null; this.emit('locked', this.view(b)) }
    if (ev.phase === 'end' && (b.status === 'open' || b.status === 'locked')) {
      b.locksAt = null
      b.endedAt = Date.now()
      if (ev.status === 'resolved') {
        b.status = 'resolved'
        b.winner = b.outcomes.find((x) => x.twId === ev.winner)?.id ?? null
        const w = ev.outcomes.find((o) => o.id === ev.winner)
        b.payouts = (w?.top ?? []).map((t) => ({ name: s(t.name, 64), won: t.won })).filter((p) => p.won > 0)
        this.emit('resolved', this.view(b))
      } else {
        b.status = 'canceled'
        this.emit('canceled', this.view(b))
      }
    }
    this.changed()
    this.syncTick()
  }

  clearArchive(): void {
    this.archive = []
    this.changed()
  }

  stop(): void {
    if (this.tick) clearInterval(this.tick)
    this.tick = null
    this.flush()
  }
}

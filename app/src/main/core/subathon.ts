import { EventEmitter } from 'node:events'
import type { Store } from './db'
import type { Hub } from './hub'
import type { Settings } from './settings'
import type { HubEvent, Platform } from './types'

/**
 * Таймер-сабатон: эфир длится, пока не кончится таймер, а подписки, донаты, биты, фолловы и рейды добавляют время.
 * «Счастливый час» умножает добавки. Предел по длительности — по желанию.
 */

export interface SubathonAdd {
  ts: number
  user: string
  platform: Platform
  sec: number
  reason: string
}

export interface SubathonState {
  running: boolean
  /** Когда кончится (идёт) или сколько осталось (пауза), мс. */
  endsAt: number | null
  pausedLeft: number | null
  startedAt: number | null
  /** Всего добавлено секунд. */
  added: number
  happy: boolean
  /** Таймер дошёл до нуля. */
  ended: boolean
  /** Упёрлись в предел длительности. */
  capped: boolean
  log: SubathonAdd[]
}

const LOG_LIMIT = 60

export class Subathon extends EventEmitter {
  private st: SubathonState
  private tick: NodeJS.Timeout | null = null
  private saveTimer: NodeJS.Timeout | null = null

  constructor(private store: Store, private settings: Settings, hub: Hub) {
    super()
    const d = store.get<Partial<SubathonState>>('subathon.v1', {})
    this.st = {
      running: d.running === true, endsAt: typeof d.endsAt === 'number' ? d.endsAt : null, pausedLeft: typeof d.pausedLeft === 'number' ? d.pausedLeft : null,
      startedAt: typeof d.startedAt === 'number' ? d.startedAt : null, added: Number(d.added) || 0, happy: d.happy === true, ended: d.ended === true,
      capped: false, log: Array.isArray(d.log) ? d.log.slice(0, LOG_LIMIT) : []
    }
    hub.on('event', (e: HubEvent) => this.onEvent(e))
    this.syncTick()
  }

  state(): SubathonState {
    return { ...this.st, log: [...this.st.log] }
  }

  private changed(): void {
    this.emit('change')
    if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush() }, 500)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.store.set('subathon.v1', this.st)
  }

  private syncTick(): void {
    const need = this.st.running && !!this.st.endsAt
    if (need && !this.tick) this.tick = setInterval(() => this.onTick(), 1000)
    if (!need && this.tick) { clearInterval(this.tick); this.tick = null }
  }

  private onTick(): void {
    if (!this.st.running || !this.st.endsAt) return this.syncTick()
    if (Date.now() >= this.st.endsAt) {
      this.st.running = false
      this.st.endsAt = null
      this.st.pausedLeft = 0
      this.st.ended = true
      this.changed()
      this.syncTick()
      this.emit('ended')
    }
  }

  left(): number {
    if (this.st.endsAt) return Math.max(0, this.st.endsAt - Date.now())
    return this.st.pausedLeft ?? 0
  }

  start(min?: unknown): void {
    const m = typeof min === 'number' && Number.isFinite(min) && min > 0 ? Math.min(100_000, min) : this.settings.get().subathon.startMin
    const now = Date.now()
    this.st = { running: true, endsAt: now + Math.round(m * 60_000), pausedLeft: null, startedAt: now, added: 0, happy: false, ended: false, capped: false, log: [] }
    this.changed()
    this.syncTick()
  }

  pause(v: boolean): void {
    if (v && this.st.running && this.st.endsAt) {
      this.st.pausedLeft = Math.max(0, this.st.endsAt - Date.now())
      this.st.endsAt = null
      this.st.running = false
    } else if (!v && !this.st.running && (this.st.pausedLeft ?? 0) > 0) {
      this.st.endsAt = Date.now() + (this.st.pausedLeft ?? 0)
      this.st.pausedLeft = null
      this.st.running = true
      this.st.ended = false
    } else return
    this.changed()
    this.syncTick()
  }

  stop(): void {
    this.st.running = false
    this.st.endsAt = null
    this.st.pausedLeft = null
    this.st.startedAt = null
    this.changed()
    this.syncTick()
  }

  setHappy(v: boolean): void {
    this.st.happy = v
    this.changed()
  }

  /** Добавить (или убрать, sec < 0) время. Учитывает предел длительности. Возвращает фактически добавленное. */
  add(sec: number, user = 'Стример', platform: Platform = 'hub', reason = 'вручную'): number {
    if (!Number.isFinite(sec) || sec === 0 || this.st.startedAt === null) return 0
    const cfg = this.settings.get().subathon
    const left = this.left()
    let next = Math.max(0, left + Math.round(sec * 1000))
    this.st.capped = false
    if (cfg.maxHours > 0 && sec > 0) {
      // Предел — общая длительность сабатона с начала.
      const elapsed = Date.now() - this.st.startedAt
      const cap = cfg.maxHours * 3_600_000 - elapsed
      if (next > cap) { next = Math.max(left, cap); this.st.capped = true }
    }
    const delta = Math.round((next - left) / 1000)
    if (delta === 0 && sec > 0) { this.changed(); return 0 }
    if (this.st.endsAt) this.st.endsAt = Date.now() + next
    else this.st.pausedLeft = next
    if (delta > 0) this.st.added += delta
    this.st.log.unshift({ ts: Date.now(), user: user.slice(0, 64), platform, sec: delta, reason: reason.slice(0, 60) })
    if (this.st.log.length > LOG_LIMIT) this.st.log.length = LOG_LIMIT
    this.changed()
    this.emit('added', { user, sec: delta, reason })
    return delta
  }

  private onEvent(e: HubEvent): void {
    if (e.test || this.st.startedAt === null || (!this.st.running && !this.st.pausedLeft)) return
    const cfg = this.settings.get().subathon
    const k = this.st.happy ? cfg.multiplier : 1
    let sec = 0
    let reason = ''
    switch (e.type) {
      case 'sub': sec = cfg.perSubSec; reason = 'подписка'; break
      case 'gift': sec = cfg.perGiftSec * Math.max(1, e.amount ?? 1); reason = `подарил ${e.amount ?? 1} подп.`; break
      case 'follow': sec = cfg.perFollowSec; reason = 'фоллоу'; break
      case 'donation': sec = Math.floor((e.amountRub ?? 0) / 100) * cfg.perRub100Sec; reason = `донат ${Math.round(e.amountRub ?? 0)} ₽`; break
      case 'bits': sec = Math.floor((e.amount ?? 0) / 100) * cfg.perBits100Sec; reason = `${e.amount} битов`; break
      case 'raid': sec = cfg.perRaidSec; reason = 'рейд'; break
      default: return
    }
    if (sec > 0) this.add(sec * k, e.user, e.platform, k > 1 ? `${reason} ×${k}` : reason)
  }

  dispose(): void {
    if (this.tick) clearInterval(this.tick)
    this.tick = null
    this.flush()
  }
}

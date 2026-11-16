import { EventEmitter } from 'node:events'
import type { Store } from './db'
import type { Hub } from './hub'
import type { Settings } from './settings'
import type { HubEvent } from './types'
import type { TwitchReward, TwitchRewardInput } from './twitch'

/**
 * Награды за баллы канала Twitch: список наград, создание и правка (только наград Crossember),
 * очередь активаций «кто что выбрал» с кнопками «выполнено» и «вернуть баллы».
 * Вернуть баллы и отметить выполненным через API можно только у наград, созданных этим приложением (правило Twitch).
 * У награды Crossember может быть действие: заказ трека, свои очки, время в сабатон, мемкоины Memealerts.
 */

export type RewardAction = 'none' | 'track' | 'points' | 'subathon' | 'memecoins'
export const REWARD_ACTIONS: Record<RewardAction, string> = { none: 'Без действия (в очередь)', track: 'Заказ трека (Spotify)', points: 'Начислить свои очки', subathon: 'Добавить время в сабатон', memecoins: 'Выдать мемкоины Memealerts' }

export interface RewardMeta {
  action: RewardAction
  /** Сколько своих очков начислить или секунд добавить. */
  amount: number
  /** Сразу отмечать выполненной (не держать в очереди), если действие прошло. */
  autoDone: boolean
}

export interface Redemption {
  id: string
  rewardId: string
  title: string
  user: string
  userId: string
  input: string
  cost: number
  ts: number
  status: 'new' | 'done' | 'refunded' | 'failed'
  /** Награда создана Crossember (можно вернуть баллы). */
  own: boolean
  note: string
}

export interface RewardsState {
  rewards: (TwitchReward & { own: boolean })[]
  meta: Record<string, RewardMeta>
  queue: Redemption[]
  done: Redemption[]
  loadedAt: number | null
  error: string
  access: 'ok' | 'login' | 'relogin'
}

export interface RewardsApi {
  access: () => 'ok' | 'login' | 'relogin'
  list: (onlyOwn: boolean) => Promise<TwitchReward[]>
  create: (r: TwitchRewardInput) => Promise<TwitchReward>
  update: (id: string, r: Partial<TwitchRewardInput>) => Promise<TwitchReward>
  remove: (id: string) => Promise<void>
  setStatus: (rewardId: string, ids: string[], status: 'FULFILLED' | 'CANCELED') => Promise<void>
}

/** Выполнить действие награды. Возвращает '' при успехе или текст ошибки. */
export type RewardRunner = (action: RewardAction, meta: RewardMeta, e: HubEvent, input: string) => Promise<string>

const QUEUE_LIMIT = 300
const DONE_LIMIT = 100
const s = (v: unknown, max = 200): string => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
const num = (v: unknown, d: number, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d)

export function sanitizeRewardInput(raw: unknown, partial: boolean): Partial<TwitchRewardInput> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Partial<TwitchRewardInput> = {}
  if (o.title !== undefined || !partial) { out.title = s(o.title, 45); if (!out.title) throw new Error('Название награды не может быть пустым') }
  if (o.cost !== undefined || !partial) out.cost = num(o.cost, 100, 1, 1_000_000_000)
  if (o.prompt !== undefined || !partial) out.prompt = s(o.prompt, 200)
  if (o.inputRequired !== undefined || !partial) out.inputRequired = o.inputRequired === true
  if (o.enabled !== undefined || !partial) out.enabled = o.enabled !== false
  if (o.paused !== undefined) out.paused = o.paused === true
  if (o.color !== undefined && typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color)) out.color = o.color
  if (o.cooldownSec !== undefined || !partial) out.cooldownSec = num(o.cooldownSec, 0, 0, 604_800)
  if (o.maxPerStream !== undefined || !partial) out.maxPerStream = num(o.maxPerStream, 0, 0, 100_000)
  if (o.maxPerUser !== undefined || !partial) out.maxPerUser = num(o.maxPerUser, 0, 0, 100_000)
  if (o.skipQueue !== undefined) out.skipQueue = o.skipQueue === true
  return out
}

function sanitizeMeta(raw: unknown): RewardMeta {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const action: RewardAction = o.action === 'track' || o.action === 'points' || o.action === 'subathon' || o.action === 'memecoins' ? o.action : 'none'
  return { action, amount: num(o.amount, action === 'subathon' ? 60 : 100, 0, 100_000_000), autoDone: o.autoDone !== false }
}

export class Rewards extends EventEmitter {
  private list: (TwitchReward & { own: boolean })[] = []
  private meta: Record<string, RewardMeta>
  private queue: Redemption[]
  private done: Redemption[]
  private loadedAt: number | null = null
  private error = ''
  private api: RewardsApi | null = null
  private saveTimer: NodeJS.Timeout | null = null
  run: RewardRunner = async () => ''

  constructor(private store: Store, private settings: Settings, hub: Hub) {
    super()
    const d = store.get<{ meta?: Record<string, unknown>; queue?: Redemption[]; done?: Redemption[] }>('rewards.v1', {})
    this.meta = Object.fromEntries(Object.entries(d.meta ?? {}).filter(([k]) => /^[\w-]{1,100}$/.test(k)).map(([k, v]) => [k, sanitizeMeta(v)]))
    this.queue = Array.isArray(d.queue) ? d.queue.slice(0, QUEUE_LIMIT) : []
    this.done = Array.isArray(d.done) ? d.done.slice(0, DONE_LIMIT) : []
    hub.on('event', (e: HubEvent) => { if (e.type === 'reward' && e.platform === 'twitch' && !e.test) void this.onRedeem(e) })
  }

  setApi(api: RewardsApi): void {
    this.api = api
  }

  state(): RewardsState {
    return {
      rewards: this.list.map((r) => ({ ...r })), meta: { ...this.meta }, queue: [...this.queue], done: this.done.slice(0, 50),
      loadedAt: this.loadedAt, error: this.error, access: this.api?.access() ?? 'login'
    }
  }

  private changed(): void {
    this.emit('change')
    if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush() }, 500)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.store.set('rewards.v1', { meta: this.meta, queue: this.queue, done: this.done })
  }

  private need(): RewardsApi {
    if (!this.api || this.api.access() === 'login') throw new Error('Twitch не подключён — войдите в «Подключениях»')
    return this.api
  }

  /** Загрузить список наград с Twitch и отметить, какие созданы Crossember. */
  async refresh(): Promise<void> {
    const api = this.need()
    try {
      const [all, own] = await Promise.all([api.list(false), api.access() === 'ok' ? api.list(true).catch(() => []) : Promise.resolve([])])
      const mine = new Set(own.map((r) => r.id))
      this.list = all.map((r) => ({ ...r, own: mine.has(r.id) })).sort((a, b) => Number(b.own) - Number(a.own) || a.cost - b.cost)
      this.loadedAt = Date.now()
      this.error = ''
    } catch (e) {
      this.error = (e as Error).message
      if (/403/.test(this.error) || /запретил/.test(this.error)) this.error = 'Награды за баллы доступны компаньонам и партнёрам Twitch'
    }
    this.changed()
  }

  async create(raw: unknown, metaRaw: unknown): Promise<void> {
    const api = this.need()
    const r = await api.create(sanitizeRewardInput(raw, false) as TwitchRewardInput)
    if (r.id) this.meta[r.id] = sanitizeMeta(metaRaw)
    this.list = [{ ...r, own: true }, ...this.list.filter((x) => x.id !== r.id)]
    this.changed()
  }

  async update(id: string, raw: unknown): Promise<void> {
    const api = this.need()
    const r = await api.update(id, sanitizeRewardInput(raw, true))
    this.list = this.list.map((x) => (x.id === id ? { ...r, own: true } : x))
    this.changed()
  }

  async remove(id: string): Promise<void> {
    await this.need().remove(id)
    this.list = this.list.filter((x) => x.id !== id)
    delete this.meta[id]
    this.changed()
  }

  setMeta(id: string, raw: unknown): void {
    if (!/^[\w-]{1,100}$/.test(id)) return
    this.meta[id] = sanitizeMeta(raw)
    this.changed()
  }

  /** Поставить на паузу или снять с паузы все награды Crossember. */
  async pauseAll(v: boolean): Promise<void> {
    const api = this.need()
    const own = this.list.filter((r) => r.own)
    const errors: string[] = []
    for (const r of own) {
      try {
        const u = await api.update(r.id, { paused: v })
        this.list = this.list.map((x) => (x.id === r.id ? { ...u, own: true } : x))
      } catch (e) { errors.push(`${r.title}: ${(e as Error).message}`) }
    }
    this.changed()
    if (errors.length) throw new Error(errors.join('; '))
  }

  private isOwn(rewardId: string): boolean {
    const r = this.list.find((x) => x.id === rewardId)
    return r ? r.own : !!this.meta[rewardId]
  }

  private async onRedeem(e: HubEvent): Promise<void> {
    if (!e.redemption) return
    const title = e.reward ?? ''
    const input = e.text && title && e.text.startsWith(title) ? e.text.slice(title.length).replace(/^\s*—\s*/, '') : ''
    const item: Redemption = {
      id: e.redemption.id, rewardId: e.redemption.rewardId, title, user: e.user, userId: e.userId ?? '', input: s(input, 300),
      cost: e.amount ?? 0, ts: e.ts, status: 'new', own: this.isOwn(e.redemption.rewardId), note: ''
    }
    if (this.queue.some((x) => x.id === item.id)) return
    this.queue.unshift(item)
    if (this.queue.length > QUEUE_LIMIT) this.queue.length = QUEUE_LIMIT
    this.changed()
    const meta = this.meta[item.rewardId]
    if (!meta || meta.action === 'none') return
    let err = ''
    try {
      err = await this.run(meta.action, meta, e, item.input)
    } catch (x) {
      err = (x as Error).message
    }
    if (err) {
      item.note = err
      if (item.own && this.settings.get().rewards.refundOnFail) await this.refund(item.id).catch(() => undefined)
      else { item.status = 'failed'; this.changed() }
      this.emit('failed', item, err)
      return
    }
    if (meta.autoDone) await this.fulfill(item.id).catch(() => undefined)
  }

  private async setStatus(ids: string[], status: 'done' | 'refunded'): Promise<void> {
    const items = this.queue.filter((x) => ids.includes(x.id))
    if (!items.length) return
    if (status === 'refunded' && items.some((x) => !x.own)) throw new Error('Вернуть баллы можно только за награды, созданные в Crossember')
    const byReward = new Map<string, string[]>()
    for (const x of items.filter((i) => i.own)) byReward.set(x.rewardId, [...(byReward.get(x.rewardId) ?? []), x.id])
    const errors: string[] = []
    if (this.api && this.api.access() !== 'login') {
      for (const [rid, list] of byReward) {
        try { await this.api.setStatus(rid, list, status === 'done' ? 'FULFILLED' : 'CANCELED') } catch (e) { errors.push((e as Error).message) }
      }
    }
    if (errors.length && status === 'refunded') { this.changed(); throw new Error(errors.join('; ')) }
    for (const x of items) {
      x.status = status
      this.queue = this.queue.filter((q) => q.id !== x.id)
      this.done.unshift(x)
    }
    if (this.done.length > DONE_LIMIT) this.done.length = DONE_LIMIT
    this.changed()
  }

  fulfill(id: string): Promise<void> {
    return this.setStatus([id], 'done')
  }

  refund(id: string): Promise<void> {
    return this.setStatus([id], 'refunded')
  }

  fulfillAll(): Promise<void> {
    return this.setStatus(this.queue.map((x) => x.id), 'done')
  }

  /** Статус поменяли на самом Twitch (панель стримера). */
  onTwitchUpdate(id: string, status: string): void {
    const x = this.queue.find((q) => q.id === id)
    if (!x || (status !== 'fulfilled' && status !== 'canceled')) return
    x.status = status === 'fulfilled' ? 'done' : 'refunded'
    this.queue = this.queue.filter((q) => q.id !== id)
    this.done.unshift(x)
    if (this.done.length > DONE_LIMIT) this.done.length = DONE_LIMIT
    this.changed()
  }

  clearDone(): void {
    this.done = []
    this.changed()
  }

  stop(): void {
    this.flush()
  }
}

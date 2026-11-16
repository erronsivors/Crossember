import { shell } from 'electron'
import type { Hub } from '../hub'
import type { Settings } from '../settings'
import type { Secrets } from '../secrets'
import type { Badge, HubEvent, TwitchAccount, TwitchState, ViewerRole } from '../types'
import type { TwitchPollEvent } from '../vote'
import { SHARED_CLIENT_ID, TwitchAuth, type DeviceStart, type Role } from './auth'
import { EmoteCache } from './emotes'
import type { ImageCache } from '../imgcache'
import type { ChatConnector, ChatPlatformState } from '../connector'

const HELIX = 'https://api.twitch.tv/helix'
const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30'

type Json = Record<string, unknown>
const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v))

/** Подписки EventSub: тип, версия, условие (b — id канала). Нужные права указаны в SCOPES. */
const SUBS: { type: string; version: string; cond: (b: string) => Json }[] = [
  { type: 'channel.chat.message', version: '1', cond: (b) => ({ broadcaster_user_id: b, user_id: b }) },
  { type: 'channel.chat.message_delete', version: '1', cond: (b) => ({ broadcaster_user_id: b, user_id: b }) },
  { type: 'channel.chat.clear_user_messages', version: '1', cond: (b) => ({ broadcaster_user_id: b, user_id: b }) },
  { type: 'channel.chat.clear', version: '1', cond: (b) => ({ broadcaster_user_id: b, user_id: b }) },
  { type: 'channel.follow', version: '2', cond: (b) => ({ broadcaster_user_id: b, moderator_user_id: b }) },
  { type: 'channel.subscribe', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'channel.subscription.gift', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'channel.subscription.message', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'channel.cheer', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'channel.raid', version: '1', cond: (b) => ({ to_broadcaster_user_id: b }) },
  { type: 'channel.channel_points_custom_reward_redemption.add', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'channel.poll.begin', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'channel.poll.progress', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'channel.poll.end', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'channel.prediction.begin', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'channel.prediction.progress', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'channel.prediction.lock', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'channel.prediction.end', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'channel.channel_points_custom_reward_redemption.update', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'stream.online', version: '1', cond: (b) => ({ broadcaster_user_id: b }) },
  { type: 'stream.offline', version: '1', cond: (b) => ({ broadcaster_user_id: b }) }
]

/** Twitch: вход, чат и события через EventSub WebSocket, онлайн, отправка и модерация. */
export class TwitchConnector implements ChatConnector {
  readonly id = 'twitch' as const
  readonly auth: TwitchAuth
  private emotes: EmoteCache
  private ws: WebSocket | null = null
  private keepaliveTimer: NodeJS.Timeout | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private viewersTimer: NodeJS.Timeout | null = null
  private validateTimer: NodeJS.Timeout | null = null
  private retryDelay = 2000
  private device: (DeviceStart & { role: Role }) | null = null
  private generation = 0
  live = false
  viewers: number | null = null
  onChange: () => void = () => undefined
  /** Голосование Twitch: начато, идёт, закончено (подключается к модулю голосования). */
  onPoll: (e: TwitchPollEvent) => void = () => undefined
  /** Прогноз Twitch: начат, идёт, закрыт, итог (подключается к модулю ставок). */
  onPrediction: (e: TwitchPredictionEvent) => void = () => undefined
  /** Активацию награды выполнили или вернули на Twitch (статус fulfilled / canceled). */
  onRedemptionUpdate: (id: string, status: string) => void = () => undefined

  constructor(private hub: Hub, private settings: Settings, secrets: Secrets, img: ImageCache) {
    this.emotes = new EmoteCache(img)
    hub.register('twitch', 'Twitch')
    this.auth = new TwitchAuth(secrets, () => this.clientId())
  }

  clientId(): string {
    return this.settings.get().twitch.customClientId || SHARED_CLIENT_ID
  }

  state(): TwitchState {
    return {
      clientIdSource: this.settings.get().twitch.customClientId ? 'custom' : SHARED_CLIENT_ID ? 'shared' : 'none',
      broadcaster: this.auth.account('broadcaster'),
      bot: this.auth.account('bot'),
      pending: this.device ? { role: this.device.role, userCode: this.device.userCode, uri: this.device.uri, expiresAt: this.device.expiresAt } : null,
      live: this.live,
      viewers: this.viewers,
      emotes: { twitch: true, thirdParty: this.emotes.thirdPartyCount() }
    }
  }

  chatState(): ChatPlatformState {
    const me = this.auth.account('broadcaster')
    return {
      id: 'twitch', name: 'Twitch', configured: !!me, live: this.live, viewers: this.viewers,
      canSend: !!me, canModerate: !!me, account: me?.name ?? null
    }
  }

  // ---------- вход / выход ----------

  async login(role: Role): Promise<void> {
    this.device?.cancel()
    const d = await this.auth.startDevice(role)
    this.device = { ...d, role }
    this.onChange()
    if (/^https:\/\/(www\.)?twitch\.tv\//.test(d.uri)) void shell.openExternal(d.uri)
    try {
      const acc = await d.wait()
      this.hub.log('twitch', 'info', `${role === 'bot' ? 'Бот' : 'Стример'} вошёл: ${acc.login}`)
      if (role === 'broadcaster') await this.start()
    } catch (e) {
      this.hub.log('twitch', 'warn', (e as Error).message)
      throw e
    } finally {
      if (this.device?.userCode === d.userCode) this.device = null
      this.onChange()
    }
  }

  cancelLogin(): void {
    this.device?.cancel()
    this.device = null
    this.onChange()
  }

  async logout(role: Role): Promise<void> {
    await this.auth.logout(role)
    if (role === 'broadcaster') this.stop('off', 'Не подключено')
    this.onChange()
  }

  // ---------- жизненный цикл ----------

  async start(): Promise<void> {
    const me = this.auth.account('broadcaster')
    if (!me) return this.hub.setStatus('twitch', 'off', this.clientId() ? 'Не подключено — нажмите «Войти»' : 'Нужен Client ID приложения Twitch')
    this.stop('connecting', 'Подключение…', false)
    const gen = ++this.generation
    try {
      const token = await this.auth.token('broadcaster')
      const acc = await this.auth.validate(token)
      if (!acc) await this.auth.token('broadcaster', true)
      await this.loadUser(me.id)
      await this.loadBadges(me.id)
      void this.warmTwitchEmotes(me.id)
      if (this.settings.get().twitch.thirdPartyEmotes && /^\d+$/.test(me.id)) {
        void this.emotes.loadThirdParty(me.id, (m) => this.hub.log('twitch', 'warn', m)).then(() => this.onChange())
      } else this.emotes.clearThirdParty()
      if (gen !== this.generation) return
      this.connect(EVENTSUB_URL, gen)
      this.pollViewers()
      this.viewersTimer = setInterval(() => this.pollViewers(), 60_000)
      this.validateTimer = setInterval(() => void this.validateHourly(), 60 * 60_000)
    } catch (e) {
      this.hub.setStatus('twitch', 'error', (e as Error).message)
      this.scheduleRetry(gen)
    }
  }

  stop(state: 'off' | 'connecting' = 'off', detail = 'Отключено', bump = true): void {
    if (bump) this.generation++
    for (const t of [this.keepaliveTimer, this.retryTimer]) if (t) clearTimeout(t)
    for (const t of [this.viewersTimer, this.validateTimer]) if (t) clearInterval(t)
    this.keepaliveTimer = this.retryTimer = this.viewersTimer = this.validateTimer = null
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.hub.setStatus('twitch', state, detail)
  }

  /** Перезапуск, например после смены Client ID или настроек смайлов. */
  async restart(): Promise<void> {
    this.stop('connecting', 'Перезапуск…')
    await this.start()
  }

  private scheduleRetry(gen: number): void {
    if (gen !== this.generation || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (gen === this.generation) void this.start()
    }, this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, 60_000)
  }

  private async validateHourly(): Promise<void> {
    for (const role of ['broadcaster', 'bot'] as Role[]) {
      if (!this.auth.account(role)) continue
      try {
        const t = await this.auth.token(role)
        if (!(await this.auth.validate(t))) await this.auth.token(role, true)
      } catch (e) {
        this.hub.log('twitch', 'error', `${role === 'bot' ? 'Бот' : 'Стример'}: ${(e as Error).message}`)
        this.onChange()
      }
    }
  }

  // ---------- Helix ----------

  private async helix(path: string, init: RequestInit = {}, role: Role = 'broadcaster'): Promise<Response> {
    const call = async (token: string): Promise<Response> =>
      fetch(`${HELIX}${path}`, {
        ...init,
        signal: AbortSignal.timeout(15_000),
        headers: { 'Client-Id': this.clientId(), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }
      })
    let res = await call(await this.auth.token(role))
    if (res.status === 401) res = await call(await this.auth.token(role, true))
    return res
  }

  private async loadUser(id: string): Promise<void> {
    const res = await this.helix(`/users?id=${encodeURIComponent(id)}`)
    if (!res.ok) throw new Error(`Twitch API: ${res.status}`)
    const u = ((await res.json()) as { data: Json[] }).data[0]
    if (u) this.auth.setName('broadcaster', s(u.display_name) || s(u.login))
  }

  private async loadBadges(id: string): Promise<void> {
    for (const path of ['/chat/badges/global', `/chat/badges?broadcaster_id=${encodeURIComponent(id)}`]) {
      const res = await this.helix(path).catch(() => null)
      if (res?.ok) this.emotes.addBadges(await res.json())
    }
  }

  /** Смайлы Twitch канала и глобальные — скачать в кэш заранее. */
  private async warmTwitchEmotes(id: string): Promise<void> {
    for (const path of [`/chat/emotes?broadcaster_id=${encodeURIComponent(id)}`, '/chat/emotes/global']) {
      const res = await this.helix(path).catch(() => null)
      if (res?.ok) this.emotes.warmTwitchEmotes(await res.json())
    }
  }

  private async pollViewers(): Promise<void> {
    const me = this.auth.account('broadcaster')
    if (!me) return
    try {
      const res = await this.helix(`/streams?user_id=${encodeURIComponent(me.id)}`)
      if (!res.ok) return
      const st = ((await res.json()) as { data: Json[] }).data[0]
      this.live = !!st
      this.viewers = st ? Number(st.viewer_count) || 0 : null
      this.onChange()
    } catch {
      /* сеть — попробуем в следующий раз */
    }
  }

  // ---------- EventSub WebSocket ----------

  private connect(url: string, gen: number, old?: WebSocket): void {
    const ws = new WebSocket(url)
    ws.onmessage = (m) => {
      if (gen !== this.generation) return
      let msg: Json
      try {
        msg = JSON.parse(String(m.data)) as Json
      } catch {
        return
      }
      void this.onSocketMessage(ws, msg, gen, old).catch((e) => this.hub.log('twitch', 'error', (e as Error).message))
    }
    ws.onclose = () => {
      if (gen !== this.generation || this.ws !== ws) return
      this.ws = null
      this.hub.setStatus('twitch', 'connecting', 'Соединение с Twitch потеряно — переподключение…')
      this.scheduleRetry(gen)
    }
    ws.onerror = () => undefined
  }

  private armKeepalive(seconds: number, gen: number): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer)
    this.keepaliveTimer = setTimeout(() => {
      if (gen !== this.generation) return
      this.hub.log('twitch', 'warn', 'Twitch молчит дольше положенного — переподключаюсь')
      this.ws?.close()
    }, (seconds + 10) * 1000)
  }

  private async onSocketMessage(ws: WebSocket, msg: Json, gen: number, old?: WebSocket): Promise<void> {
    const meta = (msg.metadata ?? {}) as Json
    const payload = (msg.payload ?? {}) as Json
    const type = s(meta.message_type)
    if (type !== 'session_reconnect') this.armKeepalive(30, gen)

    if (type === 'session_welcome') {
      const session = payload.session as Json
      this.ws = ws
      old?.close()
      if (old) return // после reconnect подписки переносятся автоматически
      await this.subscribeAll(s(session.id), gen)
      return
    }
    if (type === 'session_reconnect') {
      const url = s((payload.session as Json)?.reconnect_url)
      if (url.startsWith('wss://eventsub.wss.twitch.tv/')) this.connect(url, gen, ws)
      return
    }
    if (type === 'revocation') {
      this.hub.log('twitch', 'warn', `Twitch отозвал подписку: ${s((payload.subscription as Json)?.type)}`)
      return
    }
    if (type === 'notification') this.onNotification(s((payload.subscription as Json)?.type), (payload.event ?? {}) as Json, s(meta.message_id))
  }

  private async subscribeAll(sessionId: string, gen: number): Promise<void> {
    const me = this.auth.account('broadcaster')
    if (!me) return
    // Результат по каждой подписке: код ответа Twitch или null (запрос не дошёл — сеть).
    const results = await Promise.all(
      SUBS.map(async (sub) => {
        const res = await this.helix('/eventsub/subscriptions', {
          method: 'POST',
          body: JSON.stringify({ type: sub.type, version: sub.version, condition: sub.cond(me.id), transport: { method: 'websocket', session_id: sessionId } })
        }).catch(() => null)
        return { type: sub.type, status: res ? res.status : null, ok: !!res && (res.ok || res.status === 409) }
      })
    )
    if (gen !== this.generation) return
    const ok = results.filter((r) => r.ok).length
    const failed = results.filter((r) => !r.ok)
    const chat = results.find((r) => r.type === 'channel.chat.message')
    // Чат не подписался из-за сети (а не отказа Twitch) — это не «подключено»: переподключаемся заново.
    if (chat && !chat.ok && chat.status === null) {
      this.hub.setStatus('twitch', 'connecting', 'Не удалось подписаться на чат Twitch (нет связи) — переподключение…')
      this.ws?.close()
      return
    }
    this.retryDelay = 2000
    if (failed.length) this.hub.log('twitch', 'warn', `Не удалось подписаться: ${failed.map((f) => `${f.type}${f.status === null ? ' (нет связи)' : ` (${f.status})`}`).join(', ')}. Часть событий (сабы, биты) доступна только компаньонам/партнёрам.`)
    const chatOk = !!chat?.ok
    this.hub.setStatus('twitch', chatOk ? 'ok' : 'error', chatOk ? `Подключено · ${me.name} · подписок: ${ok}/${SUBS.length}` : 'Чат не подключился — смотрите журнал')
  }

  private badgesOf(list: unknown): Badge[] {
    const out: Badge[] = []
    for (const b of Array.isArray(list) ? (list as Json[]) : []) {
      const badge = this.emotes.badge(s(b.set_id), s(b.id))
      if (badge) out.push(badge)
    }
    return out
  }

  /** msgId — id доставки EventSub: при повторной доставке Twitch присылает тот же, по нему хаб отсекает повтор. */
  private onNotification(type: string, e: Json, msgId = ''): void {
    const base = { platform: 'twitch' as const, id: msgId ? `tw-${msgId.slice(0, 90)}` : undefined }
    switch (type) {
      case 'channel.chat.message': {
        const message = (e.message ?? {}) as Json
        this.hub.push({
          ...base,
          type: 'message',
          id: s(e.message_id) || undefined,
          user: s(e.chatter_user_name) || s(e.chatter_user_login),
          userId: s(e.chatter_user_id),
          text: s(message.text),
          parts: this.emotes.parts(message.fragments),
          badges: this.badgesOf(e.badges),
          color: s(e.color),
          role: roleOf(e.badges)
        })
        break
      }
      case 'channel.chat.message_delete':
        this.hub.deleteMessage(s(e.message_id))
        break
      case 'channel.chat.clear_user_messages':
        this.hub.deleteUserMessages('twitch', s(e.target_user_id))
        break
      case 'channel.chat.clear':
        this.hub.clearChat('twitch')
        break
      case 'channel.follow':
        this.hub.push({ ...base, type: 'follow', user: s(e.user_name), userId: s(e.user_id) })
        break
      case 'channel.subscribe':
        if (!e.is_gift) this.hub.push({ ...base, type: 'sub', user: s(e.user_name), userId: s(e.user_id), text: `Уровень ${tier(e.tier)}` })
        break
      case 'channel.subscription.message':
        this.hub.push({
          ...base, type: 'sub', user: s(e.user_name), userId: s(e.user_id),
          text: s((e.message as Json)?.text) || `${s(e.cumulative_months)} мес. вместе`
        })
        break
      case 'channel.subscription.gift':
        this.hub.push({
          ...base, type: 'gift', user: e.is_anonymous ? 'Аноним' : s(e.user_name), userId: s(e.user_id),
          amount: Number(e.total) || 1, text: `Подарил подписок: ${s(e.total)}`
        })
        break
      case 'channel.cheer':
        this.hub.push({
          ...base, type: 'bits', user: e.is_anonymous ? 'Аноним' : s(e.user_name), userId: s(e.user_id),
          amount: Number(e.bits) || 0, currency: 'bits', text: s(e.message)
        })
        break
      case 'channel.raid':
        this.hub.push({
          ...base, type: 'raid', user: s(e.from_broadcaster_user_name), userId: s(e.from_broadcaster_user_id),
          amount: Number(e.viewers) || 0, text: `${s(e.viewers)} зрителей`
        })
        break
      case 'channel.channel_points_custom_reward_redemption.add':
        this.hub.push({
          ...base, type: 'reward', user: s(e.user_name), userId: s(e.user_id),
          amount: Number((e.reward as Json)?.cost) || 0, currency: 'points', reward: s((e.reward as Json)?.title),
          redemption: { id: s(e.id), rewardId: s((e.reward as Json)?.id) },
          text: [s((e.reward as Json)?.title), s(e.user_input)].filter(Boolean).join(' — ')
        })
        break
      case 'channel.poll.begin':
      case 'channel.poll.progress':
      case 'channel.poll.end': {
        const choices = (Array.isArray(e.choices) ? (e.choices as Json[]) : []).map((c) => ({ id: s(c.id), title: s(c.title), votes: Number(c.votes) || 0 }))
        const ends = Date.parse(s(e.ends_at || e.ended_at))
        this.onPoll({
          phase: type === 'channel.poll.begin' ? 'begin' : type === 'channel.poll.progress' ? 'progress' : 'end',
          id: s(e.id), title: s(e.title), choices, endsAt: Number.isFinite(ends) ? ends : null, status: s(e.status)
        })
        break
      }
      case 'channel.prediction.begin':
      case 'channel.prediction.progress':
      case 'channel.prediction.lock':
      case 'channel.prediction.end': {
        const outcomes = (Array.isArray(e.outcomes) ? (e.outcomes as Json[]) : []).map((o) => ({
          id: s(o.id), title: s(o.title), points: Number(o.channel_points) || 0, users: Number(o.users) || 0,
          top: (Array.isArray(o.top_predictors) ? (o.top_predictors as Json[]) : []).slice(0, 5).map((t) => ({ name: s(t.user_name), points: Number(t.channel_points_used) || 0, won: Number(t.channel_points_won) || 0 }))
        }))
        const locks = Date.parse(s(e.locks_at))
        this.onPrediction({
          phase: type.slice('channel.prediction.'.length) as TwitchPredictionEvent['phase'],
          id: s(e.id), title: s(e.title), outcomes, locksAt: Number.isFinite(locks) ? locks : null,
          status: s(e.status), winner: s(e.winning_outcome_id)
        })
        break
      }
      case 'channel.channel_points_custom_reward_redemption.update':
        this.onRedemptionUpdate(s(e.id), s(e.status))
        break
      case 'stream.online':
        this.live = true
        void this.pollViewers()
        this.onChange()
        break
      case 'stream.offline':
        this.live = false
        this.viewers = null
        this.onChange()
        break
    }
  }

  // ---------- действия ----------

  async send(text: string, opts: { as?: Role; replyTo?: string } = {}): Promise<void> {
    const as: Role = opts.as === 'bot' && this.auth.account('bot') ? 'bot' : 'broadcaster'
    const replyTo = opts.replyTo
    const me = this.auth.account('broadcaster')
    const sender = this.auth.account(as)
    if (!me || !sender) throw new Error(as === 'bot' ? 'Бот не подключён' : 'Twitch не подключён')
    const message = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500)
    if (!message) return
    const body: Json = { broadcaster_id: me.id, sender_id: sender.id, message }
    if (replyTo && /^[\w-]{1,100}$/.test(replyTo)) body.reply_parent_message_id = replyTo
    const res = await this.helix('/chat/messages', { method: 'POST', body: JSON.stringify(body) }, as)
    const j = (await res.json().catch(() => ({}))) as { data?: { is_sent?: boolean; drop_reason?: { message?: string } }[] }
    if (!res.ok) throw new Error(`Twitch не принял сообщение (${res.status})`)
    const r = j.data?.[0]
    if (r && !r.is_sent) throw new Error(`Сообщение отклонено: ${r.drop_reason?.message ?? 'без причины'}`)
  }

  async deleteMessage(m: HubEvent): Promise<void> {
    if (m.platform === 'twitch') await this.deleteById(m.id)
  }

  async ban(m: HubEvent, seconds: number): Promise<void> {
    if (m.platform === 'twitch' && m.userId) await this.banUser(m.userId, seconds, 'Crossember')
  }

  // ---------- название и категория эфира ----------

  /** Можно ли менять название: вошёл стример и у входа есть право channel:manage:broadcast (появилось в этапе 5). */
  /** Голосования: нужно право channel:manage:polls (старый вход его не давал). */
  pollAccess(): 'ok' | 'login' | 'relogin' {
    if (!this.auth.account('broadcaster')) return 'login'
    return this.auth.hasScope('broadcaster', 'channel:manage:polls') ? 'ok' : 'relogin'
  }

  /** Создать голосование Twitch. Доступно компаньонам и партнёрам. */
  async createPoll(title: string, choices: string[], sec: number, pointsPerVote: number): Promise<{ id: string; endsAt: number | null; choices: { id: string; title: string }[] }> {
    const me = this.auth.account('broadcaster')
    if (!me) throw new Error('Twitch не подключён')
    const body: Json = { broadcaster_id: me.id, title: title.slice(0, 60), choices: choices.slice(0, 5).map((c) => ({ title: c.slice(0, 25) })), duration: Math.min(1800, Math.max(15, Math.round(sec))) }
    if (pointsPerVote > 0) { body.channel_points_voting_enabled = true; body.channel_points_per_vote = Math.min(1_000_000, Math.round(pointsPerVote)) }
    const res = await this.helix('/polls', { method: 'POST', body: JSON.stringify(body) })
    const j = (await res.json().catch(() => ({}))) as { data?: Json[]; message?: string }
    if (!res.ok) {
      if (res.status === 403) throw new Error('Twitch не разрешил голосование: оно доступно только компаньонам и партнёрам')
      if (res.status === 401) throw new Error('Нужно новое разрешение на голосования — войдите в Twitch заново (Подключения → Twitch)')
      throw new Error(`Twitch не создал голосование (${res.status}${j.message ? `: ${String(j.message).slice(0, 120)}` : ''})`)
    }
    const d = j.data?.[0] ?? {}
    const started = Date.parse(s(d.started_at))
    const dur = Number(d.duration) || sec
    return {
      id: s(d.id),
      endsAt: Number.isFinite(started) ? started + dur * 1000 : null,
      choices: (Array.isArray(d.choices) ? (d.choices as Json[]) : []).map((c) => ({ id: s(c.id), title: s(c.title) }))
    }
  }

  /** Завершить голосование Twitch досрочно (итог остаётся виден на Twitch). */
  async endPoll(id: string): Promise<void> {
    const me = this.auth.account('broadcaster')
    if (!me || !id) return
    const res = await this.helix('/polls', { method: 'PATCH', body: JSON.stringify({ broadcaster_id: me.id, id, status: 'TERMINATED' }) })
    if (!res.ok && res.status !== 400) throw new Error(`Twitch не завершил голосование (${res.status})`)
  }

  infoAccess(): 'ok' | 'login' | 'relogin' {
    if (!this.auth.account('broadcaster')) return 'login'
    return this.auth.hasScope('broadcaster', 'channel:manage:broadcast') ? 'ok' : 'relogin'
  }

  /** Поиск категорий (игр) по названию. */
  async searchCategories(q: string): Promise<{ id: string; name: string }[]> {
    if (!this.auth.account('broadcaster') || !q.trim()) return []
    const res = await this.helix(`/search/categories?first=8&query=${encodeURIComponent(q.trim().slice(0, 100))}`)
    if (!res.ok) throw new Error(`Twitch API: ${res.status}`)
    return ((await res.json()) as { data?: Json[] }).data?.map((c) => ({ id: s(c.id), name: s(c.name) })).filter((c) => /^\d{1,20}$/.test(c.id)) ?? []
  }

  /** Текущие название и категория канала. */
  async channelInfo(): Promise<{ title: string; game: string }> {
    const me = this.auth.account('broadcaster')
    if (!me) throw new Error('Не выполнен вход в Twitch')
    const res = await this.helix(`/channels?broadcaster_id=${encodeURIComponent(me.id)}`)
    if (!res.ok) throw new Error(`Twitch API: ${res.status}`)
    const c = ((await res.json()) as { data?: Json[] }).data?.[0] ?? {}
    return { title: s(c.title), game: s(c.game_name) }
  }

  /** Сменить название и (если найдена) категорию. Возвращает, какая категория поставлена. */
  async setChannelInfo(title: string, game: string): Promise<string> {
    const me = this.auth.account('broadcaster')
    if (!me) throw new Error('Не выполнен вход в Twitch')
    if (this.infoAccess() === 'relogin') throw new Error('Нужно новое разрешение — войдите в Twitch заново (Подключения → Twitch)')
    const body: Json = { title: title.slice(0, 140) }
    let gameName = ''
    if (game.trim()) {
      const found = await this.searchCategories(game)
      const pick = found.find((c) => c.name.toLowerCase() === game.trim().toLowerCase()) ?? found[0]
      if (!pick) throw new Error(`Категория «${game}» на Twitch не найдена`)
      body.game_id = pick.id
      gameName = pick.name
    }
    const res = await this.helix(`/channels?broadcaster_id=${encodeURIComponent(me.id)}`, { method: 'PATCH', body: JSON.stringify(body) })
    if (res.status === 401 || res.status === 403) throw new Error('Twitch не дал прав — войдите заново (Подключения → Twitch)')
    if (!res.ok) throw new Error(`Twitch API: ${res.status}`)
    return gameName
  }

  // ---------- общий вызов API для панели, наград и прогнозов ----------

  /** Есть ли у входа стримера право scope. */
  access(scope: string): 'ok' | 'login' | 'relogin' {
    if (!this.auth.account('broadcaster')) return 'login'
    return this.auth.hasScope('broadcaster', scope) ? 'ok' : 'relogin'
  }

  private me(): TwitchAccount {
    const me = this.auth.account('broadcaster')
    if (!me) throw new Error('Twitch не подключён — войдите в «Подключениях»')
    return me
  }

  /** Запрос к Helix с понятной ошибкой. scope — какое право нужно (для подсказки «войдите заново»). */
  private async api(method: string, path: string, body?: unknown, scope?: string): Promise<Json> {
    if (scope && this.access(scope) === 'relogin') throw new Error('Нужно новое разрешение — войдите в Twitch заново (Подключения → Twitch)')
    const res = await this.helix(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (res.status === 204) return {}
    const j = (await res.json().catch(() => ({}))) as Json
    if (!res.ok) {
      const msg = s(j.message).slice(0, 160)
      if (res.status === 401) throw new Error('Twitch не дал прав — войдите заново (Подключения → Twitch)')
      if (res.status === 403) throw new Error(`Twitch запретил действие${msg ? `: ${msg}` : ''}`)
      if (res.status === 429) throw new Error('Twitch просит подождать — слишком часто')
      throw new Error(`Twitch: ${res.status}${msg ? ` — ${msg}` : ''}`)
    }
    return j
  }

  /** Канал по нику (логину). */
  async userByLogin(login: string): Promise<{ id: string; login: string; name: string } | null> {
    const l = login.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/[/?#].*$/, '').toLowerCase()
    if (!/^[a-z0-9_]{1,25}$/.test(l)) throw new Error('Ник Twitch: латиница, цифры и _')
    const j = await this.api('GET', `/users?login=${encodeURIComponent(l)}`)
    const u = (Array.isArray(j.data) ? (j.data as Json[]) : [])[0]
    return u ? { id: s(u.id), login: s(u.login), name: s(u.display_name) || s(u.login) } : null
  }

  private async needUser(login: string): Promise<{ id: string; login: string; name: string }> {
    const u = await this.userByLogin(login)
    if (!u) throw new Error(`Канал «${login}» на Twitch не найден`)
    return u
  }

  /** Все зрители в чате (для очков молчащим). null — нет права. */
  async chatters(): Promise<{ id: string; name: string }[] | null> {
    const me = this.auth.account('broadcaster')
    if (!me || this.access('moderator:read:chatters') !== 'ok') return null
    const out: { id: string; name: string }[] = []
    let cursor = ''
    for (let page = 0; page < 10; page++) {
      const j = await this.api('GET', `/chat/chatters?broadcaster_id=${me.id}&moderator_id=${me.id}&first=1000${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`)
      for (const u of Array.isArray(j.data) ? (j.data as Json[]) : []) out.push({ id: s(u.user_id), name: s(u.user_name) || s(u.user_login) })
      cursor = s((j.pagination as Json | undefined)?.cursor)
      if (!cursor) break
    }
    return out
  }

  // ---------- панель канала ----------

  async startRaid(login: string): Promise<string> {
    const me = this.me()
    const to = await this.needUser(login)
    if (to.id === me.id) throw new Error('Нельзя рейдить свой канал')
    await this.api('POST', `/raids?from_broadcaster_id=${me.id}&to_broadcaster_id=${to.id}`, undefined, 'channel:manage:raids')
    return to.name
  }

  async cancelRaid(): Promise<void> {
    const me = this.me()
    await this.api('DELETE', `/raids?broadcaster_id=${me.id}`, undefined, 'channel:manage:raids')
  }

  async shoutout(login: string): Promise<string> {
    const me = this.me()
    const to = await this.needUser(login)
    await this.api('POST', `/chat/shoutouts?from_broadcaster_id=${me.id}&to_broadcaster_id=${to.id}&moderator_id=${me.id}`, undefined, 'moderator:manage:shoutouts')
    return to.name
  }

  async banLogin(login: string, seconds: number, reason = ''): Promise<string> {
    const u = await this.needUser(login)
    await this.banUser(u.id, seconds, reason || 'Crossember')
    return u.name
  }

  async unbanLogin(login: string): Promise<string> {
    const me = this.me()
    const u = await this.needUser(login)
    await this.api('DELETE', `/moderation/bans?broadcaster_id=${me.id}&moderator_id=${me.id}&user_id=${u.id}`)
    return u.name
  }

  async chatSettings(): Promise<TwitchChatSettings> {
    const me = this.me()
    const j = await this.api('GET', `/chat/settings?broadcaster_id=${me.id}&moderator_id=${me.id}`)
    const d = (Array.isArray(j.data) ? (j.data as Json[]) : [])[0] ?? {}
    return {
      slow: d.slow_mode === true, slowSec: Number(d.slow_mode_wait_time) || 0,
      followers: d.follower_mode === true, followersMin: Number(d.follower_mode_duration) || 0,
      subs: d.subscriber_mode === true, emotes: d.emote_mode === true, unique: d.unique_chat_mode === true
    }
  }

  async setChatSettings(p: Partial<TwitchChatSettings>): Promise<TwitchChatSettings> {
    const me = this.me()
    const body: Json = {}
    if (p.slow !== undefined) body.slow_mode = p.slow
    if (p.slow && p.slowSec !== undefined) body.slow_mode_wait_time = Math.min(120, Math.max(3, Math.round(p.slowSec)))
    if (p.followers !== undefined) body.follower_mode = p.followers
    if (p.followers && p.followersMin !== undefined) body.follower_mode_duration = Math.min(129_600, Math.max(0, Math.round(p.followersMin)))
    if (p.subs !== undefined) body.subscriber_mode = p.subs
    if (p.emotes !== undefined) body.emote_mode = p.emotes
    if (p.unique !== undefined) body.unique_chat_mode = p.unique
    await this.api('PATCH', `/chat/settings?broadcaster_id=${me.id}&moderator_id=${me.id}`, body, 'moderator:manage:chat_settings')
    return this.chatSettings()
  }

  async commercial(sec: number): Promise<number> {
    const me = this.me()
    const length = [30, 60, 90, 120, 150, 180].includes(sec) ? sec : 30
    const j = await this.api('POST', '/channels/commercial', { broadcaster_id: me.id, length }, 'channel:edit:commercial')
    const d = (Array.isArray(j.data) ? (j.data as Json[]) : [])[0] ?? {}
    return Number(d.length) || length
  }

  async marker(description: string): Promise<void> {
    const me = this.me()
    await this.api('POST', '/streams/markers', { user_id: me.id, description: description.slice(0, 140) }, 'channel:manage:broadcast')
  }

  async clip(): Promise<{ id: string; url: string; editUrl: string }> {
    const me = this.me()
    const j = await this.api('POST', `/clips?broadcaster_id=${me.id}`, undefined, 'clips:edit')
    const d = (Array.isArray(j.data) ? (j.data as Json[]) : [])[0] ?? {}
    const id = s(d.id)
    return { id, url: id ? `https://clips.twitch.tv/${encodeURIComponent(id)}` : '', editUrl: s(d.edit_url) }
  }

  async announce(text: string, color: 'primary' | 'blue' | 'green' | 'orange' | 'purple' = 'primary'): Promise<void> {
    const me = this.me()
    const message = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500)
    if (!message) return
    await this.api('POST', `/chat/announcements?broadcaster_id=${me.id}&moderator_id=${me.id}`, { message, color }, 'moderator:manage:announcements')
  }

  // ---------- награды за баллы ----------

  async listRewards(onlyOwn: boolean): Promise<TwitchReward[]> {
    const me = this.me()
    const j = await this.api('GET', `/channel_points/custom_rewards?broadcaster_id=${me.id}${onlyOwn ? '&only_manageable_rewards=true' : ''}`)
    return (Array.isArray(j.data) ? (j.data as Json[]) : []).map(rewardOf)
  }

  async createReward(r: TwitchRewardInput): Promise<TwitchReward> {
    const me = this.me()
    const j = await this.api('POST', `/channel_points/custom_rewards?broadcaster_id=${me.id}`, rewardBody(r), 'channel:manage:redemptions')
    return rewardOf((Array.isArray(j.data) ? (j.data as Json[]) : [])[0] ?? {})
  }

  async updateReward(id: string, r: Partial<TwitchRewardInput>): Promise<TwitchReward> {
    const me = this.me()
    const j = await this.api('PATCH', `/channel_points/custom_rewards?broadcaster_id=${me.id}&id=${encodeURIComponent(id)}`, rewardBody(r), 'channel:manage:redemptions')
    return rewardOf((Array.isArray(j.data) ? (j.data as Json[]) : [])[0] ?? {})
  }

  async deleteReward(id: string): Promise<void> {
    const me = this.me()
    await this.api('DELETE', `/channel_points/custom_rewards?broadcaster_id=${me.id}&id=${encodeURIComponent(id)}`, undefined, 'channel:manage:redemptions')
  }

  /** Отметить активации выполненными или вернуть баллы. Работает только для наград, созданных этим приложением. */
  async setRedemptions(rewardId: string, ids: string[], status: 'FULFILLED' | 'CANCELED'): Promise<void> {
    const me = this.me()
    const list = ids.filter((x) => /^[\w-]{1,100}$/.test(x)).slice(0, 50)
    if (!list.length) return
    const q = list.map((x) => `id=${encodeURIComponent(x)}`).join('&')
    await this.api('PATCH', `/channel_points/custom_rewards/redemptions?broadcaster_id=${me.id}&reward_id=${encodeURIComponent(rewardId)}&${q}`, { status }, 'channel:manage:redemptions')
  }

  // ---------- прогнозы ----------

  async createPrediction(title: string, outcomes: string[], sec: number): Promise<{ id: string; outcomes: { id: string; title: string }[]; locksAt: number | null }> {
    const me = this.me()
    const body = { broadcaster_id: me.id, title: title.slice(0, 45), outcomes: outcomes.slice(0, 10).map((t) => ({ title: t.slice(0, 25) })), prediction_window: Math.min(1800, Math.max(30, Math.round(sec))) }
    const j = await this.api('POST', '/predictions', body, 'channel:manage:predictions')
    const d = (Array.isArray(j.data) ? (j.data as Json[]) : [])[0] ?? {}
    const created = Date.parse(s(d.created_at))
    return {
      id: s(d.id),
      outcomes: (Array.isArray(d.outcomes) ? (d.outcomes as Json[]) : []).map((o) => ({ id: s(o.id), title: s(o.title) })),
      locksAt: Number.isFinite(created) ? created + (Number(d.prediction_window) || sec) * 1000 : null
    }
  }

  async endPrediction(id: string, status: 'LOCKED' | 'RESOLVED' | 'CANCELED', winningOutcomeId?: string): Promise<void> {
    const me = this.me()
    const body: Json = { broadcaster_id: me.id, id, status }
    if (status === 'RESOLVED') body.winning_outcome_id = winningOutcomeId
    await this.api('PATCH', '/predictions', body, 'channel:manage:predictions')
  }

  async deleteById(messageId: string): Promise<void> {
    const me = this.auth.account('broadcaster')
    if (!me || !/^[\w-]{1,100}$/.test(messageId)) return
    const res = await this.helix(`/moderation/chat?broadcaster_id=${me.id}&moderator_id=${me.id}&message_id=${encodeURIComponent(messageId)}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) throw new Error(`Не удалось удалить сообщение (${res.status})`)
  }

  /** Таймаут (seconds > 0) или бан (seconds = 0). */
  async banUser(userId: string, seconds: number, reason = ''): Promise<void> {
    const me = this.auth.account('broadcaster')
    if (!me || !/^\d{1,20}$/.test(userId)) return
    const data: Json = { user_id: userId, reason: reason.slice(0, 500) }
    if (seconds > 0) data.duration = Math.min(1_209_600, Math.max(1, Math.round(seconds)))
    const res = await this.helix(`/moderation/bans?broadcaster_id=${me.id}&moderator_id=${me.id}`, { method: 'POST', body: JSON.stringify({ data }) })
    if (!res.ok) throw new Error(`Не удалось ${seconds > 0 ? 'выдать таймаут' : 'забанить'} (${res.status})`)
  }
}

/** Роль в чате по значкам Twitch (старшая). */
function roleOf(list: unknown): ViewerRole | undefined {
  const sets = new Set((Array.isArray(list) ? (list as Json[]) : []).map((b) => s(b.set_id)))
  if (sets.has('broadcaster')) return 'broadcaster'
  if (sets.has('moderator') || sets.has('lead_moderator')) return 'mod'
  if (sets.has('vip')) return 'vip'
  if (sets.has('subscriber') || sets.has('founder')) return 'sub'
  return undefined
}

function tier(t: unknown): string {
  return t === '2000' ? '2' : t === '3000' ? '3' : '1'
}

export type { HubEvent }

export interface TwitchChatSettings {
  slow: boolean
  slowSec: number
  followers: boolean
  followersMin: number
  subs: boolean
  emotes: boolean
  unique: boolean
}

export interface TwitchReward {
  id: string
  title: string
  cost: number
  prompt: string
  inputRequired: boolean
  enabled: boolean
  paused: boolean
  color: string
  cooldownSec: number
  maxPerStream: number
  maxPerUser: number
  skipQueue: boolean
}

export interface TwitchRewardInput {
  title: string
  cost: number
  prompt: string
  inputRequired: boolean
  enabled: boolean
  paused: boolean
  color: string
  cooldownSec: number
  maxPerStream: number
  maxPerUser: number
  skipQueue: boolean
}

function rewardOf(r: Json): TwitchReward {
  const gc = (r.global_cooldown_setting ?? {}) as Json
  const ms = (r.max_per_stream_setting ?? {}) as Json
  const mu = (r.max_per_user_per_stream_setting ?? {}) as Json
  return {
    id: s(r.id), title: s(r.title), cost: Number(r.cost) || 0, prompt: s(r.prompt), inputRequired: r.is_user_input_required === true,
    enabled: r.is_enabled !== false, paused: r.is_paused === true, color: /^#[0-9a-f]{6}$/i.test(s(r.background_color)) ? s(r.background_color) : '#9147ff',
    cooldownSec: gc.is_enabled ? Number(gc.global_cooldown_seconds) || 0 : 0,
    maxPerStream: ms.is_enabled ? Number(ms.max_per_stream) || 0 : 0,
    maxPerUser: mu.is_enabled ? Number(mu.max_per_user_per_stream) || 0 : 0,
    skipQueue: r.should_redemptions_skip_request_queue === true
  }
}

function rewardBody(r: Partial<TwitchRewardInput>): Json {
  const b: Json = {}
  if (r.title !== undefined) b.title = r.title.slice(0, 45)
  if (r.cost !== undefined) b.cost = Math.max(1, Math.round(r.cost))
  if (r.prompt !== undefined) b.prompt = r.prompt.slice(0, 200)
  if (r.inputRequired !== undefined) b.is_user_input_required = r.inputRequired
  if (r.enabled !== undefined) b.is_enabled = r.enabled
  if (r.paused !== undefined) b.is_paused = r.paused
  if (r.color !== undefined && /^#[0-9a-f]{6}$/i.test(r.color)) b.background_color = r.color
  if (r.cooldownSec !== undefined) { b.is_global_cooldown_enabled = r.cooldownSec > 0; if (r.cooldownSec > 0) b.global_cooldown_seconds = Math.min(604_800, Math.round(r.cooldownSec)) }
  if (r.maxPerStream !== undefined) { b.is_max_per_stream_enabled = r.maxPerStream > 0; if (r.maxPerStream > 0) b.max_per_stream = Math.round(r.maxPerStream) }
  if (r.maxPerUser !== undefined) { b.is_max_per_user_per_stream_enabled = r.maxPerUser > 0; if (r.maxPerUser > 0) b.max_per_user_per_stream = Math.round(r.maxPerUser) }
  if (r.skipQueue !== undefined) b.should_redemptions_skip_request_queue = r.skipQueue
  return b
}

export interface TwitchPredictionEvent {
  phase: 'begin' | 'progress' | 'lock' | 'end'
  id: string
  title: string
  outcomes: { id: string; title: string; points: number; users: number; top: { name: string; points: number; won: number }[] }[]
  locksAt: number | null
  /** Для end: resolved или canceled. */
  status: string
  winner: string
}

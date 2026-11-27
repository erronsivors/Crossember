import type { Hub } from './hub'
import type { Secrets } from './secrets'
import { OAuthLocal, arr, obj, s, type OAuthAppState, type OAuthTokens } from './oauthlocal'

/**
 * Вход в VK Видео Live через официальный DevAPI (dev.live.vkvideo.ru/docs): сообщения в чат и смена названия
 * и категории эфира. Чтение чата по-прежнему идёт без входа (vk.ts).
 * - Без секрета (общее приложение Crossember или своё без секрета) — ImplicitFlow: токен сразу, без обновления;
 *   VK прямо запрещает держать секрет приложения на стороне клиента, поэтому для общего приложения нужен только Client ID.
 * - Со своим секретом — CodeFlow: обмен кода на api.live.vkvideo.ru/oauth/server/token с Basic client_id:secret.
 * - Адрес возврата: http://localhost:47836/callback — его нужно указать при регистрации приложения.
 * - Права: chat:message:send (POST /v1/chat/message/send), channel:stream:settings (POST /v1/channel/stream/edit).
 * - Отправка требует id текущей трансляции (stream_id) — писать можно только во время эфира.
 */

const API = 'https://apidev.live.vkvideo.ru'
const REVOKE_URL = 'https://api.live.vkvideo.ru/oauth/server/revoke'
export const VK_REDIRECT_PORT = 47836
const CHANNEL_URL = /^[A-Za-z0-9_.-]{1,60}$/

declare const __VK_SHARED__: string

const ERRORS: Record<string, string> = {
  send_too_fast: 'VK: сообщения уходят слишком часто, подождите немного',
  same_message: 'VK: такое же сообщение уже отправлено',
  message_too_long: 'VK: сообщение слишком длинное',
  forbidden: 'VK не дал прав — выйдите и войдите в VK Видео Live заново',
  unauthorized: 'Вход в VK Видео Live истёк — войдите снова'
}

export type VkAuthState = OAuthAppState & { canChat: boolean }

export class VkAuth extends OAuthLocal {
  private stream: { id: string; at: number; channel: string; gen: number } | null = null

  constructor(hub: Hub, secrets: Secrets, resourcesDir: string, private nick: () => string, sendOnly = false) {
    super(hub, secrets, resourcesDir, {
      platform: 'vk', label: 'VK Видео Live',
      authUrl: 'https://auth.live.vkvideo.ru/app/oauth2/authorize', tokenUrl: 'https://api.live.vkvideo.ru/oauth/server/token',
      scopes: sendOnly ? ['chat:message:send'] : ['chat:message:send', 'channel:stream:settings'], scopeSep: ',',
      port: VK_REDIRECT_PORT, pkce: false, clientAuth: 'basic', redirectOnRefresh: true, implicit: true,
      tokensKey: 'vk.tokens', customKey: 'vk.customClient',
      embedded: typeof __VK_SHARED__ === 'string' ? __VK_SHARED__ : '', embeddedKey: 'crossember-vk'
    })
  }

  state(): VkAuthState {
    return { ...super.state(), canChat: this.canChat() }
  }

  canChat(): boolean {
    return this.hasScope('chat:message:send') && !!this.channel() && this.sameChannel()
  }

  canEdit(): boolean {
    return this.hasScope('channel:stream:settings') && !!this.channel() && this.sameChannel()
  }

  /** Адрес канала: из входа, иначе ник из «Подключений». */
  private channel(): string {
    const c = this.tokens?.channel || this.nick()
    return CHANNEL_URL.test(c) ? c : ''
  }

  /** Вход в тот же канал, что указан в «Подключениях» (иначе писали бы не в тот чат, который видно). */
  sameChannel(): boolean {
    const own = this.tokens?.channel
    const nick = this.nick()
    return !own || !nick || own.toLowerCase() === nick.toLowerCase()
  }

  private checkChannel(): void {
    if (!this.sameChannel()) throw new Error(`Вход в VK Видео Live выполнен в канал ${this.tokens?.channel}, а в «Подключениях» указан ${this.nick()}`)
  }

  protected async afterLogin(t: OAuthTokens): Promise<void> {
    const d = obj((await this.api('GET', '/v1/current_user')).data)
    const u = obj(d.user)
    t.name = s(u.nick).slice(0, 60)
    t.userId = /^\d{1,15}$/.test(s(u.id)) ? s(u.id) : ''
    // «Url канала» может прийти и ссылкой целиком — берём последнюю часть пути.
    const ch = (s(obj(d.channel).url) || s(obj(arr(d.channels)[0]).url)).replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? ''
    t.channel = CHANNEL_URL.test(ch) ? ch : ''
  }

  protected async revoke(t: OAuthTokens): Promise<void> {
    const c = this.clientForRevoke()
    if (!c?.secret) return
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: this.basic(c), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(t.refresh ? { token: t.refresh, token_type_hint: 'refresh_token' } : { token: t.access, token_type_hint: 'access_token' }),
      signal: AbortSignal.timeout(10_000)
    })
  }

  private async api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
    const { status, json } = await this.call(`${API}${path}`, { method, body })
    if (status >= 200 && status < 300) return json
    const code = s(json.error)
    throw new Error(ERRORS[code] || s(json.error_description) || `VK API: ${status}`)
  }

  /** id идущей трансляции (без него VK не принимает сообщения); помним минуту. */
  private async streamId(channel = this.channel()): Promise<string> {
    const gen = this.generation
    if (this.stream && this.stream.channel === channel && this.stream.gen === gen && Date.now() - this.stream.at < 60_000) return this.stream.id
    const d = obj((await this.api('GET', `/v1/channel?${new URLSearchParams({ channel_url: channel })}`)).data)
    const st = obj(d.stream)
    const id = s(st.id) || s(obj(arr(d.streams)[0]).id)
    if (!id || st.ended_at) {
      this.stream = null
      throw new Error('VK: эфир не идёт — писать в чат VK можно во время трансляции')
    }
    if (gen !== this.generation) throw new Error('VK: вход отправителя изменился — повторите')
    this.stream = { id, at: Date.now(), channel, gen }
    return id
  }

  async sendChat(text: string): Promise<void> {
    this.checkChannel()
    if (!this.canChat()) throw new Error('Чтобы писать в чат VK, войдите в VK Видео Live в «Подключениях»')
    await this.postChat(text, this.channel())
  }

  /** Явный канал стримера для отдельного профиля-отправителя. Настройки эфира по-прежнему защищены checkChannel(). */
  async sendChatTo(text: string, channel: string): Promise<void> {
    if (!this.loggedIn() || !this.hasScope('chat:message:send')) throw new Error('VK: войдите в профиль отправителя с правом отправки сообщений')
    if (!CHANNEL_URL.test(channel)) throw new Error('VK: сначала укажите канал стримера в «Подключениях»')
    await this.postChat(text, channel)
  }

  private async postChat(text: string, channel: string): Promise<void> {
    const content = text.trim().slice(0, 500)
    if (!content) return
    const q = new URLSearchParams({ channel_url: channel, stream_id: await this.streamId(channel) })
    try {
      await this.api('POST', `/v1/chat/message/send?${q}`, { parts: [{ text: { content } }] })
    } catch (e) {
      this.stream = null
      throw e
    }
  }

  /** Сменить название и (если нашлась) категорию. Возвращает поставленную категорию. */
  async setChannelInfo(title: string, game: string): Promise<string> {
    this.checkChannel()
    if (!this.canEdit()) throw new Error('Чтобы менять название на VK, войдите в VK Видео Live заново')
    const stream: Record<string, unknown> = { title: title.slice(0, 140) }
    let name = ''
    if (game.trim()) {
      const cat = await this.findCategory(game.trim())
      if (!cat) throw new Error(`Категория «${game}» на VK Видео Live не найдена`)
      // Тело по схеме v1ChannelStreamEditRequestData: только эти поля категории.
      stream.category = { id: s(cat.id), title: s(cat.title), type: s(cat.type), cover_url: s(cat.cover_url) }
      name = s(cat.title)
    }
    await this.api('POST', `/v1/channel/stream/edit?${new URLSearchParams({ channel_url: this.channel() })}`, { stream })
    return name
  }

  private async findCategory(q: string): Promise<Record<string, unknown> | null> {
    const all: Record<string, unknown>[] = []
    for (const type of ['game', 'irl']) {
      const j = await this.api('GET', `/v1/category/search?${new URLSearchParams({ query: q.slice(0, 100), type, limit: '10' })}`)
      all.push(...arr(obj(j.data).categories).map(obj).filter((c) => s(c.id)))
      const exact = all.find((c) => s(c.title).toLowerCase() === q.toLowerCase())
      if (exact) return exact
    }
    return all[0] ?? null
  }

  async searchCategories(q: string): Promise<string[]> {
    if (!this.tokens || q.trim().length < 2) return []
    const j = await this.api('GET', `/v1/category/search?${new URLSearchParams({ query: q.trim().slice(0, 100), type: 'game', limit: '8' })}`)
    return arr(obj(j.data).categories).map((c) => s(obj(c).title)).filter(Boolean)
  }
}

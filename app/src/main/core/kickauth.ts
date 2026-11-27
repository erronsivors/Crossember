import type { Hub } from './hub'
import type { Secrets } from './secrets'
import { OAuthLocal, arr, obj, s, type OAuthAppState, type OAuthTokens } from './oauthlocal'

/**
 * Вход в Kick (официальный API docs.kick.com): смена названия и категории эфира и сообщения в чат.
 * Чат Kick по-прежнему читается без входа.
 * - OAuth 2.1 + PKCE через id.kick.com; Kick требует секрет приложения при обмене кода.
 * - Адрес возврата фиксированный: http://localhost:47835/callback — его нужно указать в приложении на kick.com.
 * - Писать в чат: POST /public/v1/chat с правом chat:write (добавлено в 0.1.5 — старый вход нужно повторить).
 */

const API = 'https://api.kick.com/public'
const REVOKE_URL = 'https://id.kick.com/oauth/revoke'
export const KICK_REDIRECT_PORT = 47835
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

declare const __KICK_SHARED__: string

export type KickAuthState = OAuthAppState & { canChat: boolean }

export class KickAuth extends OAuthLocal {
  constructor(hub: Hub, secrets: Secrets, resourcesDir: string, sendOnly = false) {
    super(hub, secrets, resourcesDir, {
      platform: 'kick', label: 'Kick',
      authUrl: 'https://id.kick.com/oauth/authorize', tokenUrl: 'https://id.kick.com/oauth/token',
      scopes: sendOnly ? ['user:read', 'channel:read', 'chat:write'] : ['user:read', 'channel:read', 'channel:write', 'chat:write'], scopeSep: ' ',
      port: KICK_REDIRECT_PORT, pkce: true, clientAuth: 'body', redirectOnRefresh: false,
      tokensKey: 'kick.tokens', customKey: 'kick.customClient',
      embedded: typeof __KICK_SHARED__ === 'string' ? __KICK_SHARED__ : '', embeddedKey: 'crossember-kick'
    })
    // Токены до 0.1.5 сохранялись без списка прав — они были выданы без chat:write.
    if (this.tokens && !this.tokens.scope) this.tokens.scope = ['user:read', 'channel:read', 'channel:write']
  }

  state(): KickAuthState {
    return { ...super.state(), canChat: this.canChat() }
  }

  /** Можно ли писать в чат: вход с правом chat:write. */
  canChat(): boolean {
    return this.loggedIn() && this.hasScope('chat:write')
  }

  /** Вход в тот же канал, что указан в «Подключениях» (ник Kick в ссылке пишется через «-» вместо «_»). */
  sameChannel(nick: string): boolean {
    const norm = (x: string): string => x.toLowerCase().replace(/_/g, '-')
    const name = this.tokens?.name
    return !name || !nick || norm(name) === norm(nick)
  }

  /** Есть ли права на смену названия (они были с первого входа). */
  canEdit(): boolean {
    return this.hasScope('channel:write')
  }

  protected async afterLogin(t: OAuthTokens): Promise<void> {
    const u = obj(arr((await this.api('GET', '/v1/users')).data)[0])
    t.name = s(u.name).slice(0, 60)
    t.userId = /^\d{1,15}$/.test(s(u.user_id)) ? s(u.user_id) : ''
  }

  protected async revoke(t: OAuthTokens): Promise<void> {
    await fetch(`${REVOKE_URL}?${new URLSearchParams({ token: t.refresh, token_hint_type: 'refresh_token' })}`, { method: 'POST', signal: AbortSignal.timeout(10_000) })
  }

  private async api(method: 'GET' | 'PATCH' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
    const { status, json } = await this.call(`${API}${path}`, { method, body })
    if (status === 403) throw new Error('Kick не дал прав — выйдите и войдите в Kick заново')
    if (status === 429) throw new Error('Kick: слишком часто, подождите немного')
    if (status < 200 || status >= 300) throw new Error(s(json.message) || `Kick API: ${status}`)
    return json
  }

  /** Поиск категорий по названию (устаревший, но задокументированный v1: q=…). */
  async searchCategories(q: string): Promise<{ id: number; name: string }[]> {
    if (!this.tokens || !q.trim()) return []
    const j = await this.api('GET', `/v1/categories?${new URLSearchParams({ q: q.trim().slice(0, 100) })}`)
    return arr(j.data).map(obj).map((c) => ({ id: Number(c.id), name: s(c.name) })).filter((c) => Number.isInteger(c.id) && c.id > 0).slice(0, 8)
  }

  /** Сменить название и (если найдена) категорию. Возвращает поставленную категорию. */
  async setChannelInfo(title: string, game: string): Promise<string> {
    const body: Record<string, unknown> = { stream_title: title.slice(0, 140) }
    let name = ''
    if (game.trim()) {
      const found = await this.searchCategories(game)
      const pick = found.find((c) => c.name.toLowerCase() === game.trim().toLowerCase()) ?? found[0]
      if (!pick) throw new Error(`Категория «${game}» на Kick не найдена`)
      body.category_id = pick.id
      name = pick.name
    }
    await this.api('PATCH', '/v1/channels', body)
    return name
  }

  /** Сообщение в свой чат от имени вошедшего аккаунта. replyTo — id сообщения Kick (UUID), можно с приставкой kick-. */
  async sendChat(text: string, replyTo: string | undefined, nick: string): Promise<void> {
    if (!this.canChat()) throw new Error('Чтобы писать в чат Kick, войдите в Kick заново (нужно новое разрешение)')
    await this.ensureProfile((t) => !t.userId || !t.name)
    if (!this.tokens?.userId) throw new Error('Kick: не удалось узнать ваш канал — попробуйте ещё раз')
    // Kick пишет в канал вошедшего аккаунта: не отправляем, если в «Подключениях» указан другой канал.
    if (!this.sameChannel(nick)) throw new Error(`Вход в Kick выполнен как ${this.tokens.name}, а в «Подключениях» указан канал ${nick}`)
    await this.postChat(text, replyTo, Number(this.tokens.userId))
  }

  /** Отдельный вошедший отправитель: target — канал стримера, а не собственный канал бота.
   * https://docs.kick.com/apis/chat — type:user uses broadcaster_user_id; type:bot ignores it.
   */
  async sendChatTo(text: string, replyTo: string | undefined, target: string): Promise<void> {
    if (!this.canChat()) throw new Error('Kick: войдите в профиль отправителя с правом отправки сообщений')
    const slug = target.trim().replace(/^https?:\/\/(?:www\.)?kick\.com\//i, '').replace(/[/?#].*$/, '').toLowerCase().replace(/_/g, '-')
    if (!/^[a-z0-9-]{1,25}$/.test(slug)) throw new Error('Kick: сначала укажите канал стримера в «Подключениях»')
    const gen = this.generation
    const j = await this.api('GET', `/v1/channels?${new URLSearchParams({ slug })}`)
    const channel = arr(j.data).map(obj).find((x) => s(x.slug).toLowerCase() === slug)
    const targetId = Number(channel?.broadcaster_user_id)
    if (!Number.isSafeInteger(targetId) || targetId <= 0) throw new Error('Kick: канал стримера не найден')
    if (gen !== this.generation || !this.loggedIn()) throw new Error('Kick: вход отправителя изменился — повторите')
    await this.postChat(text, replyTo, targetId)
  }

  private async postChat(text: string, replyTo: string | undefined, targetId: number): Promise<void> {
    // Kick: не больше 500 символов и 2048 байт.
    let content = [...text.trim()].slice(0, 500).join('')
    while (Buffer.byteLength(content, 'utf8') > 2048) content = [...content].slice(0, -1).join('')
    if (!content) return
    const body: Record<string, unknown> = { type: 'user', content, broadcaster_user_id: targetId }
    const rid = replyTo?.replace(/^kick-/, '')
    if (rid && UUID.test(rid)) body.reply_to_message_id = rid
    const j = await this.api('POST', '/v1/chat', body)
    if (obj(j.data).is_sent === false) throw new Error('Kick не принял сообщение')
  }
}

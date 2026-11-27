import type { Hub } from './hub'
import type { Secrets } from './secrets'
import { OAuthLocal, obj, s, type OAuthAppState, type OAuthTokens } from './oauthlocal'

/**
 * Вход в GoodGame: сообщения в чат и смена названия и игры эфира.
 * Источники (официальной сводной документации к новому OAuth нет):
 * - окно входа goodgame.ru/oauth2/authorize и обмен кода POST goodgame.ru/oauth2/token (client_id + client_secret в теле) —
 *   так входят сторонние программы (Stream Tools), адреса описаны в gist strayge «goodgame.ru_api4.md»; сервер отвечает
 *   по-настоящему (на чужой ключ — invalid_client). Приложение регистрируется на goodgame.ru/user/<id>/oauth2.
 * - смена названия: POST /api/4/streams/for-helpers/game-title { id, title, gameId } — в официальном описании api4
 *   (static.goodgame.ru/html/api4docs, swagger-public.json); как к нему авторизоваться, там не сказано — пробуем Bearer.
 * - чат: протокол chat2 (github.com/GoodGame/API, Chat/protocol2.md): auth { user_id, token } и send_message.
 *   Токен чата — поле token/chatToken текущего пользователя (/api/4/user, схема UserCurrent в api4).
 * Адрес возврата: https://erronsivors.github.io/Crossember/gg-callback.html — GoodGame запрещает в приложениях localhost и 127.*,
 * поэтому страница на GitHub Pages сразу переносит code и state на http://127.0.0.1:47837/callback этого ПК (секретов на ней нет). — его нужно указать в приложении GoodGame.
 */

const SITE = 'https://goodgame.ru'
export const GG_REDIRECT_PORT = 47837

declare const __GG_SHARED__: string

export type GgAuthState = OAuthAppState & { canChat: boolean }

export class GgAuth extends OAuthLocal {
  private chat: { userId: string; token: string; gen: number } | null = null

  constructor(hub: Hub, secrets: Secrets, resourcesDir: string, private nick: () => string) {
    super(hub, secrets, resourcesDir, {
      platform: 'goodgame', label: 'GoodGame',
      authUrl: `${SITE}/oauth2/authorize`, tokenUrl: `${SITE}/oauth2/token`,
      scopes: [], scopeSep: ' ',
      port: GG_REDIRECT_PORT, pkce: false, clientAuth: 'body', redirectOnRefresh: false, publicRedirect: 'https://erronsivors.github.io/Crossember/gg-callback.html',
      tokensKey: 'goodgame.tokens', customKey: 'goodgame.customClient',
      embedded: typeof __GG_SHARED__ === 'string' ? __GG_SHARED__ : '', embeddedKey: 'crossember-gg'
    })
  }

  state(): GgAuthState {
    return { ...super.state(), canChat: this.loggedIn() && this.sameChannel() }
  }

  /** Вход в тот же канал, что указан в «Подключениях». */
  sameChannel(): boolean {
    const name = this.tokens?.name
    const nick = this.nick()
    return !name || !nick || name.toLowerCase() === nick.toLowerCase()
  }

  private checkChannel(): void {
    if (!this.sameChannel()) throw new Error(`Вход в GoodGame выполнен как ${this.tokens?.name}, а в «Подключениях» указан канал ${this.nick()}`)
  }

  private async api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
    const { status, json } = await this.call(`${SITE}/api/4${path}`, { method, body })
    if (status === 401 || status === 403) throw new Error('GoodGame не дал прав — выйдите и войдите в GoodGame заново')
    if (status === 404) throw new Error('GoodGame: канал не найден')
    if (status < 200 || status >= 300) throw new Error(s(json.message) || s(json.error) || `GoodGame API: ${status}`)
    return json
  }

  /** Текущий пользователь: id, ник и токен чата. */
  private async me(): Promise<{ id: string; name: string; token: string }> {
    const u = await this.api('GET', '/user')
    const d = obj(u.user ?? u)
    return { id: s(d.id), name: s(d.nickname || d.username), token: s(d.token || d.chatToken) }
  }

  protected async afterLogin(t: OAuthTokens): Promise<void> {
    const m = await this.me()
    t.name = m.name.slice(0, 60)
    t.userId = /^\d{1,12}$/.test(m.id) ? m.id : ''
  }

  /** Данные для входа в чат (протокол chat2). null — писать нельзя, читаем анонимно. */
  async chatAuth(): Promise<{ userId: string; token: string } | null> {
    if (!this.loggedIn() || !this.sameChannel()) return null
    return this.botChatAuth()
  }

  /** A separately authorized sender may join the primary channel; editing still uses sameChannel. */
  async botChatAuth(): Promise<{ userId: string; token: string } | null> {
    if (!this.loggedIn()) return null
    if (this.chat && this.chat.gen === this.generation) return this.chat
    const gen = this.generation
    const m = await this.me()
    if (!/^\d{1,12}$/.test(m.id) || !m.token || gen !== this.generation) return null
    this.chat = { userId: m.id, token: m.token, gen }
    return this.chat
  }

  /** id канала по нику (тот же, что у чата). */
  private async channelId(): Promise<number> {
    const res = await fetch(`${SITE}/api/4/users/${encodeURIComponent(this.nick())}/stream`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error('GoodGame: канал не найден — проверьте ник в «Подключениях»')
    const id = Number(obj(await res.json()).id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('GoodGame: канал не найден')
    return id
  }

  /** Подсказки игр (тот же поиск, что на сайте). */
  async searchGames(q: string): Promise<{ id: number; title: string }[]> {
    if (q.trim().length < 2) return []
    const res = await fetch(`${SITE}/api/4/games/autocomplete/games?${new URLSearchParams({ query: q.trim().slice(0, 100) })}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return []
    const list = (await res.json().catch(() => [])) as unknown
    return (Array.isArray(list) ? list : []).map((x) => obj(obj(x).object)).map((g) => ({ id: Number(g.id), title: s(g.title) })).filter((g) => Number.isInteger(g.id) && g.id > 0 && g.title).slice(0, 8)
  }

  /** Сменить название и (если нашлась) игру. Возвращает поставленную игру. */
  async setChannelInfo(title: string, game: string): Promise<string> {
    if (!this.loggedIn()) throw new Error('Не выполнен вход в GoodGame')
    this.checkChannel()
    const gen = this.generation
    const nick = this.nick()
    const id = await this.channelId()
    let gameId: number
    let name = ''
    if (game.trim()) {
      const found = await this.searchGames(game)
      const pick = found.find((g) => g.title.toLowerCase() === game.trim().toLowerCase()) ?? found[0]
      if (!pick) throw new Error(`Игра «${game}» на GoodGame не найдена`)
      gameId = pick.id
      name = pick.title
    } else {
      // Игру не указали — оставляем ту, что стоит сейчас (gameId по умолчанию 0 сбросил бы её).
      const cur = await this.api('GET', `/streams/for-helpers/game-title?${new URLSearchParams({ id: String(id) })}`)
      gameId = Number(cur.gameId) || 0
    }
    // Пока искали канал и игру, вход или ник могли смениться — тогда не трогаем канал.
    if (gen !== this.generation || nick !== this.nick()) throw new Error('GoodGame: вход или канал сменились — нажмите «Применить» ещё раз')
    const r = await this.api('POST', '/streams/for-helpers/game-title', { id, title: title.slice(0, 140), gameId })
    return s(r.game) || name
  }
}

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Hub } from './hub'
import type { Settings } from './settings'
import type { ImageCache } from './imgcache'
import type { ChatConnector, ChatPlatformState } from './connector'
import type { MsgPart } from './types'
import type { GgAuth } from './ggauth'

/**
 * GoodGame: чтение чата и событий без входа (протокол chat2, анонимно), по нику канала.
 * Донаты (payment), премиумы (premium) и фолловы приходят в тот же сокет.
 * После входа в GoodGame (ggauth.ts) сокет авторизуется токеном чата (auth { user_id, token }) и может писать (send_message).
 */

const WS_URL = 'wss://chat-1.goodgame.ru/chat2/'
const SMILES_URL = 'https://static.goodgame.ru/js/minified/global.json'
const NICK = /^[A-Za-z0-9_.-]{1,40}$/
const SMILES_TTL = 24 * 60 * 60 * 1000

type Json = Record<string, unknown>
const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v))

/** Текст GoodGame приходит HTML-экранированным — превращаем обратно в обычный текст (выводится всё равно как текст). */
function unescapeHtml(t: string): string {
  return t
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

export class GoodGameConnector implements ChatConnector {
  readonly id = 'goodgame' as const
  private ws: WebSocket | null = null
  private channelId: string | null = null
  private smiles = new Map<string, string>() // имя -> локальный путь картинки
  private retryTimer: NodeJS.Timeout | null = null
  private viewersTimer: NodeJS.Timeout | null = null
  private retryDelay = 2000
  private generation = 0
  live = false
  viewers: number | null = null
  onChange: () => void = () => undefined

  private authed = false
  private joined = false

  constructor(private hub: Hub, private settings: Settings, private img: ImageCache, private cacheDir: string, private auth: GgAuth) {
    hub.register('goodgame', 'GoodGame')
  }

  private nick(): string {
    return this.settings.get().goodgame.channel
  }

  chatState(): ChatPlatformState {
    const nick = this.nick()
    return { id: 'goodgame', name: 'GoodGame', configured: !!nick, live: this.live, viewers: this.viewers, canSend: !!nick && this.authed && !!this.ws, canModerate: false, account: nick || null }
  }

  async send(text: string): Promise<void> {
    const ws = this.ws
    if (!ws || !this.authed || !this.channelId) throw new Error('GoodGame: нет входа в чат — войдите в GoodGame в «Подключениях»')
    const t = text.trim().slice(0, 500)
    if (t) ws.send(JSON.stringify({ type: 'send_message', data: { channel_id: this.channelId, text: t, mobile: 0 } }))
  }

  /** Войти в чат токеном (если есть вход в GoodGame), затем зайти в комнату канала. */
  private async joinRoom(ws: WebSocket, gen: number): Promise<void> {
    let creds: { userId: string; token: string } | null = null
    try {
      creds = await this.auth.chatAuth()
    } catch (e) {
      this.hub.log('goodgame', 'warn', `GoodGame: не удалось войти в чат, читаю без входа — ${(e as Error).message}`)
    }
    if (gen !== this.generation || this.ws !== ws) return
    if (creds) ws.send(JSON.stringify({ type: 'auth', data: { user_id: creds.userId, token: creds.token } }))
    ws.send(JSON.stringify({ type: 'join', data: { channel_id: this.channelId, hidden: 0, mobile: false, reload: false } }))
  }

  async start(): Promise<void> {
    const nick = this.nick()
    if (!nick) return this.hub.setStatus('goodgame', 'off', 'Войдите в GoodGame в «Подключениях»')
    if (!NICK.test(nick)) return this.hub.setStatus('goodgame', 'error', 'Ник канала содержит недопустимые символы')
    this.stop('connecting', 'Подключение…', false)
    const gen = ++this.generation
    try {
      await this.loadStream(nick, gen)
      if (!this.channelId) throw new Error('Канал не найден — проверьте ник')
      void this.loadSmiles(this.channelId, gen)
      if (gen !== this.generation) return
      this.connect(gen)
      this.viewersTimer = setInterval(() => void this.loadStream(nick, gen).catch(() => undefined), 60_000)
    } catch (e) {
      this.hub.setStatus('goodgame', 'error', (e as Error).message)
      this.scheduleRetry(gen)
    }
  }

  stop(state: 'off' | 'connecting' = 'off', detail = 'Отключено', bump = true): void {
    if (bump) this.generation++
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.viewersTimer) clearInterval(this.viewersTimer)
    this.retryTimer = this.viewersTimer = null
    const ws = this.ws
    this.ws = null
    this.authed = false
    this.joined = false
    this.channelId = null
    ws?.close()
    this.live = false
    this.viewers = null
    this.hub.setStatus('goodgame', state, detail)
    this.onChange()
  }

  async restart(): Promise<void> {
    this.retryDelay = 2000
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

  /** Статус канала: id чата, в эфире ли, зрители. */
  private async loadStream(nick: string, gen: number): Promise<void> {
    const res = await fetch(`https://goodgame.ru/api/4/users/${encodeURIComponent(nick)}/stream`, { signal: AbortSignal.timeout(15_000) })
    if (res.status === 404) throw new Error('Канал не найден — проверьте ник')
    if (!res.ok) throw new Error(`GoodGame API: ${res.status}`)
    const j = (await res.json()) as Json
    // Ответ старого запроса после перезапуска не должен перезаписать новый канал.
    if (gen !== this.generation) return
    const id = s(j.id)
    if (/^\d{1,12}$/.test(id)) this.channelId = id
    this.live = j.online === true || j.online === 1
    this.viewers = this.live ? Number(j.viewers) || 0 : null
    this.onChange()
  }

  /** Общие и все канальные смайлы: зрители могут писать платными смайлами чужих каналов. */
  private async loadSmiles(channelId: string, gen: number): Promise<void> {
    const file = join(this.cacheDir, 'goodgame-smiles.json')
    let raw: string | null = null
    try {
      const cached = JSON.parse(await readFile(file, 'utf8')) as { at: number; data: string }
      if (Date.now() - cached.at < SMILES_TTL) raw = cached.data
    } catch {
      /* нет кэша */
    }
    try {
      if (!raw) {
        const res = await fetch(SMILES_URL, { signal: AbortSignal.timeout(30_000) })
        if (!res.ok) throw new Error(String(res.status))
        raw = await res.text()
        await writeFile(file, JSON.stringify({ at: Date.now(), data: raw })).catch(() => undefined)
      }
      const j = JSON.parse(raw) as { Smiles?: Json[]; Channel_Smiles?: Record<string, Json[]> }
      const map = new Map<string, string>()
      const warm: string[] = []
      const channels = j.Channel_Smiles ?? {}
      const shared = Array.isArray(j.Smiles) ? j.Smiles : []
      const current = Array.isArray(channels[channelId]) ? channels[channelId] : []
      const preload = new Set([...shared, ...current])
      const others = Object.entries(channels).filter(([id]) => id !== channelId).flatMap(([, smiles]) => Array.isArray(smiles) ? smiles : [])
      // Текущий канал последним — его вариант имеет приоритет при совпадении кода.
      for (const sm of [...shared, ...others, ...current]) {
        if (!sm || typeof sm !== 'object') continue
        const url = s(sm.animated === true || sm.animated === '1' || sm.animated === 1 ? sm.img_gif || sm.img_big || sm.img : sm.img_big || sm.img)
        const path = this.img.local(url)
        if (path) {
          for (const rawName of [sm.name, sm.tag]) {
            const name = s(rawName).replace(/^:|:$/g, '')
            if (/^[\w-]{1,64}$/.test(name)) map.set(name, path)
          }
          // Остальные каналы скачиваются по мере появления сообщений, а не всем каталогом.
          if (preload.has(sm)) warm.push(path)
        }
      }
      if (gen !== this.generation) return
      this.smiles = map
      this.img.warm(warm.slice(0, 600))
    } catch (e) {
      this.hub.log('goodgame', 'warn', `Смайлы GoodGame не загрузились: ${(e as Error).message}`)
    }
  }

  private parts(text: string): MsgPart[] {
    const out: MsgPart[] = []
    for (const tok of text.split(/(:[\w-]{1,64}:)/)) {
      if (!tok) continue
      const m = /^:([\w-]{1,64}):$/.exec(tok)
      const url = m ? this.smiles.get(m[1]) : undefined
      if (url) out.push({ t: 'emote', v: tok, url })
      else {
        const last = out[out.length - 1]
        if (last?.t === 'text') last.v += tok
        else out.push({ t: 'text', v: tok })
      }
    }
    this.img.warm(out.filter((p) => p.t === 'emote').map((p) => (p as { url: string }).url))
    return out
  }

  private connect(gen: number): void {
    const ws = new WebSocket(WS_URL)
    this.ws = ws
    ws.onmessage = (m) => {
      if (gen !== this.generation) return
      let msg: { type?: string; data?: Json }
      try {
        msg = JSON.parse(String(m.data))
      } catch {
        return
      }
      this.onMessage(ws, s(msg.type), msg.data ?? {})
    }
    ws.onclose = () => {
      if (gen !== this.generation || this.ws !== ws) return
      this.ws = null
      this.hub.setStatus('goodgame', 'connecting', 'Соединение с GoodGame потеряно — переподключение…')
      this.scheduleRetry(gen)
    }
    ws.onerror = () => undefined
  }

  private onMessage(ws: WebSocket, type: string, d: Json): void {
    const base = { platform: 'goodgame' as const }
    switch (type) {
      case 'welcome':
        this.authed = false
        this.joined = false
        void this.joinRoom(ws, this.generation)
        break
      case 'success_auth':
        this.authed = Number(d.user_id) > 0
        if (this.joined) this.updateChatStatus()
        this.onChange()
        break
      case 'success_join':
        this.retryDelay = 2000
        this.joined = true
        this.updateChatStatus()
        break
      case 'message': {
        const text = unescapeHtml(s(d.text))
        this.hub.push({ ...base, type: 'message', id: `gg-${s(d.message_id) || Date.now()}`, user: s(d.user_name), userId: s(d.user_id), text, parts: this.parts(text) })
        break
      }
      case 'remove_message':
        this.hub.deleteMessage(`gg-${s(d.message_id)}`)
        break
      case 'user_ban':
        if (d.user_id) this.hub.deleteUserMessages('goodgame', s(d.user_id))
        break
      case 'payment':
        this.hub.push({ ...base, type: 'donation', user: s(d.userName) || 'Аноним', amount: Number(d.amount) || 0, currency: 'RUB', text: unescapeHtml(s(d.message)) })
        break
      case 'premium':
        this.hub.push({ ...base, type: 'sub', user: s(d.userName), text: d.resub ? `Продление премиума (${s(d.resub)} мес.)` : 'Новый премиум' })
        break
      case 'gifted_premiums':
        this.hub.push({ ...base, type: 'gift', user: s(d.userName), amount: Number(d.count) || 1, text: 'Подарочные премиумы' })
        break
      case 'follower':
        this.hub.push({ ...base, type: 'follow', user: s(d.userName) || s(d.user_name) })
        break
      case 'error':
        this.hub.log('goodgame', 'warn', `GoodGame: ${s(d.errorMsg) || s(d.message) || 'ошибка'}`)
        break
    }
  }

  /** Подтверждения входа и присоединения могут прийти в любом порядке. */
  private updateChatStatus(): void {
    this.hub.setStatus('goodgame', 'ok', `Подключено · ${this.nick()}${this.authed ? '' : ' · отправка в чат недоступна'}`)
  }
}

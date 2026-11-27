import type { HubEvent, Platform } from './types'

/** Краткое состояние площадки с чатом — для полоски площадок, онлайна и выбора «куда отправить». */
export interface ChatPlatformState {
  id: Platform
  name: string
  /** Подключён ли аккаунт/канал (иначе площадка не показывается в полоске). */
  configured: boolean
  live: boolean
  viewers: number | null
  /** Можно ли писать в чат из Crossember (нужен вход). */
  canSend: boolean
  /** Можно ли удалять сообщения и банить. */
  canModerate: boolean
  /** Имя канала/аккаунта для подписи. */
  account: string | null
}

/**
 * Единый интерфейс площадки с чатом. Каждая площадка (Twitch, YouTube, VK, Kick, GoodGame)
 * реализует его, а ядро работает со всеми одинаково.
 */
export interface ChatConnector {
  readonly id: Platform
  start(): Promise<void>
  stop(): void
  restart(): Promise<void>
  chatState(): ChatPlatformState
  /** replyTo — id сообщения на этой площадке: ответить в его ветку, где площадка это умеет. */
  send?(text: string, opts?: { as?: 'broadcaster' | 'bot'; replyTo?: string }): Promise<void>
  deleteMessage?(m: HubEvent): Promise<void>
  /** seconds > 0 — таймаут, 0 — бан. */
  ban?(m: HubEvent, seconds: number): Promise<void>
}

/** Реестр площадок с чатом. */
export class ChatRegistry {
  private map = new Map<Platform, ChatConnector>()
  /** A selected independent identity handles sending without replacing the primary reader. */
  alternateSend?: (platform: Platform, text: string, replyTo?: string) => Promise<boolean>
  alternateReady?: (platform: Platform) => boolean
  alternateSelected?: (platform: Platform) => boolean
  defaultAs: () => 'broadcaster' | 'bot' = () => 'broadcaster'

  add(c: ChatConnector): void {
    this.map.set(c.id, c)
  }

  get(id: Platform): ChatConnector | undefined {
    return this.map.get(id)
  }

  all(): ChatConnector[] {
    return [...this.map.values()]
  }

  states(): ChatPlatformState[] {
    return this.all().map((c) => { const s = c.chatState(); return { ...s, canSend: s.canSend || (s.configured && !!this.alternateReady?.(c.id)) } })
  }

  /** Отправить сообщение в выбранные площадки. Ошибки собираются, чтобы одна площадка не мешала другим. */
  async send(text: string, targets: Platform[], as: 'broadcaster' | 'bot' | 'auto', reply?: { platform: Platform; id: string }): Promise<void> {
    const errors: string[] = []
    await Promise.all(
      targets.map(async (id) => {
        const c = this.map.get(id)
        if (!c?.send) return
        try {
          const role = as === 'auto' ? (this.alternateSelected?.(id) ? 'bot' : this.defaultAs()) : as
          const replyTo = reply?.platform === id ? reply.id : undefined
          if (role === 'bot' && await this.alternateSend?.(id, text, replyTo)) return
          if (!c.chatState().canSend) throw new Error('Отправка выбранным аккаунтом пока недоступна')
          await c.send(text, { as: role, replyTo })
        } catch (e) {
          errors.push(`${c.chatState().name}: ${(e as Error).message}`)
        }
      })
    )
    if (errors.length) throw new Error(errors.join('; '))
  }

  async startAll(): Promise<void> {
    await Promise.all(this.all().map((c) => c.start().catch(() => undefined)))
  }

  stopAll(): void {
    for (const c of this.all()) c.stop()
  }
}

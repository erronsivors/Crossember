import type { Hub } from './hub'
import type { Secrets } from './secrets'
import type { Settings } from './settings'
import { YoutubeConnector } from './youtube'
import { GgAuth } from './ggauth'
import type { GoodGameConnector } from './goodgame'
import type { BotProfile, BotAccountAdapter, BotAccountStatus } from './botaccounttypes'
import { botSecrets } from './botproviders-tkv'

export interface YgBotDeps {
  hub: Hub
  secrets: Secrets
  settings: Settings
  resourcesDir: string
  youtube: YoutubeConnector
  goodgame: GoodGameConnector
}

/** Auxiliary identities have their own errors; they never overwrite the primary connection status. */
function accountHub(hub: Hub, changed: () => void, fail: (text: string) => void): Hub {
  const isolated = Object.create(hub) as Hub
  isolated.register = () => undefined
  isolated.setStatus = (_id, state, detail) => { if (state === 'error') fail(detail); changed() }
  isolated.log = (_id, level, text) => { if (level === 'error' || level === 'warn') fail(text); changed() }
  return isolated
}

export function createYoutubeBot(profile: BotProfile, onChange: () => void, deps: YgBotDeps): BotAccountAdapter {
  let error: string | null = null
  let disposed = false
  let generation = 0
  const changed = (): void => { if (!disposed) onChange() }
  const hub = accountHub(deps.hub, changed, (text) => { error = text })
  const secrets = botSecrets(deps.secrets, profile.id)
  const sender = new YoutubeConnector(hub, deps.settings, secrets, deps.resourcesDir, { authOnly: true })
  sender.onChange = changed
  const active = (): void => { if (disposed) throw new Error('Профиль бота удалён') }
  return {
    state: (): BotAccountStatus => {
      const s = sender.state()
      return { account: s.account?.name ?? null, pending: s.pending, available: s.clientIdSource !== 'none', error }
    },
    async login() {
      active(); generation++; error = null
      try { await sender.login() } catch (e) { sender.cancelLogin(); error = (e as Error).message; changed(); throw e }
    },
    cancel() { generation++; sender.cancelLogin() },
    async logout() { active(); generation++; await sender.logout(); error = null; changed() },
    async send(text) {
      active()
      const gen = generation
      const chat = deps.youtube.activeChatId()
      if (!chat) throw new Error('YouTube: нет активного чата основного канала')
      try {
        await sender.sendTo(chat, text, () => !disposed && gen === generation && deps.youtube.activeChatId() === chat)
        error = null
      } catch (e) { error = (e as Error).message; throw e }
      finally { changed() }
    },
    dispose() { disposed = true; generation++; sender.cancelLogin(); sender.stop(); secrets.dispose() }
  }
}

/** A short-lived authenticated socket sends to the primary room; incoming events are never republished. */
export function createGoodgameBot(profile: BotProfile, onChange: () => void, deps: YgBotDeps): BotAccountAdapter {
  let error: string | null = null
  let disposed = false
  let generation = 0
  let chain: Promise<void> = Promise.resolve()
  const cancellations = new Set<() => void>()
  const changed = (): void => { if (!disposed) onChange() }
  const hub = accountHub(deps.hub, changed, (text) => { error = text })
  const secrets = botSecrets(deps.secrets, profile.id)
  const auth = new GgAuth(hub, secrets, deps.resourcesDir, () => deps.settings.get().goodgame.channel)
  auth.onChange = changed
  const invalidate = (): void => {
    generation++
    for (const cancel of [...cancellations]) cancel()
    auth.cancelLogin()
  }
  const sendOne = async (text: string, gen: number): Promise<void> => {
    if (disposed || gen !== generation) throw new Error('Вход GoodGame изменился — повторите действие')
    const target = deps.goodgame.activeChannelId()
    if (!target) throw new Error('GoodGame: основной канал ещё не подключён к чату')
    const nick = deps.settings.get().goodgame.channel
    const credentials = await auth.botChatAuth()
    if (!credentials) throw new Error('GoodGame: войдите в аккаунт бота заново')
    const current = (): boolean => !disposed && gen === generation && target === deps.goodgame.activeChannelId() && nick === deps.settings.get().goodgame.channel
    if (!current()) throw new Error('Вход или канал GoodGame изменился — повторите действие')
    const content = text.trim().slice(0, 500)
    if (!content) return
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket('wss://chat-1.goodgame.ru/chat2/')
      let done = false
      let sent = false
      let authed = false
      let joined = false
      const finish = (e?: Error): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        cancellations.delete(cancel)
        try { socket.close() } catch { /* already closed */ }
        if (e) reject(e); else resolve()
      }
      const cancel = (): void => finish(new Error('Отправка GoodGame отменена'))
      const timer = setTimeout(() => finish(new Error(sent ? 'GoodGame не подтвердил доставку сообщения' : 'GoodGame не подтвердил вход в чат')), 15_000)
      cancellations.add(cancel)
      const send = (type: string, data: unknown): void => {
        if (!current()) return finish(new Error('Вход или канал GoodGame изменился — повторите действие'))
        try { socket.send(JSON.stringify({ type, data })) } catch { finish(new Error('GoodGame: не удалось отправить сообщение')) }
      }
      socket.addEventListener('error', () => finish(new Error('GoodGame: ошибка соединения для отправки')))
      socket.addEventListener('close', () => finish(new Error(sent ? 'GoodGame закрыл соединение до подтверждения доставки' : 'GoodGame закрыл соединение до входа')))
      socket.addEventListener('message', (event) => {
        if (done) return
        if (!current()) return finish(new Error('Вход или канал GoodGame изменился — повторите действие'))
        let msg: { type?: unknown; data?: Record<string, unknown> }
        try { msg = JSON.parse(String(event.data)) } catch { return }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return
        const data = msg.data && typeof msg.data === 'object' ? msg.data : {}
        if (msg.type === 'welcome') {
          send('auth', { user_id: credentials.userId, token: credentials.token })
          send('join', { channel_id: target, hidden: 0, mobile: false, reload: false })
        } else if (msg.type === 'success_auth') {
          if (String(data.user_id) !== credentials.userId) return finish(new Error('GoodGame не подтвердил аккаунт бота'))
          authed = true
        } else if (msg.type === 'success_join' && String(data.channel_id) === target) {
          joined = true
        } else if (msg.type === 'error') {
          return finish(new Error('GoodGame отклонил вход или сообщение — проверьте права бота и ограничения чата'))
        } else if (msg.type === 'message' && sent && String(data.channel_id) === target && String(data.user_id) === credentials.userId &&
          String(data.text).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&') === content) {
          // Only the server echo of this exact outgoing message confirms acceptance.
          return finish()
        }
        if (!sent && authed && joined) {
          sent = true
          send('send_message', { channel_id: target, text: content, mobile: 0 })
        }
      })
    })
  }
  return {
    state: () => { const s = auth.state(); return { account: s.account, pending: s.pending, available: s.available, error } },
    async login() {
      if (disposed) throw new Error('Профиль бота удалён')
      invalidate(); error = null
      try { await auth.login() } catch (e) { error = (e as Error).message; changed(); throw e }
    },
    cancel: invalidate,
    async logout() {
      if (disposed) throw new Error('Профиль бота удалён')
      invalidate(); await auth.logout(); error = null; changed()
    },
    send(text) {
      const gen = generation
      const result = chain.then(() => sendOne(text, gen))
      chain = result.catch(() => undefined)
      return result.then(() => { error = null; changed() }, (e) => { error = (e as Error).message; changed(); throw e })
    },
    dispose() { disposed = true; invalidate(); secrets.dispose() }
  }
}

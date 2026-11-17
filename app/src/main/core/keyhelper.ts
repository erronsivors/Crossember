import type { Hub } from './hub'
import type { KeyCapture } from './keys'
import { KEY_DEFS, MOUSE_IDS, parseHelperUrl } from './keyslayout'

/**
 * Режим «Помощник» на игровом ПК: подключается к Crossember на стрим-ПК по ссылке из домашней сети
 * и передаёт нажатия для оверлея «Клавиатура». Какие клавиши слать, решает стрим-ПК (сообщение allow);
 * пустой список — перехват на этом ПК выключен.
 */

export interface KeyHelperState {
  status: 'off' | 'connecting' | 'ok' | 'error'
  error: string | null
  /** Перехват сейчас работает (оверлей на стрим-ПК открыт и показ включён). */
  capturing: boolean
}

const MOUSE = new Set<string>(MOUSE_IDS)

export class KeyHelper {
  private url: string | null = null
  private ws: WebSocket | null = null
  private timer: NodeJS.Timeout | null = null
  private attempt = 0
  /** Стрим-ПК шлёт сообщение не реже раза в 10 с; тишина 25 с — связь пропала. */
  private watchdog: NodeJS.Timeout | null = null
  private st: KeyHelperState = { status: 'off', error: null, capturing: false }
  onChange: () => void = () => undefined

  constructor(private hub: Hub, private keys: KeyCapture) {
    keys.on('key', (id: string, down: boolean) => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ kind: 'key', id, down }))
    })
  }

  state(): KeyHelperState {
    return { ...this.st }
  }

  /** Включить помощника со ссылкой или выключить (null). Повторный вызов с той же ссылкой ничего не меняет. */
  apply(link: string | null): void {
    const url = link ? parseHelperUrl(link) : null
    if (url === this.url && (url || this.st.status === 'off')) return
    this.close()
    this.url = url
    this.attempt = 0
    if (url) this.connect()
    else this.set({ status: link ? 'error' : 'off', error: link ? 'Ссылка не похожа на ссылку Crossember для игрового ПК' : null, capturing: false })
  }

  private set(p: Partial<KeyHelperState>): void {
    this.st = { ...this.st, ...p }
    this.onChange()
  }

  private close(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = null
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onclose = null
      ws.close()
    }
    this.keys.apply(false, new Set())
  }

  private connect(): void {
    if (!this.url) return
    this.set({ status: 'connecting', capturing: false })
    const ws = new WebSocket(this.url)
    this.ws = ws
    const feed = (): void => {
      if (this.watchdog) clearTimeout(this.watchdog)
      // Мёртвое соединение может закрываться долго — считаем его закрытым сразу.
      this.watchdog = setTimeout(() => {
        if (this.ws !== ws) return
        const onclose = ws.onclose
        ws.onclose = null
        onclose?.call(ws, new CloseEvent('close', { code: 1006 }))
        try { ws.close() } catch { /* уже закрыт */ }
      }, 25_000)
    }
    ws.onopen = () => {
      feed()
      this.attempt = 0
      this.set({ status: 'ok', error: null })
      this.hub.log('hub', 'info', 'Помощник: подключён к стрим-ПК')
    }
    ws.onmessage = (e) => {
      feed()
      let m: { kind?: unknown; ids?: unknown }
      try { m = JSON.parse(String(e.data)) } catch { return }
      if (!m || typeof m !== 'object' || Array.isArray(m) || m.kind !== 'allow' || !Array.isArray(m.ids)) return
      const ids = new Set(m.ids.filter((x): x is string => typeof x === 'string' && (Object.hasOwn(KEY_DEFS, x) || MOUSE.has(x))))
      this.keys.apply(ids.size > 0, ids)
      this.set({ capturing: ids.size > 0 })
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.watchdog) clearTimeout(this.watchdog)
      this.watchdog = null
      this.keys.apply(false, new Set())
      const denied = e.code === 4003 || e.code === 4001
      this.set({
        status: 'error', capturing: false,
        error: denied ? 'Стрим-ПК не принял ссылку — скопируйте её заново в Crossember на стрим-ПК' : 'Нет связи со стрим-ПК: Crossember там запущен? Оба ПК в одной сети?'
      })
      // Неверный ключ — реже, остальное — с растущей паузой 1 → 30 с.
      const delay = denied ? 60_000 : Math.min(30_000, 1000 * 2 ** this.attempt++)
      this.timer = setTimeout(() => this.connect(), delay)
    }
    ws.onerror = () => undefined
  }

  dispose(): void {
    this.url = null
    this.close()
  }
}

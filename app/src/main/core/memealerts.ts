import { BrowserWindow, session } from 'electron'
import type { Hub } from './hub'
import type { Secrets } from './secrets'
import { isAuthUrl } from './sitewindow'
import { UA } from './donations/common'

/**
 * Memealerts: открытого API нет. Работаем через внутреннее API сайта (как сторонние инструменты на GitHub):
 * свой аккаунт, поиск саппортеров и выдача мемкоинов. Ленты входящих мемов в известном API нет —
 * поэтому в ленту событий мемы не попадают. Может сломаться, если Memealerts поменяет сайт.
 * Вход — окно сайта внутри Crossember (токен берётся из localStorage сайта) или вставка токена вручную.
 */

const API = 'https://memealerts.com/api'
const SECRET_KEY = 'memealerts.token'

type Json = Record<string, unknown>
const s = (v: unknown, max = 200): string => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max)

export interface MemeSupporter {
  id: string
  name: string
  /** Сколько мемкоинов потратил у стримера, если сайт сообщает. */
  spent: number | null
  balance: number | null
}

export interface MemealertsState {
  account: string | null
  pending: boolean
  error: string
  /** Последние выдачи мемкоинов (для журнала на экране). */
  log: { ts: number; name: string; value: number; ok: boolean; note: string }[]
}

export class Memealerts {
  private win: BrowserWindow | null = null
  private account: string | null = null
  private streamerId: string | null = null
  private error = ''
  private log: MemealertsState['log'] = []
  onChange: () => void = () => undefined

  constructor(private hub: Hub, private secrets: Secrets) {
    if (this.token()) void this.loadMe()
  }

  private token(): string | null {
    return this.secrets.get(SECRET_KEY)
  }

  state(): MemealertsState {
    return { account: this.token() ? (this.account ?? 'Memealerts') : null, pending: !!this.win, error: this.error, log: this.log.slice(0, 30) }
  }

  private async api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Json> {
    const t = this.token()
    if (!t) throw new Error('Memealerts не подключён')
    const res = await fetch(`${API}${path}`, {
      method, signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const text = await res.text()
    let j: Json = {}
    try { j = text ? (JSON.parse(text) as Json) : {} } catch { j = {} }
    if (res.status === 401 || res.status === 403) throw new Error('Вход в Memealerts истёк — войдите снова')
    if (!res.ok) throw new Error(`Memealerts: ${res.status}${j.message ? ` — ${s(j.message, 120)}` : ''}`)
    return j
  }

  private async loadMe(): Promise<void> {
    try {
      const me = await this.api('GET', '/user/current')
      this.streamerId = s(me.id ?? me._id, 64) || null
      this.account = s(me.name ?? me.username ?? me.displayName, 60) || 'Memealerts'
      this.error = this.streamerId ? '' : 'Memealerts не вернул id аккаунта'
    } catch (e) {
      this.error = (e as Error).message
    }
    this.onChange()
  }

  /** Вставить токен вручную (Local Storage сайта → accessToken). */
  async setToken(v: string): Promise<void> {
    const t = v.trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '')
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(t)) throw new Error('Это не похоже на токен Memealerts (три части через точку)')
    this.secrets.set(SECRET_KEY, t)
    await this.loadMe()
    if (!this.streamerId) { this.secrets.set(SECRET_KEY, null); throw new Error(this.error || 'Токен не подошёл') }
    this.hub.log('hub', 'info', `Memealerts подключён: ${this.account}`)
  }

  async login(): Promise<void> {
    if (this.win) { this.win.focus(); return }
    const ses = session.fromPartition(`memealerts-login-${Date.now()}`)
    ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
    ses.setPermissionCheckHandler(() => false)
    ses.setUserAgent(UA)
    ses.on('will-download', (e) => e.preventDefault())
    const win = new BrowserWindow({
      width: 520, height: 760, title: 'Вход в Memealerts — Crossember', autoHideMenuBar: true,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.win = win
    this.onChange()
    const windows = new Set<BrowserWindow>()
    const allowed = (url: string): boolean => {
      try {
        const u = new URL(url)
        return u.protocol === 'https:' && (u.hostname === 'memealerts.com' || u.hostname.endsWith('.memealerts.com') || isAuthUrl(url))
      } catch { return false }
    }
    const guard = (w: BrowserWindow): void => {
      windows.add(w)
      w.on('closed', () => windows.delete(w))
      w.webContents.setWindowOpenHandler(({ url }) => allowed(url)
        ? { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 760, autoHideMenuBar: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } } }
        : { action: 'deny' })
      w.webContents.on('did-create-window', (child) => guard(child))
      w.webContents.on('will-navigate', (e, url) => { if (!allowed(url)) e.preventDefault() })
      w.webContents.on('will-redirect', (e, url) => { if (!allowed(url)) e.preventDefault() })
    }
    guard(win)
    let checking = false
    const check = async (): Promise<void> => {
      if (checking || this.win !== win || win.isDestroyed()) return
      checking = true
      try {
        // OAuth может вернуться в дочернее окно, а не в исходную страницу.
        for (const page of windows) {
          if (page.isDestroyed()) continue
          const u = new URL(page.webContents.getURL())
          if (u.protocol !== 'https:' || u.hostname !== 'memealerts.com') continue
          const tok = await page.webContents.executeJavaScript("localStorage.getItem('accessToken')", true).catch(() => null)
          if (this.win !== win || win.isDestroyed()) return
          if (typeof tok !== 'string' || !tok) continue
          await this.setToken(tok)
          if (this.win === win) this.closeWin()
          return
        }
      } catch { /* ещё не вошёл до конца */ }
      finally { checking = false }
    }
    const iv = setInterval(() => void check(), 2000)
    win.on('closed', () => {
      clearInterval(iv)
      if (this.win === win) this.win = null
      for (const child of windows) if (child !== win && !child.isDestroyed()) child.close()
      void ses.clearStorageData().catch(() => undefined)
      this.onChange()
    })
    await win.loadURL('https://memealerts.com/')
  }

  private closeWin(): void {
    const w = this.win
    this.win = null
    w?.close()
    this.onChange()
  }

  cancelLogin(): void {
    this.closeWin()
  }

  logout(): void {
    this.secrets.set(SECRET_KEY, null)
    this.account = null
    this.streamerId = null
    this.error = ''
    this.onChange()
  }

  async supporters(query: string, limit = 20): Promise<MemeSupporter[]> {
    const j = await this.api('POST', '/supporters', { limit: Math.min(50, Math.max(1, limit)), skip: 0, query: query.trim().slice(0, 60), filters: [] })
    const list = Array.isArray(j.data) ? (j.data as Json[]) : []
    const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    return list.map((x) => ({
      id: s(x.supporterId ?? x.id ?? x._id, 64), name: s(x.supporterName ?? x.name, 64),
      spent: n(x.spent ?? x.totalSpent), balance: n(x.balance)
    })).filter((x) => x.id && x.name)
  }

  /** Выдать мемкоины саппортеру по нику (как он записан в Memealerts). */
  async giveByName(name: string, value: number): Promise<string> {
    const nick = name.trim().replace(/^@/, '')
    const v = Math.round(value)
    if (!nick || !(v > 0) || v > 100_000) throw new Error('Укажите ник и число монеток от 1 до 100 000')
    if (!this.streamerId) await this.loadMe()
    if (!this.streamerId) throw new Error(this.error || 'Memealerts не подключён')
    const found = (await this.supporters(nick, 50)).find((x) => x.name.toLowerCase() === nick.toLowerCase())
    const note = (ok: boolean, text: string): string => {
      this.log.unshift({ ts: Date.now(), name: nick, value: v, ok, note: text })
      if (this.log.length > 50) this.log.length = 50
      this.onChange()
      return text
    }
    if (!found) throw new Error(note(false, `«${nick}» нет среди саппортеров Memealerts — зритель должен хотя бы раз зайти на вашу страницу Memealerts`))
    try {
      await this.api('POST', '/user/give-bonus', { userId: found.id, streamerId: this.streamerId, value: v })
    } catch (e) {
      throw new Error(note(false, (e as Error).message))
    }
    return note(true, `${found.name}: +${v} мемкоинов`)
  }

  stop(): void {
    this.cancelLogin()
  }
}

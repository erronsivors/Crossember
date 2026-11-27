import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { shell } from 'electron'
import type { Hub } from './hub'
import type { Secrets } from './secrets'

/**
 * Общий вход OAuth 2 через браузер с возвратом на этот ПК (http://localhost:<порт>/callback, у GoodGame — через публичную страницу) —
 * для Kick, VK Видео Live и GoodGame.
 * Клиент (приложение на сайте площадки) берётся так:
 * - своё приложение пользователя («Для опытных»): Client ID и секрет в зашифрованном хранилище;
 * - общее приложение Crossember: вшивается при сборке (electron.vite.config.ts) из resources/<площадка>/oauth-client.json,
 *   в режиме разработки читается из этого файла. В Git файл не хранится — репозиторий публичный.
 * Токены — только в зашифрованном хранилище (DPAPI).
 */

export type OAuthPlatform = 'kick' | 'vk' | 'goodgame'

export interface OAuthConfig {
  platform: OAuthPlatform
  label: string
  authUrl: string
  tokenUrl: string
  scopes: string[]
  scopeSep: ' ' | ','
  port: number
  /** PKCE (S256): Kick требует, у VK в документации его нет. */
  pkce: boolean
  /** Как передавать секрет при обмене кода: в теле запроса (Kick) или заголовком Basic (VK). */
  clientAuth: 'body' | 'basic'
  /** VK требует redirect_uri и при обновлении токена. */
  redirectOnRefresh: boolean
  /**
   * Публичная страница возврата (GoodGame запрещает в приложениях адреса localhost и 127.*): она сразу переносит
   * code и state на http://127.0.0.1:<порт>/callback этого ПК. Эту же страницу указывают в приложении на сайте.
   */
  publicRedirect?: string
  /** Можно входить без секрета (ImplicitFlow: токен сразу, без обновления) — у VK это официальный способ для программ на ПК. */
  implicit?: boolean
  tokensKey: string
  customKey: string
  /** Закодированный при сборке общий клиент или ''. */
  embedded: string
  embeddedKey: string
}

export interface OAuthTokens {
  access: string
  refresh: string
  expiresAt: number
  name: string
  userId: string
  /** Адрес канала (VK) — для запросов к API. */
  channel: string
  /** Выданные права; у старых токенов поля нет. */
  scope?: string[]
}

export interface OAuthAppState {
  /** Есть ли с чем входить: общее приложение Crossember или своё. */
  available: boolean
  source: 'shared' | 'custom' | 'none'
  hasCustom: boolean
  customId: string
  account: string | null
  pending: boolean
  /** Вход старый и без нужных прав — войти заново. */
  needRelogin: boolean
  redirect: string
}

type Json = Record<string, unknown>
export const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v))
export const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const b64url = (b: Buffer): string => b.toString('base64url')
const LOGIN_TIMEOUT = 5 * 60_000

const escapeHtml = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const donePage = (label: string, ok: boolean): string =>
  `<!doctype html><meta charset="utf-8"><title>Crossember</title><body style="font:16px system-ui;background:#16110d;color:#f3e7d8;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${ok ? `Вход в ${escapeHtml(label)} выполнен` : 'Вход не удался'}</h2><p>${ok ? 'Эту вкладку можно закрыть и вернуться в Crossember.' : 'Вернитесь в Crossember и попробуйте ещё раз.'}</p></div>`

/** Раскодировать общий клиент, вшитый при сборке (тот же приём, что у YouTube: не ловится сканерами ключей). */
export function decodeEmbedded(encoded: string, key: string): string {
  if (!encoded) return ''
  const k = Buffer.from(key)
  const b = Buffer.from(encoded, 'base64').reverse()
  return Buffer.from(b.map((x, i) => x ^ k[i % k.length])).toString('utf8')
}

export class OAuthLocal {
  protected tokens: OAuthTokens | null = null
  private shared: { id: string; secret: string } | null = null
  private servers: Server[] = []
  private loginTimer: NodeJS.Timeout | null = null
  private pending = false
  private refreshing: Promise<string> | null = null
  /** Растёт при каждом входе, выходе и смене приложения: ответ старой попытки не должен перезаписать новое состояние. */
  protected generation = 0
  /** Растёт при каждом успешном входе и при сбросе входа — чтобы чат переподключался даже при повторном входе в тот же аккаунт. */
  private revisionNo = 0
  onChange: () => void = () => undefined

  constructor(protected hub: Hub, protected secrets: Secrets, resourcesDir: string, protected cfg: OAuthConfig) {
    this.shared = this.parseClient(decodeEmbedded(cfg.embedded, cfg.embeddedKey))
    if (!this.shared) {
      try {
        this.shared = this.parseClient(readFileSync(join(resourcesDir, cfg.platform, 'oauth-client.json'), 'utf8'))
      } catch {
        /* файла нет — только своё приложение */
      }
    }
    try {
      const t = JSON.parse(secrets.get(cfg.tokensKey) ?? 'null') as Partial<OAuthTokens> | null
      if (t?.refresh || t?.access) this.tokens = { access: s(t.access), refresh: s(t.refresh), expiresAt: Number(t.expiresAt) || 0, name: s(t.name), userId: s(t.userId), channel: s(t.channel), scope: Array.isArray(t.scope) ? t.scope.map(s) : undefined }
    } catch {
      /* повреждённые токены — войти заново */
    }
  }

  private parseClient(raw: string): { id: string; secret: string } | null {
    try {
      const c = obj(JSON.parse(raw))
      const ok = /^[\w.-]{4,200}$/.test(s(c.clientId)) && (!!s(c.clientSecret) || !!this.cfg.implicit)
      return ok ? { id: s(c.clientId), secret: s(c.clientSecret) } : null
    } catch {
      return null
    }
  }

  protected get redirect(): string {
    return this.cfg.publicRedirect || `http://localhost:${this.cfg.port}/callback`
  }

  private client(): { id: string; secret: string; source: 'shared' | 'custom' } | null {
    const custom = this.parseClient(this.secrets.get(this.cfg.customKey) ?? '')
    if (custom) return { ...custom, source: 'custom' }
    return this.shared ? { ...this.shared, source: 'shared' } : null
  }

  /** Есть ли у входа все права, которые просит эта версия Crossember. */
  protected hasScope(scope: string): boolean {
    return !!this.tokens?.scope?.includes(scope)
  }

  state(): OAuthAppState {
    const c = this.client()
    const custom = this.parseClient(this.secrets.get(this.cfg.customKey) ?? '')
    return {
      available: !!c,
      source: c?.source ?? 'none',
      hasCustom: !!custom,
      customId: custom?.id ?? '',
      account: this.tokens ? this.tokens.name || this.cfg.label : null,
      pending: this.pending,
      needRelogin: !!this.tokens && this.cfg.scopes.some((x) => !this.hasScope(x)),
      redirect: this.redirect
    }
  }

  loggedIn(): boolean {
    return !!this.tokens
  }

  revision(): number {
    return this.revisionNo
  }

  /** Канал вошедшего аккаунта (для чтения чата по нику): адрес канала, иначе ник. */
  accountChannel(): string {
    return this.tokens ? this.tokens.channel || this.tokens.name : ''
  }

  protected save(): void {
    if (!this.tokens) this.revisionNo++
    this.secrets.set(this.cfg.tokensKey, this.tokens ? JSON.stringify(this.tokens) : null)
  }

  /** Своё приложение на сайте площадки. id пустой — вернуться к общему приложению Crossember. */
  setCustomClient(id: string, secret: string | null): void {
    const cid = id.trim()
    if (!cid) {
      this.secrets.set(this.cfg.customKey, null)
    } else {
      if (!/^[\w.-]{4,200}$/.test(cid)) throw new Error('Client ID выглядит неправильно — скопируйте его целиком')
      const old = this.parseClient(this.secrets.get(this.cfg.customKey) ?? '')
      const sec = secret?.trim() || (old?.id === cid ? old.secret : '')
      if (!sec && !this.cfg.implicit) throw new Error('Укажите секрет приложения (Client Secret)')
      if (sec.length > 500) throw new Error('Секрет слишком длинный')
      this.secrets.set(this.cfg.customKey, JSON.stringify({ clientId: cid, clientSecret: sec }))
    }
    // Токены выданы другому приложению — они больше не обновятся.
    this.cancelLogin()
    this.generation++
    this.tokens = null
    this.save()
    this.onChange()
  }

  async login(): Promise<void> {
    const c = this.client()
    if (!c) throw new Error(`Вход в ${this.cfg.label} не настроен: укажите своё приложение в «Подключениях» («Для опытных»)`)
    this.cancelLogin()
    const gen = ++this.generation
    const verifier = b64url(randomBytes(48))
    const state = b64url(randomBytes(24))
    const label = this.cfg.label
    const servers: Server[] = []
    let used = false

    const implicit = !c.secret
    const html = { 'Content-Type': 'text/html; charset=utf-8' }
    const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
      const url = new URL(req.url ?? '/', `http://localhost:${this.cfg.port}`)
      if (implicit) {
        // ImplicitFlow: токен приходит в части адреса после «#», которую браузер не отправляет на сервер.
        // Маленькая страница переносит её в обычный запрос к этому же адресу на этом ПК.
        if (url.pathname === '/callback' && !url.search && req.method === 'GET') {
          // Токен уходит POST-запросом, а адрес с ним сразу стирается из строки и истории браузера.
          res.writeHead(200, { ...html, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).end(
            '<!doctype html><meta charset="utf-8"><title>Crossember</title><body style="font:16px system-ui;background:#16110d;color:#f3e7d8"><script>' +
            'var h=location.hash.slice(1);history.replaceState(null,"","/callback?done=1");' +
            'fetch("/callback/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:h})' +
            '.then(function(r){return r.text()}).then(function(t){document.open();document.write(t);document.close()})</script>')
          return
        }
        if (url.pathname === '/callback' && url.searchParams.get('error')) {
          // Отказ во входе может прийти обычными параметрами адреса.
          res.writeHead(400, html).end(donePage(label, false))
          if (!used && url.searchParams.get('state') === state) { used = true; this.hub.log(this.cfg.platform, 'warn', `Вход в ${label} отменён`); this.cancelLogin(servers) }
          return
        }
        if (url.pathname !== '/callback/token' || req.method !== 'POST') { res.writeHead(404).end(); return }
        let raw = ''
        req.setEncoding('utf8')
        req.on('data', (chunk: string) => { raw += chunk; if (raw.length > 16_000) req.destroy() })
        req.on('end', () => this.onImplicit(new URLSearchParams(raw), res, { state, label, gen, servers, html, isUsed: () => used, markUsed: () => { used = true } }))
        return
      }
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return }
      const code = url.searchParams.get('code')
      const okState = !used && url.searchParams.get('state') === state
      if (!okState || !code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(donePage(label, false))
        if (okState) { used = true; this.hub.log(this.cfg.platform, 'warn', `Вход в ${label} отменён`); this.cancelLogin(servers) }
        return
      }
      // Код одноразовый: повторный заход на тот же адрес не запускает второй обмен.
      used = true
      this.exchange(code, verifier, c, gen)
        .then(() => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(donePage(label, true)))
        .catch((e: Error) => {
          this.hub.log(this.cfg.platform, 'error', `Вход в ${label} не удался: ${e.message}`)
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }).end(donePage(label, false))
        })
        .finally(() => this.cancelLogin(servers))
    }
    // localhost может означать и 127.0.0.1, и ::1 — слушаем оба, только на этом компьютере.
    // Если адрес занят другой программой, браузер может отдать код ей — тогда вход не начинаем.
    let busy = false
    for (const host of ['127.0.0.1', '::1']) {
      const srv = createServer(onRequest)
      const ok = await new Promise<boolean>((resolve) => {
        srv.once('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EADDRINUSE') busy = true; resolve(false) })
        srv.listen(this.cfg.port, host, () => resolve(true))
      })
      if (ok) servers.push(srv)
    }
    if (busy || !servers.length || gen !== this.generation) {
      for (const srv of servers) srv.close()
      if (gen !== this.generation) return
      throw new Error(`Порт ${this.cfg.port} занят другой программой — закройте её и попробуйте снова`)
    }
    this.servers = servers

    const q = new URLSearchParams({ client_id: c.id, redirect_uri: this.redirect, response_type: implicit ? 'token' : 'code', state })
    if (this.cfg.scopes.length) q.set('scope', this.cfg.scopes.join(this.cfg.scopeSep))
    if (this.cfg.pkce && !implicit) {
      q.set('code_challenge', b64url(createHash('sha256').update(verifier).digest()))
      q.set('code_challenge_method', 'S256')
    }
    this.pending = true
    this.loginTimer = setTimeout(() => this.cancelLogin(), LOGIN_TIMEOUT)
    this.onChange()
    await shell.openExternal(`${this.cfg.authUrl}?${q}`)
  }

  private onImplicit(q: URLSearchParams, res: ServerResponse, a: { state: string; label: string; gen: number; servers: Server[]; html: Record<string, string>; isUsed: () => boolean; markUsed: () => void }): void {
    const okState = !a.isUsed() && q.get('state') === a.state
    const access = q.get('access_token')
    if (okState) a.markUsed()
    if (!okState || !access || !/^[\w.~+/=-]{10,4000}$/.test(access)) {
      res.writeHead(400, a.html).end(donePage(a.label, false))
      if (okState) { this.hub.log(this.cfg.platform, 'warn', `Вход в ${a.label} отменён`); this.cancelLogin(a.servers) }
      return
    }
    const exp = Number(q.get('expire_time'))
    const expiresAt = exp > 1e9 ? exp * 1000 : Date.now() + 3600_000
    this.finish({ access, refresh: '', expiresAt, name: '', userId: '', channel: '', scope: [...this.cfg.scopes] }, a.gen)
      .then(() => res.writeHead(200, a.html).end(donePage(a.label, true)))
      .catch((e: Error) => {
        this.hub.log(this.cfg.platform, 'error', `Вход в ${a.label} не удался: ${e.message}`)
        res.writeHead(500, a.html).end(donePage(a.label, false))
      })
      .finally(() => this.cancelLogin(a.servers))
  }

  /**
   * Без аргумента — отмена входа пользователем (кнопка «Отмена», таймаут, выход): начатый обмен кода уже не сохранит вход.
   * only — закрыть серверы завершившейся попытки (если это всё ещё она).
   */
  cancelLogin(only?: Server[]): void {
    if (only && only !== this.servers) { for (const srv of only) srv.close(); return }
    if (!only) this.generation++
    if (this.loginTimer) clearTimeout(this.loginTimer)
    this.loginTimer = null
    for (const srv of this.servers) srv.close()
    this.servers = []
    if (this.pending) { this.pending = false; this.onChange() }
  }

  /** Заголовок Basic для запросов, где площадка ждёт client_id:secret. */
  protected basic(c: { id: string; secret: string }): string {
    return `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString('base64')}`
  }

  private async tokenRequest(params: Record<string, string>, c: { id: string; secret: string }): Promise<Json> {
    const body = new URLSearchParams(params)
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
    if (this.cfg.clientAuth === 'basic') headers.Authorization = this.basic(c)
    else { body.set('client_id', c.id); body.set('client_secret', c.secret) }
    const res = await fetch(this.cfg.tokenUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(20_000) })
    const j = (await res.json().catch(() => ({}))) as Json
    if (!res.ok || !j.access_token) throw Object.assign(new Error(s(j.error_description) || s(j.error) || s(j.message) || `${this.cfg.label}: ${res.status}`), { status: res.status })
    return j
  }

  private grantedScopes(j: Json): string[] {
    const raw = j.scope
    const list = Array.isArray(raw) ? raw.map(s) : s(raw).split(/[\s,]+/)
    const out = list.map((x) => x.trim()).filter(Boolean)
    // Площадка не прислала список — значит, выдала то, что просили.
    return out.length ? out : [...this.cfg.scopes]
  }

  private async exchange(code: string, verifier: string, c: { id: string; secret: string }, gen: number): Promise<void> {
    const params: Record<string, string> = { grant_type: 'authorization_code', code, redirect_uri: this.redirect }
    if (this.cfg.pkce) params.code_verifier = verifier
    const j = await this.tokenRequest(params, c)
    if (gen !== this.generation) throw new Error('вход отменён')
    await this.finish({
      access: s(j.access_token), refresh: s(j.refresh_token), expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
      name: '', userId: '', channel: '', scope: this.grantedScopes(j)
    }, gen)
  }

  private async finish(t: OAuthTokens, gen: number): Promise<void> {
    if (gen !== this.generation) throw new Error('вход отменён')
    this.tokens = t
    try {
      await this.afterLogin(t)
    } catch (e) {
      this.hub.log(this.cfg.platform, 'warn', `${this.cfg.label}: не удалось узнать аккаунт — ${(e as Error).message}`)
    }
    // Пока узнавали аккаунт, пользователь мог выйти, отменить или начать новый вход.
    if (gen !== this.generation || this.tokens !== t) {
      if (this.tokens === t) this.tokens = null
      throw new Error('вход отменён')
    }
    this.revisionNo++
    this.save()
    this.hub.log(this.cfg.platform, 'info', `Вход в ${this.cfg.label} выполнен${this.tokens.name ? `: ${this.tokens.name}` : ''}`)
    this.onChange()
  }

  /** Узнать имя и id аккаунта после входа. */
  protected async afterLogin(_t: OAuthTokens): Promise<void> {
    /* у каждой площадки свой запрос */
  }

  /** Повторно узнать аккаунт, если после входа это не удалось (временная ошибка сети). */
  protected async ensureProfile(missing: (t: OAuthTokens) => boolean): Promise<void> {
    const t = this.tokens
    if (!t || !missing(t)) return
    const gen = this.generation
    await this.afterLogin(t)
    if (gen === this.generation && this.tokens === t) { this.save(); this.onChange() }
  }

  protected async accessToken(force = false): Promise<string> {
    const t = this.tokens
    if (!t) throw new Error(`Не выполнен вход в ${this.cfg.label}`)
    if (!force && Date.now() < t.expiresAt - 60_000) return t.access
    if (!t.refresh) {
      // Вход без секрета не обновляется: срок вышел — войти ещё раз (обычно одним нажатием).
      if (Date.now() < t.expiresAt && !force) return t.access
      this.tokens = null
      this.save()
      this.onChange()
      throw new Error(`Вход в ${this.cfg.label} истёк — нажмите «Войти» ещё раз`)
    }
    // Одно обновление на всех: refresh-токен одноразовый, второй параллельный запрос получил бы отказ.
    if (!this.refreshing) this.refreshing = this.refresh(t).finally(() => { this.refreshing = null })
    return this.refreshing
  }

  private async refresh(t: OAuthTokens): Promise<string> {
    const c = this.client()
    if (!c) throw new Error(`Вход в ${this.cfg.label} не настроен`)
    const gen = this.generation
    try {
      const params: Record<string, string> = { grant_type: 'refresh_token', refresh_token: t.refresh }
      if (this.cfg.redirectOnRefresh) params.redirect_uri = this.redirect
      const j = await this.tokenRequest(params, c)
      if (gen !== this.generation || this.tokens !== t) throw new Error(`Вход в ${this.cfg.label} сменился — повторите`)
      t.access = s(j.access_token)
      if (j.refresh_token) t.refresh = s(j.refresh_token)
      t.expiresAt = Date.now() + (Number(j.expires_in) || 3600) * 1000
      this.save()
      return t.access
    } catch (e) {
      const st = (e as { status?: number }).status
      if ((st === 400 || st === 401) && gen === this.generation && this.tokens === t) {
        this.tokens = null
        this.save()
        this.onChange()
        throw new Error(`Вход в ${this.cfg.label} истёк или отозван — войдите снова`)
      }
      throw e
    }
  }

  /** Запрос к API площадки от имени пользователя; при 401 — один повтор с обновлённым токеном. */
  protected async call(url: string, init: { method: string; body?: unknown }): Promise<{ status: number; json: Json }> {
    const gen = this.generation
    const go = async (token: string): Promise<Response> => {
      if (gen !== this.generation || !this.tokens) throw new Error(`Вход в ${this.cfg.label} сменился — повторите`)
      return fetch(url, {
      method: init.method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000)
      })
    }
    let res = await go(await this.accessToken())
    if (res.status === 401) res = await go(await this.accessToken(true))
    const json = res.status === 204 ? {} : ((await res.json().catch(() => ({}))) as Json)
    return { status: res.status, json }
  }

  /** Отозвать токен на стороне площадки (у каждой свой адрес). */
  protected async revoke(_t: OAuthTokens): Promise<void> {
    /* по умолчанию нечего */
  }

  async logout(): Promise<void> {
    const t = this.tokens
    this.cancelLogin()
    this.generation++
    this.tokens = null
    this.save()
    this.onChange()
    if (t) await this.revoke(t).catch(() => undefined)
  }

  protected clientForRevoke(): { id: string; secret: string } | null {
    return this.client()
  }
}

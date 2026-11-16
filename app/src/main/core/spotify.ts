import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'
import type { Hub } from './hub'
import type { Secrets } from './secrets'

/**
 * Spotify Web API: «сейчас играет», плей/пауза/дальше/назад, громкость, поиск и добавление в очередь (заказ треков).
 * Управление плеером и очередь работают только с Spotify Premium (правило Spotify).
 * Вход — OAuth + PKCE со своим приложением стримера (developer.spotify.com, Client ID без секрета),
 * адрес возврата фиксированный: http://127.0.0.1:47836/callback. Токены — только в зашифрованном хранилище.
 */

export const SPOTIFY_PORT = 47836
export const SPOTIFY_REDIRECT = `http://127.0.0.1:${SPOTIFY_PORT}/callback`
const AUTH = 'https://accounts.spotify.com/authorize'
const TOKEN = 'https://accounts.spotify.com/api/token'
const API = 'https://api.spotify.com/v1'
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing'
const TOKENS_KEY = 'spotify.tokens'
const LOGIN_TIMEOUT = 5 * 60_000

type Json = Record<string, unknown>
const s = (v: unknown, max = 300): string => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max)
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : [])
const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export interface SpotifyTrack {
  id: string
  uri: string
  title: string
  artist: string
  album: string
  durationMs: number
  /** Ссылка на обложку (i.scdn.co). */
  image: string
}

export interface SpotifyNow extends SpotifyTrack {
  playing: boolean
  progressMs: number
  /** Когда снят снимок (для плавного таймера). */
  at: number
}

export interface SpotifyState {
  clientId: boolean
  account: string | null
  premium: boolean | null
  pending: boolean
  error: string
}

interface Tokens { access: string; refresh: string; expiresAt: number; name: string; premium: boolean | null }

const trackOf = (t: Json): SpotifyTrack => {
  const album = (t.album ?? {}) as Json
  const imgs = arr(album.images)
  const img = imgs.find((i) => Number(i.width) <= 320 && Number(i.width) >= 200) ?? imgs[imgs.length - 1] ?? imgs[0]
  return {
    id: s(t.id, 40), uri: s(t.uri, 80), title: s(t.name, 200), artist: arr(t.artists).map((a) => s(a.name, 100)).join(', ').slice(0, 200),
    album: s(album.name, 200), durationMs: Number(t.duration_ms) || 0, image: /^https:\/\/i\.scdn\.co\/image\/[\w]+$/.test(s(img?.url)) ? s(img?.url) : ''
  }
}

export class Spotify {
  private tokens: Tokens | null = null
  private servers: Server[] = []
  private loginTimer: NodeJS.Timeout | null = null
  private pending = false
  private error = ''
  onChange: () => void = () => undefined

  constructor(private hub: Hub, private secrets: Secrets, private clientId: () => string) {
    try {
      const raw = secrets.get(TOKENS_KEY)
      if (raw) this.tokens = JSON.parse(raw) as Tokens
    } catch { this.tokens = null }
  }

  state(): SpotifyState {
    return { clientId: !!this.clientId(), account: this.tokens?.name || (this.tokens ? 'Spotify' : null), premium: this.tokens?.premium ?? null, pending: this.pending, error: this.error }
  }

  get connected(): boolean {
    return !!this.tokens
  }

  private save(): void {
    this.secrets.set(TOKENS_KEY, this.tokens ? JSON.stringify(this.tokens) : null)
  }

  async login(): Promise<void> {
    const id = this.clientId()
    if (!id) throw new Error('Сначала вставьте Client ID своего приложения Spotify')
    this.cancelLogin()
    const verifier = b64url(randomBytes(48))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    const state = b64url(randomBytes(16))
    const page = (ok: boolean): string => `<!doctype html><meta charset="utf-8"><title>Crossember</title><body style="font:16px system-ui;background:#0f0b0a;color:#f3e9e4;display:grid;place-items:center;height:100vh"><div>${ok ? 'Spotify подключён. Окно можно закрыть.' : 'Вход в Spotify не удался — вернитесь в Crossember.'}</div>`
    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? '/', SPOTIFY_REDIRECT)
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return }
      const code = url.searchParams.get('code')
      if (url.searchParams.get('state') !== state || !code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(false))
        this.error = url.searchParams.get('error') === 'access_denied' ? 'Вход отменён' : 'Spotify не вернул код входа'
        this.cancelLogin()
        return
      }
      this.exchange(code, verifier, id)
        .then(() => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(true)))
        .catch((e: Error) => {
          this.error = e.message
          this.hub.log('hub', 'warn', `Spotify: вход не удался — ${e.message}`)
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(false))
        })
        .finally(() => this.cancelLogin())
    })
    const ok = await new Promise<boolean>((resolve) => {
      srv.once('error', () => resolve(false))
      srv.listen(SPOTIFY_PORT, '127.0.0.1', () => resolve(true))
    })
    if (!ok) throw new Error(`Порт ${SPOTIFY_PORT} занят другой программой — закройте её и попробуйте снова`)
    this.servers.push(srv)
    this.pending = true
    this.error = ''
    this.loginTimer = setTimeout(() => this.cancelLogin(), LOGIN_TIMEOUT)
    this.onChange()
    const q = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: SPOTIFY_REDIRECT, scope: SCOPES, code_challenge_method: 'S256', code_challenge: challenge, state })
    await shell.openExternal(`${AUTH}?${q}`)
  }

  cancelLogin(): void {
    if (this.loginTimer) clearTimeout(this.loginTimer)
    this.loginTimer = null
    for (const srv of this.servers) srv.close()
    this.servers = []
    if (this.pending) { this.pending = false; this.onChange() }
  }

  logout(): void {
    this.tokens = null
    this.save()
    this.onChange()
  }

  private async tokenRequest(params: Record<string, string>): Promise<Json> {
    const res = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20_000) })
    const j = (await res.json().catch(() => ({}))) as Json
    if (!res.ok || !j.access_token) {
      const desc = s(j.error_description) || s(j.error)
      throw Object.assign(new Error(/redirect/i.test(desc) ? `Адрес возврата не совпадает: добавьте в приложении Spotify ${SPOTIFY_REDIRECT}` : desc || `Spotify: ${res.status}`), { status: res.status })
    }
    return j
  }

  private async exchange(code: string, verifier: string, clientId: string): Promise<void> {
    const j = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT, client_id: clientId, code_verifier: verifier })
    this.tokens = { access: s(j.access_token, 2000), refresh: s(j.refresh_token, 2000), expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000, name: '', premium: null }
    try {
      const me = await this.api('GET', '/me')
      this.tokens.name = s(me.display_name, 60) || s(me.id, 60)
      this.tokens.premium = me.product === undefined ? null : me.product === 'premium'
    } catch { /* имя не обязательно */ }
    this.save()
    this.error = ''
    this.hub.log('hub', 'info', `Spotify подключён${this.tokens.name ? `: ${this.tokens.name}` : ''}`)
    this.onChange()
  }

  private async token(force = false): Promise<string> {
    const t = this.tokens
    if (!t) throw new Error('Spotify не подключён')
    if (!force && Date.now() < t.expiresAt - 60_000) return t.access
    try {
      const j = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: this.clientId() })
      t.access = s(j.access_token, 2000)
      if (j.refresh_token) t.refresh = s(j.refresh_token, 2000)
      t.expiresAt = Date.now() + (Number(j.expires_in) || 3600) * 1000
      this.save()
      return t.access
    } catch (e) {
      const st = (e as { status?: number }).status
      if (st === 400 || st === 401) {
        this.tokens = null
        this.save()
        this.error = 'Вход в Spotify истёк — войдите снова'
        this.onChange()
      }
      throw e
    }
  }

  private async api(method: string, path: string, body?: unknown): Promise<Json> {
    const call = async (tok: string): Promise<Response> =>
      fetch(`${API}${path}`, {
        method, signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${tok}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    let res = await call(await this.token())
    if (res.status === 401) res = await call(await this.token(true))
    if (res.status === 204 || res.status === 202) return {}
    const text = await res.text()
    let j: Json = {}
    try { j = text ? (JSON.parse(text) as Json) : {} } catch { j = {} }
    if (!res.ok) {
      const err = (j.error ?? {}) as Json
      const reason = s(err.reason)
      if (res.status === 403 && (reason === 'PREMIUM_REQUIRED' || /premium/i.test(s(err.message)))) throw new Error('Нужен Spotify Premium')
      if (res.status === 404 && (reason === 'NO_ACTIVE_DEVICE' || /device/i.test(s(err.message)))) throw new Error('Spotify сейчас нигде не играет — включите музыку в Spotify')
      if (res.status === 429) throw new Error('Spotify просит подождать')
      throw new Error(`Spotify: ${res.status}${err.message ? ` — ${s(err.message, 120)}` : ''}`)
    }
    return j
  }

  async now(): Promise<SpotifyNow | null> {
    if (!this.tokens) return null
    const j = await this.api('GET', '/me/player/currently-playing')
    const item = j.item as Json | undefined
    if (!item || j.currently_playing_type !== 'track') return null
    return { ...trackOf(item), playing: j.is_playing === true, progressMs: Number(j.progress_ms) || 0, at: Date.now() }
  }

  async control(op: 'play' | 'pause' | 'next' | 'prev'): Promise<void> {
    if (op === 'play') await this.api('PUT', '/me/player/play')
    else if (op === 'pause') await this.api('PUT', '/me/player/pause')
    else if (op === 'next') await this.api('POST', '/me/player/next')
    else await this.api('POST', '/me/player/previous')
  }

  async volume(pct: number): Promise<void> {
    await this.api('PUT', `/me/player/volume?volume_percent=${Math.min(100, Math.max(0, Math.round(pct)))}`)
  }

  async search(q: string, limit = 5): Promise<SpotifyTrack[]> {
    const query = q.trim().slice(0, 200)
    if (!query) return []
    const j = await this.api('GET', `/search?type=track&limit=${Math.min(10, Math.max(1, limit))}&q=${encodeURIComponent(query)}`)
    return arr((j.tracks as Json | undefined)?.items).map(trackOf).filter((t) => t.id)
  }

  async track(id: string): Promise<SpotifyTrack | null> {
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return null
    const j = await this.api('GET', `/tracks/${id}`)
    return j.id ? trackOf(j) : null
  }

  async enqueue(uri: string): Promise<void> {
    if (!/^spotify:track:[A-Za-z0-9]{10,40}$/.test(uri)) throw new Error('Неверная ссылка на трек')
    await this.api('POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`)
  }
}

import { randomUUID } from 'node:crypto'
import type { Store } from './db'
import type { Platform } from './types'
import { BOT_PLATFORMS, type BotAccountAdapter, type BotAccountFactory, type BotAccountsState, type BotPlatform, type BotProfile } from './botaccounttypes'

const KEY = 'botProfiles.v1'
const norm = (v: string): string => v.normalize('NFKC').trim().replace(/^@+/, '').toLowerCase().replace(/ё/g, 'е')
const isPlatform = (v: unknown): v is BotPlatform => (BOT_PLATFORMS as readonly unknown[]).includes(v)
const cleanName = (v: unknown): string => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : ''

/** Profile names and preferences only; providers keep credentials in encrypted Secrets namespaces. */
export class BotAccounts {
  private profiles: BotProfile[] = []
  private senders: Partial<Record<BotPlatform, string>> = {}
  private adapters = new Map<string, BotAccountAdapter>()
  private disposed = false
  onChange: () => void = () => undefined

  constructor(private store: Store, private factory: BotAccountFactory) {
    const raw = store.get<unknown>(KEY, {})
    const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const seen = new Set<string>()
    if (Array.isArray(value.profiles)) for (const item of value.profiles) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>
      if (typeof p.id !== 'string' || !/^[\w-]{1,80}$/.test(p.id) || seen.has(p.id) || !isPlatform(p.platform)) continue
      seen.add(p.id)
      this.profiles.push({ id: p.id, platform: p.platform, name: cleanName(p.name), excludeAnalytics: p.excludeAnalytics !== false, excludePoints: p.excludePoints !== false, hideChat: p.hideChat === true })
    }
    const senders = value.senders && typeof value.senders === 'object' ? value.senders as Record<string, unknown> : {}
    for (const platform of BOT_PLATFORMS) {
      const id = senders[platform]
      if (typeof id === 'string' && this.profiles.some((p) => p.id === id && p.platform === platform)) this.senders[platform] = id
    }
  }

  private changed(): void {
    this.store.set(KEY, { profiles: this.profiles, senders: this.senders })
    this.onChange()
  }
  private find(id: string): BotProfile {
    const p = this.profiles.find((p) => p.id === id)
    if (!p || this.disposed) throw new Error('Профиль бота не найден')
    return p
  }
  private adapter(p: BotProfile): BotAccountAdapter {
    let adapter = this.adapters.get(p.id)
    if (!adapter) {
      adapter = this.factory(p, () => { if (!this.disposed && this.profiles.some((x) => x.id === p.id)) this.onChange() })
      this.adapters.set(p.id, adapter)
    }
    return adapter
  }
  state(): BotAccountsState {
    return { profiles: this.profiles.map((p) => ({ ...p, selected: this.senders[p.platform] === p.id, auth: this.adapter(p).state() })), senders: { ...this.senders } }
  }
  add(platform: unknown, name: unknown): string {
    if (!isPlatform(platform) || this.disposed) throw new Error('Выберите площадку с чатом')
    const id = randomUUID()
    this.profiles.push({ id, platform, name: cleanName(name), excludeAnalytics: true, excludePoints: true, hideChat: false })
    this.changed()
    return id
  }
  update(id: string, patch: unknown): void {
    const p = this.find(id)
    const o = patch && typeof patch === 'object' ? patch as Record<string, unknown> : {}
    // Platform and ID are immutable: changing one must never retarget an authenticated account.
    if (typeof o.name === 'string') p.name = cleanName(o.name)
    for (const key of ['excludeAnalytics', 'excludePoints', 'hideChat'] as const) if (typeof o[key] === 'boolean') p[key] = o[key]
    this.changed()
  }
  sender(platform: unknown, id: unknown): void {
    if (!isPlatform(platform)) throw new Error('Неизвестная площадка')
    if (id === null) delete this.senders[platform]
    else {
      if (typeof id !== 'string') throw new Error('Выберите профиль бота')
      const p = this.find(id)
      if (p.platform !== platform || !this.adapter(p).state().account) throw new Error('Сначала войдите в выбранный аккаунт')
      this.senders[platform] = id
    }
    this.changed()
  }
  selected(platform: Platform): boolean { return isPlatform(platform) && !!this.senders[platform] }
  canSend(platform: Platform): boolean {
    if (!isPlatform(platform)) return false
    const p = this.profiles.find((p) => p.id === this.senders[platform])
    return !!p && !!this.adapter(p).state().account
  }
  async send(platform: Platform, text: string, replyTo?: string): Promise<boolean> {
    if (!isPlatform(platform) || !this.senders[platform]) return false
    const p = this.find(this.senders[platform]!)
    const adapter = this.adapter(p)
    if (!adapter.state().account) throw new Error('Выбранный бот вышел из аккаунта — войдите заново или выберите отправителя')
    await adapter.send(text, replyTo)
    return true
  }
  async login(id: string): Promise<void> {
    const p = this.find(id)
    // Every OAuth callback port is shared with the primary account and must have one owner.
    for (const a of this.adapters.values()) a.cancel()
    await this.adapter(p).login()
    if (!this.disposed && this.profiles.some((x) => x.id === id)) this.onChange()
  }
  cancel(id: string): void { this.adapter(this.find(id)).cancel(); this.onChange() }
  async logout(id: string): Promise<void> {
    const p = this.find(id)
    await this.adapter(p).logout()
    // Keep sender selected so failure is visible; never silently send as the channel instead.
    if (!this.disposed) this.onChange()
  }
  async remove(id: string): Promise<void> {
    const p = this.find(id)
    const a = this.adapter(p)
    a.cancel()
    this.profiles = this.profiles.filter((p) => p.id !== id)
    if (this.senders[p.platform] === id) delete this.senders[p.platform]
    this.adapters.delete(id)
    this.changed()
    // Logout clears the credential namespace synchronously before any remote revocation awaits.
    // Disposing first would block that write and leave orphaned credentials on disk.
    const loggingOut = a.logout()
    a.dispose()
    await loggingOut
  }
  private names(p: BotProfile): string[] { return [p.name, this.adapter(p).state().account ?? ''].map(norm).filter(Boolean) }
  excluded(platform: Platform, user: string, flag: 'excludeAnalytics' | 'excludePoints'): boolean {
    const name = norm(user)
    return !!name && this.profiles.some((p) => p.platform === platform && p[flag] && this.names(p).includes(name))
  }
  hidden(): Partial<Record<BotPlatform, string[]>> {
    const map: Partial<Record<BotPlatform, string[]>> = {}
    for (const p of this.profiles) if (p.hideChat) (map[p.platform] ??= []).push(...this.names(p))
    return map
  }
  cancelAll(): void { for (const a of this.adapters.values()) a.cancel() }
  /** Registration changed: credentials issued to the previous client cannot be reused. */
  resetPlatform(platform: BotPlatform): void {
    for (const p of this.profiles) if (p.platform === platform) {
      const a = this.adapter(p)
      this.adapters.delete(p.id)
      const logout = a.logout() // synchronous local clear; remote revocation is best-effort
      a.dispose()
      void logout.catch(() => undefined)
    }
    this.onChange()
  }
  dispose(): void {
    this.disposed = true
    for (const a of this.adapters.values()) a.dispose()
    this.adapters.clear()
  }
}

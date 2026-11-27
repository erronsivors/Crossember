import type { Hub } from './hub'
import type { Secrets } from './secrets'
import type { Settings } from './settings'
import type { BotAccountAdapter, BotAccountStatus, BotProfile } from './botaccounttypes'
import { TwitchAuth, type DeviceStart } from './twitch/auth'
import type { TwitchConnector } from './twitch'
import { KickAuth } from './kickauth'
import { VkAuth } from './vkauth'

export interface BotProviderDeps {
  hub: Hub
  secrets: Secrets
  settings: Settings
  resourcesDir: string
  twitch: TwitchConnector
}

export type ScopedBotSecrets = Secrets & { dispose(): void }

/** Identity tokens are isolated; application registration is shared and never writable through this view. */
export function botSecrets(source: Secrets, id: string): ScopedBotSecrets {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Неверный идентификатор профиля')
  const shared = new Set(['kick.customClient', 'vk.customClient', 'goodgame.customClient', 'youtube.customSecret'])
  const key = (name: string): string => shared.has(name) ? name : `botAccounts.${id}.${name}`
  let alive = true
  return {
    available: () => alive && source.available(),
    get: (name: string) => alive ? source.get(key(name)) : null,
    has: (name: string) => alive && source.has(key(name)),
    set: (name: string, value: string | null) => {
      if (!alive) return
      if (shared.has(name)) throw new Error('Настройки приложения меняются в основном подключении')
      source.set(key(name), value)
    },
    dispose: () => { alive = false }
  } as unknown as ScopedBotSecrets
}

const message = (error: unknown): string => error instanceof Error ? error.message : 'Не удалось выполнить действие с профилем'

export function createTwitchBot(profile: BotProfile, onChange: () => void, deps: BotProviderDeps): BotAccountAdapter {
  const scoped = botSecrets(deps.secrets, profile.id)
  const auth = new TwitchAuth(scoped, () => deps.twitch.clientId())
  let device: DeviceStart | null = null
  let pending = false
  let error: string | null = null
  let generation = 0
  let alive = true
  const changed = (): void => { if (alive) onChange() }
  const cancel = (): void => {
    generation++
    device?.cancel()
    device = null
    pending = false
    changed()
  }
  return {
    state: (): BotAccountStatus => ({
      account: alive ? auth.account('bot')?.name ?? null : null,
      available: alive && !!deps.twitch.clientId(), pending: alive && pending, error,
      device: device ? { userCode: device.userCode, uri: device.uri, expiresAt: device.expiresAt } : null
    }),
    async login() {
      if (!alive) throw new Error('Профиль удалён')
      cancel()
      const gen = generation
      pending = true
      error = null
      changed()
      try {
        const next = await auth.startDevice('bot')
        if (!alive || gen !== generation) { next.cancel(); return }
        device = next
        changed()
        void next.wait().catch((e) => { if (alive && gen === generation) error = message(e) }).finally(() => {
          if (alive && gen === generation) { device = null; pending = false; changed() }
        })
      } catch (e) {
        if (alive && gen === generation) { error = message(e); pending = false; changed() }
        throw e
      }
    },
    cancel,
    async logout() { cancel(); await auth.logout('bot'); error = null; changed() },
    async send(text, replyTo) {
      if (!alive) throw new Error('Профиль удалён')
      try { await deps.twitch.sendWithAuth(auth, text, replyTo); error = null }
      catch (e) { error = message(e); throw e }
      finally { changed() }
    },
    dispose() { cancel(); alive = false; scoped.dispose() }
  }
}

/** No chat readers are created here: all identities send into the one primary channel. */
function createOAuthBot(profile: BotProfile, onChange: () => void, deps: BotProviderDeps, platform: 'kick' | 'vk'): BotAccountAdapter {
  const scoped = botSecrets(deps.secrets, profile.id)
  let alive = true
  let error: string | null = null
  const changed = (): void => { if (alive) onChange() }
  // OAuth callbacks complete after login() returns. Route their errors to this profile,
  // never to the status/log of the streamer's primary connection.
  const hub = Object.create(deps.hub) as Hub
  hub.register = () => undefined
  hub.setStatus = (_id, state, detail) => { if (state === 'error') error = detail; changed() }
  hub.log = (_id, level, text) => { if (level === 'error' || level === 'warn') error = text; changed() }
  const auth = platform === 'kick'
    ? new KickAuth(hub, scoped, deps.resourcesDir, true)
    : new VkAuth(hub, scoped, deps.resourcesDir, () => deps.settings.get().vk.channel, true)
  auth.onChange = changed
  return {
    state() {
      const s = auth.state()
      return { account: alive ? s.account : null, pending: alive && s.pending, available: alive && s.available, error: error || (s.needRelogin ? 'Войдите в профиль заново: нужны права отправки' : null) }
    },
    async login() {
      if (!alive) throw new Error('Профиль удалён')
      error = null
      try { await auth.login() } catch (e) { error = message(e); throw e } finally { changed() }
    },
    cancel() { auth.cancelLogin() },
    async logout() { await auth.logout(); error = null; changed() },
    async send(text, replyTo) {
      if (!alive) throw new Error('Профиль удалён')
      try {
        if (auth instanceof KickAuth) await auth.sendChatTo(text, replyTo, deps.settings.get().kick.channel)
        else await auth.sendChatTo(text, deps.settings.get().vk.channel)
        error = null
      } catch (e) { error = message(e); throw e } finally { changed() }
    },
    dispose() { auth.cancelLogin(); auth.onChange = () => undefined; alive = false; scoped.dispose() }
  }
}

export const createKickBot = (profile: BotProfile, onChange: () => void, deps: BotProviderDeps): BotAccountAdapter => createOAuthBot(profile, onChange, deps, 'kick')
export const createVkBot = (profile: BotProfile, onChange: () => void, deps: BotProviderDeps): BotAccountAdapter => createOAuthBot(profile, onChange, deps, 'vk')

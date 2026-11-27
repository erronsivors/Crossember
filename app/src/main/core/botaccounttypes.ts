/** Public metadata only. Authentication credentials never enter settings or renderer snapshots. */
export const BOT_PLATFORMS = ['twitch', 'youtube', 'vk', 'kick', 'goodgame'] as const
export type BotPlatform = (typeof BOT_PLATFORMS)[number]
export interface BotProfile {
  id: string
  platform: BotPlatform
  name: string
  excludeAnalytics: boolean
  excludePoints: boolean
  hideChat: boolean
}
export interface BotAccountStatus {
  account: string | null
  pending: boolean
  available: boolean
  error?: string | null
  /** Device authorization uses a short public confirmation code, never an access token. */
  device?: { userCode: string; uri: string; expiresAt: number } | null
}
export interface BotProfileView extends BotProfile { auth: BotAccountStatus; selected: boolean }
export interface BotAccountsState { profiles: BotProfileView[]; senders: Partial<Record<BotPlatform, string>> }
export interface BotAccountAdapter {
  state(): BotAccountStatus
  login(): Promise<void>
  cancel(): void
  logout(): Promise<void>
  send(text: string, replyTo?: string): Promise<void>
  dispose(): void
}
export type BotAccountFactory = (profile: BotProfile, onChange: () => void) => BotAccountAdapter

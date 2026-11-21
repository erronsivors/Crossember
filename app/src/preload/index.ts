import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { LogBundle } from '../main/core/feedback'
import type { HubSnapshot } from '../main/core/types'
import type { StatsSnapshot } from '../main/core/stats'
import type { SoundInfo } from '../main/core/sounds'
import type { AppSettings } from '../main/core/settings'
import type { MediaInfo } from '../main/core/media'
import type { AlertTemplate, ObsAction } from '../main/core/templates'
import type { Rule } from '../main/core/rules'
import type { Counter } from '../main/core/counters'
import type { AuctionBet, AuctionLot, AuctionState } from '../main/core/auction'
import type { PollDraft, VoteKind, VoteOption, VoteResult } from '../main/core/vote'
import type { WheelItem } from '../main/core/wheel'
import type { GoalInput } from '../main/core/goal'
import type { ProfilePart, ProfileSummary } from '../main/core/profile'
import type { ObsCatalog } from '../main/core/obs'
import type { TtsVoice } from '../main/core/tts'
import type { SileroStatus } from '../main/core/silero'
import type { AnalyticsPeriod, AnalyticsReport, StreamSamples, ViewerRef } from '../main/core/analytics'
import type { Viewer } from '../main/core/points'
import type { RewardMeta } from '../main/core/rewards'
import type { TwitchChatSettings, TwitchRewardInput } from '../main/core/twitch'
import type { SpotifyTrack } from '../main/core/spotify'
import type { MemeSupporter } from '../main/core/memealerts'
import type { VizRun } from '../main/core/viz'

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }
type Role = 'broadcaster' | 'bot'
const call = <T = void>(ch: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(ch, ...args)

// Интерфейс видит только эти функции — никакого прямого доступа к Node/Electron.
const api = {
  snapshot: () => call<HubSnapshot>('hub:snapshot'),
  setSettings: (patch: DeepPartial<AppSettings>) => call<AppSettings>('hub:settings', patch),
  obsConfigure: (url: string, password?: string) => call('hub:obsConfigure', url, password),
  obsReconnect: () => call('hub:obsReconnect'),
  titleBar: (color: string, symbol: string) => call('hub:titleBar', color, symbol),
  profileSave: (name: string) => call('hub:profileSave', name),
  profileSwitch: (name: string) => call('hub:profileSwitch', name),
  profileRemove: (name: string) => call('hub:profileRemove', name),
  quit: () => call('hub:quit'),
  openGuide: () => call('hub:openGuide'),
  relaunch: () => call('hub:relaunch'),
  view: (page: string) => call('hub:view', page),
  vizFrame: (v: number[]) => ipcRenderer.send('hub:vizFrame', v),
  vizStatus: (state: 'on' | 'off' | 'error', error?: string) => call('hub:vizStatus', state, error ?? ''),
  vizGet: () => call<VizRun | null>('hub:vizGet'),
  onViz: (cb: (run: VizRun | null) => void): (() => void) => {
    const fn = (_e: IpcRendererEvent, run: VizRun | null): void => cb(run)
    ipcRenderer.on('hub:viz', fn)
    return () => { ipcRenderer.removeListener('hub:viz', fn) }
  },
  rotateKey: (which: 'overlay' | 'remote' | 'dock' | 'mod' | 'keys') => call('hub:rotateKey', which),
  logError: (text: string) => call('hub:logError', text),
  crashDismiss: () => call('hub:crashDismiss'),
  feedbackCollect: () => call<LogBundle>('hub:feedbackCollect'),
  feedbackShowFile: () => call('hub:feedbackShowFile'),
  feedbackOpenFile: () => call('hub:feedbackOpenFile'),
  openLogsFolder: () => call('hub:openLogsFolder'),
  feedbackSend: (form: { kind: string; text: string; contact: string }, via: 'gmail' | 'mailto', withLogs: boolean) => call<LogBundle | null>('hub:feedbackSend', form, via, withLogs),
  copy: (text: string) => call('hub:copy', text),
  openExternal: (url: string) => call('hub:openExternal', url),
  testEvent: (kind: 'donation' | 'bigdonation' | 'sub' | 'follow' | 'raid' | 'gift' | 'bits' | 'reward' | 'boosty' | 'message') => call('hub:testEvent', kind),
  manualDonation: (d: { user: string; amount: number; currency: string; text: string; amountRub?: number }) => call('hub:manualDonation', d),
  alertPause: (v: boolean) => call('hub:alertPause', v),
  alertSkip: () => call('hub:alertSkip'),
  alertStopAll: () => call('hub:alertStopAll'),
  alertRemove: (id: string) => call('hub:alertRemove', id),
  alertReplay: (eventId: string) => call<boolean>('hub:alertReplay', eventId),
  stats: (period: string) => call<StatsSnapshot>('hub:stats', period),
  chatTest: () => call('hub:chatTest'),
  analytics: (period: AnalyticsPeriod) => call<AnalyticsReport>('hub:analytics', period),
  analyticsStream: (id: string) => call<StreamSamples | null>('hub:analyticsStream', id),
  analyticsMerge: (refs: ViewerRef[]) => call('hub:analyticsMerge', refs),
  analyticsUnmerge: (ref: ViewerRef) => call('hub:analyticsUnmerge', ref),
  analyticsDismiss: (key: string) => call('hub:analyticsDismiss', key),
  analyticsForget: (id: string) => call('hub:analyticsForget', id),
  analyticsClear: () => call('hub:analyticsClear'),
  soundAdd: () => call<SoundInfo | null>('hub:soundAdd'),
  soundRemove: (id: string) => call('hub:soundRemove', id),
  rulePut: (r: Rule, first?: boolean) => call<Rule>('hub:rulePut', r, first === true),
  ruleRemove: (id: string) => call('hub:ruleRemove', id),
  ruleMove: (id: string, dir: -1 | 1) => call('hub:ruleMove', id, dir),
  ruleTest: (id: string, kind: string) => call<boolean>('hub:ruleTest', id, kind),
  rulesFlags: (p: { enabled?: boolean; dryRun?: boolean }) => call('hub:rulesFlags', p),
  rulesClearLog: () => call('hub:rulesClearLog'),
  infoDraft: (v: { title?: string; game?: string; ytCategory?: string; targets?: string[] }) => call('hub:infoDraft', v),
  infoApply: () => call('hub:infoApply'),
  infoSuggest: (q: string) => call<string[]>('hub:infoSuggest', q),
  infoFromTwitch: () => call('hub:infoFromTwitch'),
  infoOpen: (p: string) => call('hub:infoOpen', p),
  kickLogin: () => call('hub:kickLogin'),
  kickCancel: () => call('hub:kickCancel'),
  kickLogout: () => call('hub:kickLogout'),
  vkLogin: () => call('hub:vkLogin'),
  vkCancel: () => call('hub:vkCancel'),
  vkLogout: () => call('hub:vkLogout'),
  ggLogin: () => call('hub:ggLogin'),
  ggCancel: () => call('hub:ggCancel'),
  ggLogout: () => call('hub:ggLogout'),
  oauthApp: (p: 'kick' | 'vk' | 'goodgame', id: string, secret: string) => call('hub:oauthApp', p, id, secret),
  profileExport: (withMedia: boolean) => call<{ size: number } | null>('hub:profileExport', withMedia),
  profilePick: () => call<ProfileSummary | null>('hub:profilePick'),
  profileApply: (parts: ProfilePart[]) => call('hub:profileApply', parts),
  profileCancel: () => call('hub:profileCancel'),
  profileUndo: () => call('hub:profileUndo'),
  counterPut: (c: Partial<Counter> & { name: string }) => call<Counter>('hub:counterPut', c),
  counterRemove: (id: string) => call('hub:counterRemove', id),
  counterApply: (id: string, op: 'add' | 'sub' | 'set', n: number) => call<Counter | null>('hub:counterApply', id, op, n),
  aucLotAdd: (name: string) => call<AuctionLot>('hub:aucLotAdd', name),
  aucLotRename: (id: string, name: string) => call('hub:aucLotRename', id, name),
  aucLotApprove: (id: string) => call('hub:aucLotApprove', id),
  aucLotRemove: (id: string) => call('hub:aucLotRemove', id),
  aucLotMerge: (from: string, into: string) => call('hub:aucLotMerge', from, into),
  aucLotAddSum: (id: string, rub: number) => call('hub:aucLotAddSum', id, rub),
  aucBetAssign: (bet: string, lot: string) => call('hub:aucBetAssign', bet, lot),
  aucBetNewLot: (bet: string, name?: string) => call<AuctionLot>('hub:aucBetNewLot', bet, name),
  aucBetReject: (bet: string) => call('hub:aucBetReject', bet),
  aucBetReopen: (bet: string) => call('hub:aucBetReopen', bet),
  aucManualBet: (b: { user: string; rub: number; text: string }) => call<AuctionBet>('hub:aucManualBet', b),
  aucTimer: (op: 'start' | 'pause' | 'add' | 'sub' | 'set' | 'clear', sec?: number) => call('hub:aucTimer', op, sec),
  aucAccepting: (v: boolean) => call('hub:aucAccepting', v),
  aucFinish: () => call<AuctionState['winner']>('hub:aucFinish'),
  aucReset: (keepLots: boolean) => call('hub:aucReset', keepLots),
  aucClearArchive: () => call('hub:aucClearArchive'),
  voteStart: (d: PollDraft) => call('hub:voteStart', d),
  voteFinish: (k: VoteKind) => call<VoteResult | null>('hub:voteFinish', k),
  voteClose: (k: VoteKind) => call('hub:voteClose', k),
  voteOpen: (k: VoteKind, v: boolean) => call('hub:voteOpen', k, v),
  voteTimer: (op: 'add' | 'sub' | 'clear', sec?: number) => call('hub:voteTimer', op, sec),
  voteTitle: (k: VoteKind, title: string) => call('hub:voteTitle', k, title),
  voteSuggest: (k: VoteKind, v: boolean) => call('hub:voteSuggest', k, v),
  voteOptAdd: (k: VoteKind, name: string) => call<VoteOption>('hub:voteOptAdd', k, name),
  voteOptRename: (k: VoteKind, id: string, name: string) => call('hub:voteOptRename', k, id, name),
  voteOptRemove: (k: VoteKind, id: string) => call('hub:voteOptRemove', k, id),
  voteOptVotes: (k: VoteKind, id: string, n: number) => call('hub:voteOptVotes', k, id, n),
  voteApprove: (k: VoteKind, id: string, name?: string, into?: string) => call('hub:voteApprove', k, id, name, into),
  voteReject: (k: VoteKind, id: string) => call('hub:voteReject', k, id),
  voteShow: (v: boolean) => call('hub:voteShow', v),
  voteClearArchive: () => call('hub:voteClearArchive'),
  wheelSetItems: (items: WheelItem[]) => call('hub:wheelSetItems', items),
  wheelLoadLots: () => call<number>('hub:wheelLoadLots'),
  wheelSpin: () => call('hub:wheelSpin'),
  wheelRestart: () => call('hub:wheelRestart'),
  wheelClearHistory: () => call('hub:wheelClearHistory'),
  goalStart: (v: GoalInput) => call('hub:goalStart', v),
  goalEdit: (v: GoalInput) => call('hub:goalEdit', v),
  goalFinish: () => call('hub:goalFinish'),
  goalAccepting: (on: boolean) => call('hub:goalAccepting', on),
  goalDuration: (min: number) => call('hub:goalDuration', min),
  goalExtend: (min: number) => call('hub:goalExtend', min),
  goalAdd: (rub: number, note?: string) => call('hub:goalAdd', rub, note),
  goalToggleGift: (id: string) => call('hub:goalToggleGift', id),
  goalClearArchive: () => call('hub:goalClearArchive'),
  gwStart: (prize: string, min: number) => call('hub:gwStart', prize, min),
  gwExtend: (min: number) => call('hub:gwExtend', min),
  gwClose: () => call('hub:gwClose'),
  gwPrize: (prize: string) => call('hub:gwPrize', prize),
  gwRemove: (key: string) => call('hub:gwRemove', key),
  gwFakes: (n: number) => call<number>('hub:gwFakes', n),
  gwDraw: (n: number) => call('hub:gwDraw', n),
  gwReroll: (key: string) => call('hub:gwReroll', key),
  gwReset: () => call('hub:gwReset'),
  gwClearArchive: () => call('hub:gwClearArchive'),
  templatePut: (t: AlertTemplate) => call<AlertTemplate>('hub:templatePut', t),
  templateRemove: (id: string) => call('hub:templateRemove', id),
  templateDuplicate: (id: string) => call<AlertTemplate | null>('hub:templateDuplicate', id),
  templateTest: (t: AlertTemplate, kind: string) => call('hub:templateTest', t, kind),
  mediaAdd: () => call<MediaInfo | null>('hub:mediaAdd'),
  mediaRemove: (id: string) => call('hub:mediaRemove', id),
  openOverlay: (id: string) => call('hub:openOverlay', id),
  obsCatalog: () => call<ObsCatalog>('hub:obsCatalog'),
  obsTest: (a: ObsAction) => call('hub:obsTest', a),
  ttsVoices: () => call<TtsVoice[]>('hub:ttsVoices'),
  sileroStatus: () => call<SileroStatus>('hub:sileroStatus'),
  sileroInstall: () => call<SileroStatus>('hub:sileroInstall'),
  sileroInstallExtra: () => call<SileroStatus>('hub:sileroInstallExtra'),
  sileroRemove: () => call<void>('hub:sileroRemove'),
  ttsTest: (text: string, voice?: string) => call<string>('hub:ttsTest', text, voice ?? ''),
  daLogin: () => call('hub:daLogin'),
  daCancel: () => call('hub:daCancel'),
  dpKey: (key: string) => call('hub:dpKey', key),
  dxLogin: () => call('hub:dxLogin'),
  dxCancel: () => call('hub:dxCancel'),
  dxToken: (token: string) => call('hub:dxToken', token),
  boostyLogin: () => call('hub:boostyLogin'),
  boostyCancel: () => call('hub:boostyCancel'),
  openSite: (id: string) => call('hub:openSite', id),
  clearSite: (id: string) => call('hub:clearSite', id),
  donationLogout: (platform: string) => call('hub:donationLogout', platform),
  reconnect: (platform: string) => call('hub:reconnect', platform),
  floatEdit: () => call('hub:floatEdit'),
  floatReset: () => call('hub:floatReset'),
  twitchLogin: (role: Role) => call('hub:twitchLogin', role),
  twitchCancel: () => call('hub:twitchCancel'),
  twitchLogout: (role: Role) => call('hub:twitchLogout', role),
  twitchRestart: () => call('hub:twitchRestart'),
  youtubeLogin: () => call('hub:youtubeLogin'),
  youtubeCancel: () => call('hub:youtubeCancel'),
  youtubeLogout: () => call('hub:youtubeLogout'),
  youtubeSecret: (secret: string | null) => call('hub:youtubeSecret', secret),
  chatSend: (text: string, as: Role, targets: string[], reply?: { platform: string; id: string } | null) => call('hub:chatSend', text, as, targets, reply ?? null),
  chatPin: (id: string | null) => call('hub:chatPin', id),
  chatDelete: (id: string) => call('hub:chatDelete', id),
  chatBan: (id: string, seconds: number) => call('hub:chatBan', id, seconds),
  // Очки зрителей
  pointsSearch: (q: string) => call<Viewer[]>('hub:pointsSearch', q),
  pointsAdjust: (name: string, platform: string, n: number) => call<number>('hub:pointsAdjust', name, platform, n),
  pointsSet: (key: string, n: number) => call('hub:pointsSet', key, n),
  pointsRemove: (key: string) => call('hub:pointsRemove', key),
  pointsReset: () => call('hub:pointsReset'),
  pointsClearLog: () => call('hub:pointsClearLog'),
  // Бот
  botTest: (text: string) => call<string>('hub:botTest', text),
  botClearLog: () => call('hub:botClearLog'),
  // Ставки
  betStart: (v: { source: 'own' | 'twitch'; title: string; outcomes: string[]; sec: number }) => call('hub:betStart', v),
  betLock: () => call<string>('hub:betLock'),
  betResolve: (num: number) => call<string>('hub:betResolve', num),
  betCancel: () => call<string>('hub:betCancel'),
  betExtend: (sec: number) => call('hub:betExtend', sec),
  betClose: () => call('hub:betClose'),
  betManual: (name: string, platform: string, num: number, amount: string) => call('hub:betManual', name, platform, num, amount),
  betClearArchive: () => call('hub:betClearArchive'),
  // Награды за баллы
  rewardsRefresh: () => call('hub:rewardsRefresh'),
  rewardCreate: (r: Partial<TwitchRewardInput>, meta: Partial<RewardMeta>) => call('hub:rewardCreate', r, meta),
  rewardUpdate: (id: string, r: Partial<TwitchRewardInput>) => call('hub:rewardUpdate', id, r),
  rewardRemove: (id: string) => call('hub:rewardRemove', id),
  rewardMeta: (id: string, meta: Partial<RewardMeta>) => call('hub:rewardMeta', id, meta),
  rewardsPause: (v: boolean) => call('hub:rewardsPause', v),
  redeemDone: (id: string) => call('hub:redeemDone', id),
  redeemRefund: (id: string) => call('hub:redeemRefund', id),
  redeemDoneAll: () => call('hub:redeemDoneAll'),
  redeemClearDone: () => call('hub:redeemClearDone'),
  // Музыка
  spotifyLogin: () => call('hub:spotifyLogin'),
  spotifyCancel: () => call('hub:spotifyCancel'),
  spotifyLogout: () => call('hub:spotifyLogout'),
  musicControl: (op: 'toggle' | 'next' | 'prev') => call('hub:musicControl', op),
  musicVolume: (n: number) => call('hub:musicVolume', n),
  musicSearch: (q: string) => call<SpotifyTrack[]>('hub:musicSearch', q),
  musicRequest: (q: string) => call('hub:musicRequest', q),
  musicClearRequests: () => call('hub:musicClearRequests'),
  // Сабатон
  subStart: (min: number) => call('hub:subStart', min),
  subPause: (v: boolean) => call('hub:subPause', v),
  subStop: () => call('hub:subStop'),
  subAdd: (sec: number) => call<number>('hub:subAdd', sec),
  subHappy: (v: boolean) => call('hub:subHappy', v),
  // Панель канала Twitch
  twRaid: (login: string) => call<string>('hub:twRaid', login),
  twRaidCancel: () => call('hub:twRaidCancel'),
  twShoutout: (login: string) => call<string>('hub:twShoutout', login),
  twBan: (login: string, sec: number, reason: string) => call<string>('hub:twBan', login, sec, reason),
  twUnban: (login: string) => call<string>('hub:twUnban', login),
  twChatSettings: () => call<TwitchChatSettings>('hub:twChatSettings'),
  twSetChatSettings: (p: Partial<TwitchChatSettings>) => call<TwitchChatSettings>('hub:twSetChatSettings', p),
  twCommercial: (sec: number) => call<number>('hub:twCommercial', sec),
  twMarker: (d: string) => call('hub:twMarker', d),
  twClip: () => call<{ id: string; url: string; editUrl: string }>('hub:twClip'),
  twAnnounce: (text: string, color: string) => call('hub:twAnnounce', text, color),
  // Memealerts
  memeLogin: () => call('hub:memeLogin'),
  templateExport: (id: string) => call<string | null>('hub:templateExport', id),
  packCorner: (id: string) => call<unknown>('hub:packCorner', id),
  templateImport: () => call<{ ok: number; bad: string[] } | null>('hub:templateImport'),
  memeCancel: () => call('hub:memeCancel'),
  memeLogout: () => call('hub:memeLogout'),
  memeToken: (t: string) => call('hub:memeToken', t),
  memeSupporters: (q: string) => call<MemeSupporter[]>('hub:memeSupporters', q),
  memeGive: (name: string, n: number) => call<string>('hub:memeGive', name, n),
  updateCheck: () => call('hub:updateCheck'),
  updateDownload: () => call('hub:updateDownload'),
  updateLater: () => call('hub:updateLater'),
  updateInstall: () => call('hub:updateInstall'),
  /** Главный процесс просит открыть раздел (например, «Обратная связь» после восстановления базы). */
  onGo: (cb: (page: string) => void): (() => void) => {
    const fn = (_e: IpcRendererEvent, p: unknown): void => { if (typeof p === 'string') cb(p) }
    ipcRenderer.on('hub:go', fn)
    return () => ipcRenderer.removeListener('hub:go', fn)
  },
  onUpdate: (cb: (s: HubSnapshot) => void): (() => void) => {
    const fn = (_e: IpcRendererEvent, s: HubSnapshot): void => cb(s)
    ipcRenderer.on('hub:update', fn)
    return () => ipcRenderer.removeListener('hub:update', fn)
  }
}

contextBridge.exposeInMainWorld('hub', api)
export type HubApi = typeof api

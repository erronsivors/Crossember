import { app, BrowserWindow, dialog, globalShortcut, ipcMain, powerMonitor, session, shell, clipboard, type IpcMainInvokeEvent } from 'electron'
import { basename, join } from 'node:path'
import { release } from 'node:os'
import { Logger } from './core/logger'
import { FEEDBACK_EMAIL, bundleText, composeUrls, sanitizeForm, writeBundle, type LogBundle, type SystemInfo } from './core/feedback'
import { Store } from './core/db'
import { Secrets } from './core/secrets'
import { Hub } from './core/hub'
import { Settings, type AppSettings } from './core/settings'
import { OverlayServer } from './core/server'
import { ObsConnector } from './core/obs'
import { TwitchConnector } from './core/twitch'
import { ImageCache } from './core/imgcache'
import { FloatChat, FLOAT_HOTKEY } from './core/floatchat'
import { ChatRegistry } from './core/connector'
import { GoodGameConnector } from './core/goodgame'
import { KickConnector } from './core/kick'
import { VkConnector } from './core/vk'
import { YoutubeConnector } from './core/youtube'
import { AlertEngine, fill, setVarsSource } from './core/alerts'
import { Counters } from './core/counters'
import { Auction } from './core/auction'
import { Wheel } from './core/wheel'
import { Fundraiser, type GoalReached } from './core/goal'
import { Giveaway, type GiveawayWinner } from './core/giveaway'
import { Vote, type PollView } from './core/vote'
import { Points } from './core/points'
import { Bot, parseAmount } from './core/bot'
import { Bets, type BetView } from './core/bets'
import { Rewards } from './core/rewards'
import { Spotify } from './core/spotify'
import { Smtc } from './core/smtc'
import { Music } from './core/music'
import { Subathon } from './core/subathon'
import { Memealerts } from './core/memealerts'
import { Updater } from './core/updater'
import { exportAlert, findAlerts, importAlert, type FolderLibs } from './core/alertfolder'
import { packHas } from './core/alertpack'
import { readFile as readFileAsync } from 'node:fs/promises'
import { Analytics, CHAT_PLATFORMS, isAnalyticsPeriod, type ChatPlatform } from './core/analytics'
import { Profiles, type ProfilePart } from './core/profile'
import { KickAuth } from './core/kickauth'
import { StreamInfo, INFO_PLATFORMS, type InfoPlatform } from './core/streaminfo'
import { TemplateStore, sanitizeTemplate, sanitizeObs } from './core/templates'
import { RuleEngine } from './core/rules'
import { MediaLibrary } from './core/media'
import { WindowsTts } from './core/tts'
import { Silero } from './core/silero'
import { Stats } from './core/stats'
import { SoundLibrary } from './core/sounds'
import type { DonationConnector } from './core/donations/common'
import { DonationAlertsConnector } from './core/donations/donationalerts'
import { DonatePayConnector } from './core/donations/donatepay'
import { DonateXConnector } from './core/donations/donatex'
import { BoostyConnector } from './core/donations/boosty'
import { clearSite, isSiteId, openSite } from './core/sitewindow'
import type { StatsPeriod } from './core/settings'
import type { HubEvent, HubSnapshot, Platform } from './core/types'

// Один экземпляр приложения: второй запуск просто показывает окно.
const firstInstance = app.requestSingleInstanceLock()
if (!firstInstance) app.quit()

// Журнал на диске (только у первого экземпляра — второй сразу закрывается и метку запуска трогать не должен).
const logger: Logger | null = firstInstance ? new Logger(join(app.getPath('userData'), 'logs')) : null
const startedAt = Date.now()
if (logger) {
  logger.info('app', `Запуск Crossember ${app.getVersion()} · Electron ${process.versions.electron} · Windows ${release()} ${process.arch}`)
  logger.onCrash = () => pushUpdate()
  process.on('uncaughtException', (e) => logger.fatal('main', e))
  process.on('unhandledRejection', (e) => logger.error('main', `Необработанная ошибка: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  // Ошибки и предупреждения из консоли — тоже в журнал.
  for (const lvl of ['error', 'warn'] as const) {
    const orig = console[lvl].bind(console)
    console[lvl] = (...a: unknown[]) => {
      orig(...a)
      logger.write(lvl, 'console', a.map((x) => (x instanceof Error ? x.stack ?? x.message : typeof x === 'string' ? x : safeJson(x))).join(' '))
    }
  }
  app.on('child-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') logger.error('app', `Процесс ${d.type} завершился: ${d.reason} (код ${d.exitCode})`) })
}
function safeJson(x: unknown): string {
  try { return JSON.stringify(x) } catch { return String(x) }
}
let lastBundle: LogBundle | null = null
const sysInfo = (): SystemInfo => ({
  version: app.getVersion(), electron: process.versions.electron, os: `Windows ${release()}`, arch: process.arch,
  setupMode: settings?.get().setupMode ?? 'не выбран', uptimeMin: Math.round((Date.now() - startedAt) / 60000)
})
function collectLogs(): LogBundle {
  if (!logger) throw new Error('Журнал недоступен')
  lastBundle = writeBundle(app.getPath('downloads'), bundleText(sysInfo(), hub.connections(), logger))
  logger.info('feedback', `Собран файл логов ${lastBundle.name}`)
  return lastBundle
}

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
const resourcesDir = app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')

let win: BrowserWindow | null = null
let store: Store
let settings: Settings
let hub: Hub
let server: OverlayServer
let obs: ObsConnector
let twitch: TwitchConnector
let youtube: YoutubeConnector
let floatChat: FloatChat
const chats = new ChatRegistry()
let alerts: AlertEngine
let stats: Stats
let sounds: SoundLibrary
let media: MediaLibrary
let tts: WindowsTts
let silero: Silero
let templates: TemplateStore
let rules: RuleEngine
let counters: Counters
let auction: Auction
let wheel: Wheel
let goal: Fundraiser
let giveaway: Giveaway
let vote: Vote
let points: Points
let bot: Bot
let bets: Bets
let rewards: Rewards
let spotify: Spotify
let music: Music
let subathon: Subathon
let memealerts: Memealerts
let updater: Updater
let analytics: Analytics
let profiles: Profiles
let kickAuth: KickAuth
let streamInfo: StreamInfo
let da: DonationAlertsConnector
let dp: DonatePayConnector
let dx: DonateXConnector
let boosty: BoostyConnector
let donations: DonationConnector[] = []

/** Права Twitch, которые нужны новым разделам (панель канала, награды, прогнозы, список зрителей). */
const PANEL_SCOPES = ['channel:manage:raids', 'moderator:manage:shoutouts', 'moderator:manage:chat_settings', 'moderator:manage:announcements', 'channel:edit:commercial', 'clips:edit', 'channel:manage:broadcast', 'channel:manage:redemptions', 'channel:manage:predictions', 'moderator:read:chatters', 'moderator:manage:banned_users']

/** Свои аккаунты (каналы на площадках и бот Twitch) — не зрители. */
function ownAccounts(): string[] {
  const bot = twitch.state().bot?.name
  return [...chats.states().map((p) => p.account), bot].filter((x): x is string => !!x)
}

function snapshot(): HubSnapshot {
  return {
    connections: hub.connections(),
    obs: obs.state,
    events: hub.recent(),
    chat: hub.recentChat(),
    pinned: hub.pinned,
    server: server.info(),
    obsConfig: obs.config(),
    settings: settings.get(),
    twitch: twitch.state(),
    youtube: youtube.state(),
    platforms: chats.states(),
    alerts: alerts.state(),
    donations: donations.map((d) => d.state()),
    sounds: sounds.list(),
    media: media.list(),
    templates: templates.all(),
    rules: rules.state(),
    counters: counters.list(),
    profile: profiles.state(),
    streamInfo: streamInfo.state(),
    kickAuth: kickAuth.state(),
    auction: auction.state(),
    wheel: wheel.state(),
    goal: goal.state(),
    giveaway: giveaway.state(),
    vote: vote.state(),
    points: points.state(),
    bot: bot.state(),
    bets: bets.state(),
    rewards: rewards.state(),
    music: music.state(),
    subathon: subathon.state(),
    memealerts: memealerts.state(),
    update: updater.get(),
    twitchScopes: Object.fromEntries(PANEL_SCOPES.map((sc) => [sc, twitch.access(sc)])),
    feedback: { email: FEEDBACK_EMAIL, crash: logger?.crash() ?? null },
    alertOverlays: server ? server.openCount('alert') : 0,
    float: { open: floatChat?.isOpen ?? false, editing: floatChat?.isEditing ?? false, hotkey: FLOAT_HOTKEY.replace('CommandOrControl', 'Ctrl') }
  }
}

let pushTimer: NodeJS.Timeout | null = null
/** Отправить интерфейсу свежий снимок (не чаще 10 раз в секунду). */
function pushUpdate(): void {
  if (pushTimer) return
  pushTimer = setTimeout(() => {
    pushTimer = null
    win?.webContents.send('hub:update', snapshot())
  }, 100)
}

/** IPC принимаем только от главного фрейма нашего окна. */
function trusted(e: IpcMainInvokeEvent): boolean {
  return !!win && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame
}

function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return fn(...args)
  })
}

const str = (v: unknown, max = 500): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error('bad args')
  return v
}
const role = (v: unknown): 'broadcaster' | 'bot' => (v === 'bot' ? 'bot' : 'broadcaster')

/** Тестовые события: кнопки «Проверка», тест правил и шаблонов. */
const SAMPLES: Record<string, Omit<HubEvent, 'id' | 'ts'>> = {
  donation: { platform: 'donationalerts', type: 'donation', user: 'Тестовый зритель', amount: 500, currency: 'RUB', amountRub: 500, text: 'Привет со стрима! 🔥', test: true },
  sub: { platform: 'twitch', type: 'sub', user: 'night_raven', text: '3 мес. вместе', test: true },
  follow: { platform: 'twitch', type: 'follow', user: 'pixel_fox', test: true },
  raid: { platform: 'twitch', type: 'raid', user: 'kostya_play', amount: 42, test: true },
  bigdonation: { platform: 'donatex', type: 'donation', user: 'Щедрый гость', amount: 5000, currency: 'RUB', amountRub: 5000, text: 'Это на новый микрофон!', test: true },
  gift: { platform: 'twitch', type: 'gift', user: 'santa_claws', amount: 5, test: true },
  bits: { platform: 'twitch', type: 'bits', user: 'bit_master', amount: 300, text: 'Держи биты!', test: true },
  reward: { platform: 'twitch', type: 'reward', user: 'lucky_cat', text: 'Спой песню', test: true },
  goal_stage: { platform: 'hub', type: 'system', user: 'Играю в хоррор', amount: 5000, currency: 'RUB', amountRub: 5000, text: 'Собрано 5 000 ₽ из 10 000 ₽', test: true },
  goal_done: { platform: 'hub', type: 'system', user: 'Новая камера', amount: 10000, currency: 'RUB', amountRub: 10000, text: 'Собрано 10 000 ₽ из 10 000 ₽', test: true },
  boosty: { platform: 'boosty', type: 'sub', user: 'Верный подписчик', amount: 300, currency: 'RUB', text: 'Уровень «Костёр»', test: true },
  message: { platform: 'twitch', type: 'message', user: 'test_viewer', userId: 'test', text: 'Тестовое сообщение: всем привет у костра! 🔥', parts: [{ t: 'text', v: 'Тестовое сообщение: всем привет у костра! 🔥' }], color: '#ffb27a', test: true }
}
/** Тестовое событие без отправки в ленту (для проверки правила или шаблона). */
const sampleEvent = (kind: unknown): HubEvent => ({ ...(SAMPLES[String(kind)] ?? SAMPLES.donation), id: `test-${Date.now()}`, ts: Date.now() })

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f0b0a',
    title: 'Crossember',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  // Интерфейс упал — в журнал, плашка и перезагрузка (не больше трёх раз подряд).
  let reloads = 0
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return
    logger?.fatal('interface', new Error(`Интерфейс аварийно закрылся: ${d.reason} (код ${d.exitCode})`))
    if (reloads++ < 3) win?.webContents.reload()
  })
  win.on('session-end', () => logger?.close())
  win.webContents.on('unresponsive', () => logger?.warn('interface', 'Интерфейс не отвечает'))

  // Никаких переходов и новых окон внутри приложения; https-ссылки — во внешний браузер.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!(isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL!))) e.preventDefault()
  })

  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  // Запрет всех разрешений (камера, микрофон, уведомления…). CSP интерфейса вшит в index.html при сборке.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  store = new Store(join(app.getPath('userData'), 'data'))
  settings = new Settings(store)
  const secrets = new Secrets(store)
  hub = new Hub()
  hub.register('hub', 'Сервер Crossember')
  hub.on('log', (id: string, level: 'info' | 'warn' | 'error', text: string) => logger?.write(level, id, text))
  obs = new ObsConnector(hub, store, secrets)
  const images = new ImageCache(join(app.getPath('userData'), 'cache', 'img'))
  images.preconnect()
  twitch = new TwitchConnector(hub, settings, secrets, images)
  chats.add(twitch)
  youtube = new YoutubeConnector(hub, settings, secrets, resourcesDir)
  chats.add(youtube)
  youtube.onChange = pushUpdate
  const goodgame = new GoodGameConnector(hub, settings, images, join(app.getPath('userData'), 'cache'))
  const kick = new KickConnector(hub, settings, images)
  kickAuth = new KickAuth(hub, secrets, resourcesDir)
  kickAuth.onChange = pushUpdate
  streamInfo = new StreamInfo(store, settings, twitch, youtube, kickAuth)
  streamInfo.on('change', pushUpdate)
  const vk = new VkConnector(hub, settings, images)
  chats.add(goodgame)
  chats.add(kick)
  chats.add(vk)
  goodgame.onChange = pushUpdate
  kick.onChange = pushUpdate
  vk.onChange = pushUpdate
  da = new DonationAlertsConnector(hub, settings, secrets, store)
  dp = new DonatePayConnector(hub, secrets, store)
  dx = new DonateXConnector(hub, settings, secrets, store)
  boosty = new BoostyConnector(hub, settings, secrets, store)
  donations = [da, dp, dx, boosty]
  for (const d of donations) d.onChange = pushUpdate
  silero = new Silero(app.getPath('userData'), resourcesDir, hub)
  // Модель Silero грузится ~10 с — заранее, если голос по умолчанию из Silero.
  setTimeout(() => { if (settings.get().tts.voice.startsWith('silero:')) silero.warm() }, 5000)
  tts = new WindowsTts(app.getPath('userData'), hub, () => { const t = settings.get().tts; return { chatterboxPort: t.chatterboxPort, chatterboxEmotion: t.chatterboxEmotion / 100 } }, silero)
  media = new MediaLibrary(app.getPath('userData'), store)
  templates = new TemplateStore(store)
  templates.onChange = pushUpdate
  const runObs = (a: Parameters<ObsConnector['run']>[0], e: HubEvent): Promise<void> => obs.run(a, (s) => fill(s, e))
  alerts = new AlertEngine(hub, settings, tts, runObs)
  alerts.on('change', pushUpdate)
  counters = new Counters(store)
  counters.on('change', pushUpdate)
  setVarsSource(() => counters.vars())
  auction = new Auction(store, settings, hub)
  auction.on('change', pushUpdate)
  wheel = new Wheel(store, settings)
  wheel.on('change', pushUpdate)
  // Колесо крутили по лотам аукциона — победитель колеса становится победителем аукциона.
  wheel.on('winner', (it: { lotId?: string }) => { if (it.lotId) auction.setWinner(it.lotId) })
  goal = new Fundraiser(store, hub)
  goal.on('change', pushUpdate)
  giveaway = new Giveaway(store, settings, hub)
  giveaway.on('change', pushUpdate)
  // Розыгрыш: объявления в чат на всех площадках, где можно писать.
  const announce = (tpl: string, vars: Record<string, string>): void => {
    const cfg = settings.get().giveaway
    if (!cfg.announce || !tpl.trim()) return
    const text = tpl.replace(/\{(приз|слово|победители)\}/g, (_, k: string) => vars[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, 450)
    const targets = chats.states().filter((p) => p.canSend).map((p) => p.id)
    if (!targets.length) return
    chats.send(text, targets, 'broadcaster').catch((e: Error) => hub.log('hub', 'warn', `Розыгрыш: не удалось написать в чат — ${e.message}`))
  }
  giveaway.on('opened', (prize: string) => {
    const cfg = settings.get().giveaway
    announce(cfg.startText, { приз: prize || 'розыгрыш', слово: cfg.keyword, победители: '' })
  })
  giveaway.on('drawn', (list: GiveawayWinner[]) => {
    const cfg = settings.get().giveaway
    const st = giveaway.state()
    announce(cfg.winText, { приз: st.prize || 'розыгрыш', слово: cfg.keyword, победители: list.map((w) => w.user).join(', ') })
  })
  vote = new Vote(store, settings, hub, () => obs.state.streaming || chats.states().some((p) => p.live))
  vote.on('change', pushUpdate)
  vote.setTwitch({
    available: () => twitch.pollAccess(),
    create: (title, choices, sec, points) => twitch.createPoll(title, choices, sec, points),
    end: (id) => twitch.endPoll(id)
  })
  twitch.onPoll = (e) => vote.twitchEvent(e)
  // Голосование: старт и итог — в чат на всех площадках, где можно писать (если включено).
  const voteSay = (tpl: string, p: PollView): void => {
    const cfg = settings.get().vote
    if (!cfg.announce || !tpl.trim()) return
    const list = p.options.slice(0, 10).map((o) => `${o.num}) ${o.name}`).join(' ')
    const r = p.result
    const votes = r ? `${r.votes.toLocaleString('ru-RU')} из ${p.total.toLocaleString('ru-RU')}` : ''
    const text = tpl.replace(/\{(вопрос|варианты|победитель|голоса)\}/g, (_, k: string) => ({ вопрос: p.title || 'голосование', варианты: list, победитель: r?.name ?? '', голоса: votes } as Record<string, string>)[k] ?? '')
      .replace(/\s+/g, ' ').trim().slice(0, 450)
    const targets = chats.states().filter((x) => x.canSend).map((x) => x.id)
    if (!text || !targets.length) return
    chats.send(text, targets, 'broadcaster').catch((e: Error) => hub.log('hub', 'warn', `Голосование: не удалось написать в чат — ${e.message}`))
  }
  // Родное голосование Twitch Twitch объявляет сам — пишем только о своём.
  vote.on('started', (p: PollView) => { if (p.source === 'own') voteSay(settings.get().vote.startText, p) })
  vote.on('finished', (p: PollView) => voteSay(settings.get().vote.winText, p))
  // ---------- Очки зрителей, бот, ставки, награды, музыка, сабатон, Memealerts ----------
  const liveNow = (): boolean => obs.state.streaming || chats.states().some((p) => p.live)
  const autoAs = (): 'broadcaster' | 'bot' => settings.get().twitch.autoSendAs
  /** Ответ бота на той площадке, откуда пришла команда. */
  const replyTo = (p: Platform, text: string): void => {
    if (!text || !chats.get(p)?.chatState().canSend) return
    chats.send(text.slice(0, 450), [p], autoAs()).catch((e: Error) => hub.log('hub', 'warn', `Бот: не удалось ответить — ${e.message}`))
  }
  /** Сообщение во все чаты, где можно писать. */
  const sendAll = (text: string): void => {
    const targets = chats.states().filter((x) => x.canSend).map((x) => x.id)
    if (!text || !targets.length) return
    chats.send(text.slice(0, 450), targets, autoAs()).catch((e: Error) => hub.log('hub', 'warn', `Не удалось написать в чат — ${e.message}`))
  }
  points = new Points(store, settings, hub, liveNow, ownAccounts)
  points.on('change', pushUpdate)
  points.lurkers = () => twitch.chatters()
  vote.spendPoints = (e, raw, step, reason) => {
    const v = points.ensure(e.platform, e.userId, e.user)
    const n = parseAmount(raw, v.balance)
    const amount = n ? Math.floor(n / step) * step : 0
    return amount > 0 && points.spend(v.key, amount, reason) ? amount : 0
  }
  bets = new Bets(store, settings, hub, points)
  bets.on('change', pushUpdate)
  bets.setTwitch({
    access: () => twitch.access('channel:manage:predictions'),
    create: (title, outcomes, sec) => twitch.createPrediction(title, outcomes, sec),
    end: (id, st, w) => twitch.endPrediction(id, st, w)
  })
  twitch.onPrediction = (e) => bets.twitchEvent(e)
  const betSay = (tpl: string, b: BetView): void => {
    const cfg = settings.get().bets
    if (!cfg.announce || !tpl.trim() || b.source !== 'own') return
    const win = b.outcomes.find((o) => o.id === b.winner)
    const text = tpl.replace(/\{(вопрос|исходы|команда|банк|исход|победители)\}/g, (_, k: string) => ({
      вопрос: b.title, исходы: b.outcomes.map((o) => `${o.num}) ${o.name}`).join(' '), команда: cfg.cmd, банк: `${b.total.toLocaleString('ru-RU')} ${settings.get().points.name}`,
      исход: win?.name ?? '', победители: b.payouts.slice(0, 5).map((x) => `${x.name} +${x.won.toLocaleString('ru-RU')}`).join(', ') || 'никто не угадал'
    } as Record<string, string>)[k] ?? '')
    sendAll(text.replace(/\s+/g, ' ').trim())
  }
  bets.on('started', (b: BetView) => betSay(settings.get().bets.startText, b))
  bets.on('locked', (b: BetView) => betSay(settings.get().bets.lockText, b))
  bets.on('resolved', (b: BetView) => betSay(settings.get().bets.winText, b))
  bets.on('reject', (e: HubEvent, err: string) => replyTo(e.platform, `@${e.user}, ${err}`))
  spotify = new Spotify(hub, secrets, () => settings.get().music.spotifyClientId)
  spotify.onChange = pushUpdate
  music = new Music(settings, hub, points, spotify, new Smtc())
  music.reply = replyTo
  music.on('change', pushUpdate)
  subathon = new Subathon(store, settings, hub)
  subathon.on('change', pushUpdate)
  memealerts = new Memealerts(hub, secrets)
  memealerts.onChange = pushUpdate
  updater = new Updater(hub, () => settings.get().updates.check)
  updater.onChange = pushUpdate
  updater.start()
  rewards = new Rewards(store, settings, hub)
  rewards.on('change', pushUpdate)
  rewards.setApi({
    access: () => twitch.access('channel:manage:redemptions'),
    list: (own) => twitch.listRewards(own),
    create: (r) => twitch.createReward(r),
    update: (id, r) => twitch.updateReward(id, r),
    remove: (id) => twitch.deleteReward(id),
    setStatus: (rid, ids, st) => twitch.setRedemptions(rid, ids, st)
  })
  twitch.onRedemptionUpdate = (id, st) => rewards.onTwitchUpdate(id, st)
  rewards.run = async (action, meta, e, input) => {
    switch (action) {
      case 'track': return (await music.request({ user: e.user, platform: e.platform }, input, 'reward')).error
      case 'points': {
        if (!settings.get().points.enabled) return 'Очки зрителей выключены'
        const v = points.ensure(e.platform, e.userId, e.user)
        points.add(v.key, meta.amount, `награда «${e.reward ?? ''}»`)
        return ''
      }
      case 'subathon': return subathon.add(meta.amount, e.user, e.platform, `награда «${e.reward ?? ''}»`) > 0 ? '' : 'Сабатон не запущен'
      case 'memecoins': {
        try { await memealerts.giveByName(e.user, meta.amount); return '' } catch (x) { return (x as Error).message }
      }
      default: return ''
    }
  }
  rewards.on('failed', (r: { user: string; own: boolean }, err: string) =>
    replyTo('twitch', `@${r.user}, не получилось: ${err}${r.own && settings.get().rewards.refundOnFail ? ' — баллы вернул' : ''}`))
  bot = new Bot(settings, hub, points)
  bot.on('change', pushUpdate)
  const twitchInfo = async (title: string | null, game: string | null): Promise<string> => {
    try {
      const cur = await twitch.channelInfo()
      const g = await twitch.setChannelInfo(title ?? cur.title, game ?? cur.game)
      return title !== null ? `Название: ${title}` : `Категория: ${g || game}`
    } catch (e) {
      return (e as Error).message
    }
  }
  bot.deps = {
    reply: replyTo,
    sendAll,
    isLive: liveNow,
    uptimeMs: () => (obs.state.streaming && obs.state.streamStartedAt ? Date.now() - obs.state.streamStartedAt : null),
    botName: () => twitch.state().bot?.name ?? null,
    skipAlert: () => alerts.skip(),
    pauseAlerts: (v) => alerts.setPaused(v),
    skipTrack: () => music.skip(),
    betLock: () => { void bets.lock(); return 'Ставки закрыты' },
    betWin: (n) => { void bets.resolve(n).then((t) => sendAll(t)); return '' },
    betCancel: () => { void bets.cancel(); return 'Ставки отменены, очки возвращены' },
    setTitle: (t) => twitchInfo(t.slice(0, 140), null),
    setGame: (g) => twitchInfo(null, g.slice(0, 100))
  }
  rules = new RuleEngine(hub, store, settings, templates, {
    play: (plan, e, force) => alerts.play(plan, e, force),
    obs: runObs,
    isLive: () => obs.state.streaming || !!twitch?.live || !!youtube?.live
  }, counters)
  rules.on('change', () => { syncHotkeys(); pushUpdate() })
  obs.onStream = (live) => rules.fireService(live ? 'stream_start' : 'stream_end')
  // Сбор средств: этап или цель достигнуты — повод для правил (алерт, звук, озвучка).
  goal.on('reached', (r: GoalReached) => {
    const rub = (n: number): string => `${Math.round(n).toLocaleString('ru-RU')} ₽`
    rules.fireGoal(r.kind === 'goal' ? 'goal_done' : 'goal_stage', r.name, r.collected, `Собрано ${rub(r.collected)} из ${rub(r.target)}`)
  })
  points.on('first', (_v: unknown, e: HubEvent) => rules.fireViewer('first_message', e))
  points.on('new', (_v: unknown, e: HubEvent) => rules.fireViewer('new_viewer', e))
  music.on('request', (r: { user: string; platform: Platform; title: string }) =>
    rules.fireViewer('song_request', { id: '', ts: Date.now(), platform: r.platform, type: 'message', user: r.user, text: r.title }))
  giveaway.on('drawn', (list: GiveawayWinner[]) => {
    for (const w of list) rules.fireViewer('giveaway_win', { id: '', ts: Date.now(), platform: w.platform, type: 'message', user: w.user, text: giveaway.state().prize })
  })
  bets.on('started', (b: BetView) => rules.fireInfo('bet_start', b.title, b.outcomes.map((o) => `${o.num}) ${o.name}`).join(' ')))
  bets.on('resolved', (b: BetView) => rules.fireInfo('bet_end', b.title, `Итог: ${b.outcomes.find((o) => o.id === b.winner)?.name ?? ''}`, b.total))
  vote.on('finished', (p: PollView) => { if (p.result) rules.fireInfo('vote_end', p.title || 'Голосование', `Победил: ${p.result.name}`, p.result.votes) })
  subathon.on('added', (a: { user: string; sec: number; reason: string }) => { if (a.sec > 0) rules.fireInfo('subathon_add', a.user, a.reason, a.sec) })
  subathon.on('ended', () => rules.fireInfo('subathon_end', 'Сабатон', 'Время вышло'))
  profiles = new Profiles(app.getPath('userData'), store, settings, rules, templates, counters)
  syncHotkeys()
  stats = new Stats(store, () => (obs.state.streaming ? obs.state.streamStartedAt : null))
  // Аналитика: эфир идёт, если OBS в эфире или площадка сообщает «в эфире»; свои аккаунты не считаются.
  analytics = new Analytics(store, settings, () => {
    const ps = chats.states()
    const viewers: Partial<Record<ChatPlatform, number>> = {}
    for (const p of ps) if (p.live && p.viewers !== null && (CHAT_PLATFORMS as readonly string[]).includes(p.id)) viewers[p.id as ChatPlatform] = p.viewers
    return {
      live: obs.state.streaming || ps.some((p) => p.live),
      startedAt: obs.state.streaming ? obs.state.streamStartedAt : null,
      viewers,
      own: ownAccounts()
    }
  })
  sounds = new SoundLibrary(app.getPath('userData'), store)
  hub.seed(store.recentEvents(100))
  hub.known = (id) => store.hasEvent(id)
  if (!secrets.available()) hub.log('hub', 'error', 'Шифрование Windows недоступно — токены сохранять нельзя')

  for (const ev of ['status', 'delete', 'pinned', 'log']) hub.on(ev, pushUpdate)
  hub.on('event', (e: HubEvent) => {
    // Сообщения чата на диск не пишем (приватность); события — с пометкой test, статистика тестовые не считает.
    if (e.type !== 'message') store.addEvent(e)
    // Для аналитики — только ник и +1 к счётчику, без текста (если включено в «Аналитике»).
    else analytics.onEvent(e)
    pushUpdate()
  })

  server = new OverlayServer(hub, store, settings, images, resourcesDir, app.getAppPath(), {
    send: (text) => chats.send(text, chats.states().filter((p) => p.canSend).map((p) => p.id), 'broadcaster'),
    pin: (id) => hub.togglePin(id),
    // Кнопки дока (OBS и второе устройство): те же действия, что в разделах приложения, — только этот список.
    dock: {
      'alerts.pause': (v) => alerts.setPaused(v === true),
      'alerts.skip': () => alerts.skip(),
      'alerts.stopAll': () => alerts.stopAll(),
      'alerts.remove': (id) => alerts.remove(str(id, 100)),
      test: (kind) => {
        const x = SAMPLES[String(kind)]
        if (x) hub.push(x)
      },
      'auction.timer': (op, sec) => auction.timer(str(op, 10), sec),
      'auction.accepting': (v) => auction.setAccepting(v === true),
      'auction.finish': () => { auction.finish() },
      'goal.accepting': (v) => goal.setAccepting(v === true),
      'goal.extend': (min) => goal.extend(min),
      'goal.add': (rub) => { goal.addHand(rub, 'из дока') },
      'giveaway.start': () => giveaway.start('', settings.get().giveaway.defaultMin),
      'giveaway.extend': (min) => giveaway.extend(min),
      'giveaway.close': () => giveaway.close(false),
      'giveaway.draw': () => giveaway.draw(settings.get().giveaway.winners),
      'giveaway.reroll': (key) => giveaway.reroll(str(key, 100)),
      'vote.finish': (kind) => { vote.finish(kind === 'long' ? 'long' : 'quick') },
      'vote.close': (kind) => vote.close(kind === 'long' ? 'long' : 'quick'),
      'vote.timer': (op, sec) => vote.timer(str(op, 10), sec),
      'vote.show': () => vote.toggleShow(),
      'wheel.spin': () => { wheel.spin() },
      'rewards.done': (id) => rewards.fulfill(str(id, 100)),
      'rewards.refund': (id) => rewards.refund(str(id, 100)),
      'bets.lock': () => bets.lock(),
      'bets.resolve': (n) => bets.resolve(Number(n)),
      'bets.cancel': () => bets.cancel(),
      'music.toggle': () => music.control('toggle'),
      'music.next': () => music.control('next'),
      'subathon.pause': (v) => subathon.pause(v === true),
      'subathon.add': (sec) => { subathon.add(Number(sec)) },
      counter: (id, op) => counters.apply(str(id, 100), op === 'sub' ? 'sub' : 'add', 1)
    },
    sendMod: (text) => chats.send(text, chats.states().filter((p) => p.canSend).map((p) => p.id), twitch.state().bot ? 'bot' : 'broadcaster'),
    moderate: async (id, op) => {
      const m = hub.findMessage(id)
      if (!m) return
      if (m.test) { hub.deleteMessage(m.id); return }
      const c = chats.get(m.platform)
      if (op === 'delete') await c?.deleteMessage?.(m)
      else await c?.ban?.(m, op === 'timeout' ? 600 : 0)
    }
  }, { alerts, stats, sounds, media, tts, counters, auction, wheel, goal, giveaway, vote, bets, music, subathon, rewards, points, own: ownAccounts })
  obs.onChange = pushUpdate
  server.onClients = pushUpdate
  floatChat = new FloatChat(settings, hub, () => server.overlayUrl('float'))
  floatChat.onChange = pushUpdate
  twitch.onChange = pushUpdate

  let prev: AppSettings = settings.get()
  settings.onChange = (s) => {
    server.pushConfig()
    if (s.setupMode !== prev.setupMode || JSON.stringify(s.lan) !== JSON.stringify(prev.lan)) void server.applyLan().then(pushUpdate)
    floatChat.apply()
    if (s.goodgame.channel !== prev.goodgame.channel) void goodgame.restart()
    if (s.kick.channel !== prev.kick.channel) void kick.restart()
    if (s.youtube.customClientId !== prev.youtube.customClientId) void youtube.logout()
    if (s.vk.channel !== prev.vk.channel) void vk.restart()
    if (s.donationalerts.customClientId !== prev.donationalerts.customClientId) void da.logout()
    if (s.donatex.customClientId !== prev.donatex.customClientId && dx.state().method === 'oauth') void dx.logout()
    if (s.boosty.poll !== prev.boosty.poll) void boosty.restart()
    if (s.twitch.customClientId !== prev.twitch.customClientId || s.twitch.thirdPartyEmotes !== prev.twitch.thirdPartyEmotes) void twitch.restart()
    if (s.vote.hotkey !== prev.vote.hotkey) syncHotkeys()
    if (s.mod.web !== prev.mod.web || s.mod.enabled !== prev.mod.enabled) void server.applyLan().then(pushUpdate)
    if (s.music.spotifyClientId !== prev.music.spotifyClientId && prev.music.spotifyClientId) spotify.logout()
    prev = s
    pushUpdate()
  }

  // ---------- IPC: всё, что может интерфейс ----------
  handle('hub:snapshot', () => snapshot())
  handle('hub:settings', (patch) => settings.patch(patch))
  handle('hub:obsConfigure', (url, password) => obs.configure(str(url, 200).trim(), password === undefined ? undefined : str(password, 200)))
  handle('hub:obsReconnect', () => obs.reconnect())
  handle('hub:rotateKey', (which) => {
    server.rotate(which === 'remote' ? 'remote' : which === 'dock' ? 'dock' : which === 'mod' ? 'mod' : 'overlay')
    pushUpdate()
  })
  handle('hub:copy', (text) => clipboard.writeText(str(text, 2000)))
  // ---------- Журнал и обратная связь ----------
  let uiErrors = 0
  setInterval(() => { uiErrors = 0 }, 60_000)
  handle('hub:logError', (text) => { if (++uiErrors <= 20) logger?.error('interface', str(text, 1500)) })
  handle('hub:crashDismiss', () => { logger?.dismissCrash(); pushUpdate() })
  handle('hub:feedbackCollect', () => collectLogs())
  handle('hub:feedbackShowFile', () => { if (lastBundle) shell.showItemInFolder(lastBundle.path) })
  handle('hub:feedbackOpenFile', () => { if (lastBundle) void shell.openPath(lastBundle.path) })
  handle('hub:openLogsFolder', () => { if (logger) void shell.openPath(logger.dir) })
  handle('hub:feedbackSend', async (form, via, withLogs) => {
    const f = sanitizeForm(form)
    if (!f.text) throw new Error('Напишите, что случилось или что предложить')
    // Логи старше 10 минут собираем заново, чтобы в файл попало свежее.
    const bundle = withLogs === true ? (lastBundle && Date.now() - lastBundle.createdAt < 600_000 ? lastBundle : collectLogs()) : null
    const urls = composeUrls(f, sysInfo(), bundle)
    await shell.openExternal(via === 'mailto' ? urls.mailto : urls.gmail)
    if (bundle) shell.showItemInFolder(bundle.path)
    logger?.info('feedback', `Открыто письмо (${via === 'mailto' ? 'почтовая программа' : 'Gmail'}, ${f.kind}${bundle ? ', с логами' : ''})`)
    return bundle
  })
  handle('hub:openExternal', (url) => {
    const u = str(url, 300)
    if (/^https:\/\/(dev\.twitch\.tv|www\.twitch\.tv|dashboard\.twitch\.tv|clips\.twitch\.tv|developer\.spotify\.com|memealerts\.com|obsproject\.com|github\.com|console\.cloud\.google\.com|www\.donationalerts\.com|donatepay\.ru|donatex\.gg|boosty\.to)\//.test(u)) void shell.openExternal(u)
  })
  handle('hub:testEvent', (kind) => {
    const x = SAMPLES[String(kind)]
    if (x) hub.push(x)
  })
  // Ручной донат (наличные, перевод): как настоящий — лента, статистика, топы, правила; площадка «Вручную».
  handle('hub:manualDonation', (v) => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
    const user = str(o.user, 64).trim()
    const amount = typeof o.amount === 'number' && Number.isFinite(o.amount) ? Math.round(o.amount * 100) / 100 : 0
    const currency = ['RUB', 'USD', 'EUR', 'UAH', 'KZT', 'BYN'].includes(o.currency as string) ? (o.currency as string) : 'RUB'
    const rubRaw = typeof o.amountRub === 'number' && Number.isFinite(o.amountRub) ? Math.round(o.amountRub * 100) / 100 : 0
    if (!user) throw new Error('Укажите имя')
    if (!(amount > 0) || amount > 10_000_000) throw new Error('Сумма должна быть больше нуля')
    hub.push({
      platform: 'hub', type: 'donation', user, amount, currency, manual: true,
      text: str(o.text, 500).trim() || undefined,
      amountRub: currency === 'RUB' ? amount : rubRaw > 0 && rubRaw <= 100_000_000 ? rubRaw : undefined
    })
  })
  // ---------- Алерты, статистика, звуки ----------
  handle('hub:alertPause', (v) => alerts.setPaused(v === true))
  handle('hub:alertSkip', () => alerts.skip())
  handle('hub:alertStopAll', () => alerts.stopAll())
  handle('hub:alertRemove', (id) => alerts.remove(str(id, 100)))
  handle('hub:alertReplay', (id) => {
    const e = hub.recent().find((x) => x.id === str(id, 100))
    return e ? rules.replay(e) : false
  })
  // ---------- Правила ----------
  handle('hub:rulePut', (r) => rules.put(r))
  handle('hub:ruleRemove', (id) => rules.remove(str(id, 100)))
  handle('hub:ruleMove', (id, dir) => rules.move(str(id, 100), dir === -1 ? -1 : 1))
  handle('hub:ruleTest', (id, kind) => rules.test(str(id, 100), sampleEvent(kind)))
  handle('hub:rulesFlags', (p) => rules.setFlags((p && typeof p === 'object' ? p : {}) as { enabled?: unknown; dryRun?: unknown }))
  handle('hub:rulesClearLog', () => rules.clearLog())
  // ---------- Название и категория эфира ----------
  handle('hub:infoDraft', (v) => streamInfo.setDraft(v))
  handle('hub:infoApply', () => streamInfo.apply())
  handle('hub:infoSuggest', (q) => streamInfo.suggest(str(q, 100)))
  handle('hub:infoFromTwitch', () => streamInfo.loadFromTwitch())
  handle('hub:infoOpen', (p) => { if ((INFO_PLATFORMS as readonly unknown[]).includes(p)) return streamInfo.openManual(p as InfoPlatform) })
  handle('hub:kickLogin', () => kickAuth.login())
  handle('hub:kickCancel', () => kickAuth.cancelLogin())
  handle('hub:kickLogout', () => kickAuth.logout())
  // ---------- Профиль: сохранить в файл / загрузить ----------
  handle('hub:profileExport', async (withMedia) => {
    if (!win) return null
    const d = new Date()
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const r = await dialog.showSaveDialog(win, {
      title: 'Сохранить профиль Crossember',
      defaultPath: join(app.getPath('documents'), `Crossember-профиль-${stamp}.crossember`),
      filters: [{ name: 'Профиль Crossember', extensions: ['crossember'] }]
    })
    if (r.canceled || !r.filePath) return null
    return profiles.exportTo(r.filePath, withMedia !== false)
  })
  handle('hub:profilePick', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { title: 'Загрузить профиль Crossember', properties: ['openFile'], filters: [{ name: 'Профиль Crossember', extensions: ['crossember'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    return profiles.inspect(r.filePaths[0])
  })
  handle('hub:profileApply', async (parts) => {
    await profiles.apply((Array.isArray(parts) ? parts : []).filter((p): p is ProfilePart => typeof p === 'string'))
    pushUpdate()
  })
  handle('hub:profileCancel', () => profiles.cancel())
  handle('hub:profileUndo', async () => {
    await profiles.undo()
    pushUpdate()
  })
  // ---------- Счётчики ----------
  handle('hub:counterPut', (c) => counters.put(c))
  handle('hub:counterRemove', (id) => {
    counters.remove(str(id, 100))
    rules.forgetCounter(String(id))
  })
  handle('hub:counterApply', (id, op, n) => {
    const v = typeof n === 'number' && Number.isFinite(n) ? Math.abs(Math.round(n)) : 1
    return counters.apply(str(id, 100), op === 'sub' ? 'sub' : op === 'set' ? 'set' : 'add', v)
  })
  // ---------- Аукцион ----------
  handle('hub:aucLotAdd', (name) => auction.addLot(str(name, 200)))
  handle('hub:aucLotRename', (id, name) => auction.renameLot(str(id, 100), str(name, 200)))
  handle('hub:aucLotApprove', (id) => auction.approveLot(str(id, 100)))
  handle('hub:aucLotRemove', (id) => auction.removeLot(str(id, 100)))
  handle('hub:aucLotMerge', (from, into) => auction.mergeLots(str(from, 100), str(into, 100)))
  handle('hub:aucLotAddSum', (id, n) => auction.addToLot(str(id, 100), n))
  handle('hub:aucBetAssign', (bet, lot) => auction.assignBet(str(bet, 100), str(lot, 100)))
  handle('hub:aucBetNewLot', (bet, name) => auction.betToNewLot(str(bet, 100), typeof name === 'string' ? str(name, 200) : undefined))
  handle('hub:aucBetReject', (bet) => auction.rejectBet(str(bet, 100)))
  handle('hub:aucBetReopen', (bet) => auction.reopenBet(str(bet, 100)))
  handle('hub:aucManualBet', (v) => auction.manualBet(v))
  handle('hub:aucTimer', (op, sec) => auction.timer(str(op, 10), sec))
  handle('hub:aucAccepting', (v) => auction.setAccepting(v === true))
  handle('hub:aucFinish', () => auction.finish())
  handle('hub:aucReset', (keepLots) => auction.reset(keepLots === true))
  handle('hub:aucClearArchive', () => auction.clearArchive())
  // ---------- Голосование ----------
  const vkind = (k: unknown): 'quick' | 'long' => (k === 'long' ? 'long' : 'quick')
  handle('hub:voteStart', (v) => vote.start(v))
  handle('hub:voteFinish', (k) => vote.finish(vkind(k)))
  handle('hub:voteClose', (k) => vote.close(vkind(k)))
  handle('hub:voteOpen', (k, v) => vote.setOpen(vkind(k), v === true))
  handle('hub:voteTimer', (op, sec) => vote.timer(str(op, 10), sec))
  handle('hub:voteTitle', (k, t) => vote.setTitle(vkind(k), str(t, 200)))
  handle('hub:voteSuggest', (k, v) => vote.setSuggest(vkind(k), v === true))
  handle('hub:voteOptAdd', (k, name) => vote.addOption(vkind(k), str(name, 200)))
  handle('hub:voteOptRename', (k, id, name) => vote.renameOption(vkind(k), str(id, 100), str(name, 200)))
  handle('hub:voteOptRemove', (k, id) => vote.removeOption(vkind(k), str(id, 100)))
  handle('hub:voteOptVotes', (k, id, n) => vote.addVotes(vkind(k), str(id, 100), n))
  handle('hub:voteApprove', (k, id, name, into) => vote.approve(vkind(k), str(id, 100), typeof name === 'string' ? str(name, 200) : undefined, typeof into === 'string' ? str(into, 100) : undefined))
  handle('hub:voteReject', (k, id) => vote.reject(vkind(k), str(id, 100)))
  handle('hub:voteShow', (v) => (v === false ? vote.hide() : vote.show()))
  handle('hub:voteClearArchive', () => vote.clearArchive())
  // ---------- Очки зрителей ----------
  handle('hub:pointsSearch', (q) => points.search(typeof q === 'string' ? str(q, 64) : '', 100))
  handle('hub:pointsAdjust', (name, platform, n) => points.adjustByName(name, platform, n))
  handle('hub:pointsSet', (key, n) => points.setBalance(str(key, 120), n))
  handle('hub:pointsRemove', (key) => points.remove(str(key, 120)))
  handle('hub:pointsReset', () => points.resetAll())
  handle('hub:pointsClearLog', () => points.clearLog())
  // ---------- Бот ----------
  handle('hub:botTest', (text) => bot.test(str(text, 500)))
  handle('hub:botClearLog', () => bot.clearLog())
  // ---------- Ставки ----------
  handle('hub:betStart', (v) => bets.start(v))
  handle('hub:betLock', () => bets.lock())
  handle('hub:betResolve', (n) => bets.resolve(Number(n)))
  handle('hub:betCancel', () => bets.cancel())
  handle('hub:betExtend', (sec) => bets.extend(sec))
  handle('hub:betClose', () => bets.close())
  handle('hub:betManual', (name, platform, num, amount) => bets.manual(name, platform, num, amount))
  handle('hub:betClearArchive', () => bets.clearArchive())
  // ---------- Награды за баллы ----------
  handle('hub:rewardsRefresh', () => rewards.refresh())
  handle('hub:rewardCreate', (r, meta) => rewards.create(r, meta))
  handle('hub:rewardUpdate', (id, r) => rewards.update(str(id, 100), r))
  handle('hub:rewardRemove', (id) => rewards.remove(str(id, 100)))
  handle('hub:rewardMeta', (id, meta) => rewards.setMeta(str(id, 100), meta))
  handle('hub:rewardsPause', (v) => rewards.pauseAll(v === true))
  handle('hub:redeemDone', (id) => rewards.fulfill(str(id, 100)))
  handle('hub:redeemRefund', (id) => rewards.refund(str(id, 100)))
  handle('hub:redeemDoneAll', () => rewards.fulfillAll())
  handle('hub:redeemClearDone', () => rewards.clearDone())
  // ---------- Музыка ----------
  handle('hub:spotifyLogin', () => spotify.login())
  handle('hub:spotifyCancel', () => spotify.cancelLogin())
  handle('hub:spotifyLogout', () => spotify.logout())
  handle('hub:musicControl', (op) => music.control(op === 'next' ? 'next' : op === 'prev' ? 'prev' : 'toggle'))
  handle('hub:musicVolume', (n) => music.volume(Number(n)))
  handle('hub:musicSearch', (q) => music.search(str(q, 200)))
  handle('hub:musicRequest', async (q) => {
    const r = await music.request({ user: twitch.state().broadcaster?.name ?? 'Стример', platform: 'hub' }, str(q, 300), 'manual')
    if (r.error) throw new Error(r.error)
  })
  handle('hub:musicClearRequests', () => music.clearRequests())
  // ---------- Сабатон ----------
  handle('hub:subStart', (min) => subathon.start(min))
  handle('hub:subPause', (v) => subathon.pause(v === true))
  handle('hub:subStop', () => subathon.stop())
  handle('hub:subAdd', (sec) => subathon.add(Number(sec)))
  handle('hub:subHappy', (v) => subathon.setHappy(v === true))
  // ---------- Панель канала Twitch ----------
  handle('hub:twRaid', (login) => twitch.startRaid(str(login, 100)))
  handle('hub:twRaidCancel', () => twitch.cancelRaid())
  handle('hub:twShoutout', (login) => twitch.shoutout(str(login, 100)))
  handle('hub:twBan', (login, sec, reason) => twitch.banLogin(str(login, 100), typeof sec === 'number' ? sec : 0, typeof reason === 'string' ? str(reason, 300) : ''))
  handle('hub:twUnban', (login) => twitch.unbanLogin(str(login, 100)))
  handle('hub:twChatSettings', () => twitch.chatSettings())
  handle('hub:twSetChatSettings', (p) => twitch.setChatSettings((p && typeof p === 'object' ? p : {}) as Record<string, never>))
  handle('hub:twCommercial', (sec) => twitch.commercial(Number(sec)))
  handle('hub:twMarker', (d) => twitch.marker(typeof d === 'string' ? str(d, 140) : ''))
  handle('hub:twClip', () => twitch.clip())
  handle('hub:twAnnounce', (text, color) => twitch.announce(str(text, 500), (['blue', 'green', 'orange', 'purple'].includes(color as string) ? color : 'primary') as 'primary'))
  // ---------- Memealerts ----------
  handle('hub:memeLogin', () => memealerts.login())
  handle('hub:memeCancel', () => memealerts.cancelLogin())
  handle('hub:memeLogout', () => memealerts.logout())
  handle('hub:memeToken', (t) => memealerts.setToken(str(t, 4000)))
  handle('hub:memeSupporters', (q) => memealerts.supporters(typeof q === 'string' ? str(q, 60) : ''))
  handle('hub:memeGive', (name, n) => memealerts.giveByName(str(name, 64), Number(n)))
  // ---------- Обновления ----------
  handle('hub:updateCheck', () => updater.check())
  handle('hub:updateDownload', () => updater.download())
  handle('hub:updateLater', () => updater.later())
  handle('hub:updateInstall', () => updater.install())
  // ---------- Колесо ----------
  handle('hub:wheelSetItems', (list) => wheel.setItems(list))
  handle('hub:wheelLoadLots', () => wheel.loadLots(auction.state().lots))
  handle('hub:wheelSpin', () => { wheel.spin() })
  handle('hub:wheelRestart', () => wheel.restart())
  handle('hub:wheelClearHistory', () => wheel.clearHistory())
  // ---------- Сбор средств ----------
  handle('hub:goalStart', (v) => { goal.start(v) })
  handle('hub:goalEdit', (v) => goal.edit(v))
  handle('hub:goalFinish', () => goal.finish())
  handle('hub:goalAccepting', (v) => goal.setAccepting(v === true))
  handle('hub:goalDuration', (min) => goal.setDuration(min))
  handle('hub:goalExtend', (min) => goal.extend(min))
  handle('hub:goalAdd', (rub, note) => { goal.addHand(rub, typeof note === 'string' ? str(note, 300) : '') })
  handle('hub:goalToggleGift', (id) => goal.toggleGift(str(id, 100)))
  handle('hub:goalClearArchive', () => goal.clearArchive())
  // ---------- Розыгрыш ----------
  handle('hub:gwStart', (prize, min) => giveaway.start(typeof prize === 'string' ? str(prize, 200) : '', min))
  handle('hub:gwExtend', (min) => giveaway.extend(min))
  handle('hub:gwClose', () => giveaway.close(false))
  handle('hub:gwPrize', (prize) => giveaway.setPrize(str(prize, 200)))
  handle('hub:gwRemove', (key) => giveaway.removeEntry(str(key, 100)))
  handle('hub:gwFakes', (n) => giveaway.addFakes(n))
  handle('hub:gwDraw', (n) => giveaway.draw(n))
  handle('hub:gwReroll', (key) => giveaway.reroll(str(key, 100)))
  handle('hub:gwReset', () => giveaway.reset())
  handle('hub:gwClearArchive', () => giveaway.clearArchive())
  // ---------- Шаблоны алертов (конструктор) ----------
  handle('hub:templatePut', (t) => templates.put(t))
  handle('hub:templateRemove', (id) => {
    templates.remove(str(id, 100))
    rules.forgetTemplate(String(id))
  })
  handle('hub:templateDuplicate', (id) => templates.duplicate(str(id, 100)))
  const folderLibs = (): FolderLibs => ({
    mediaFile: (f) => join(app.getPath('userData'), 'media', f),
    soundFile: (f) => join(app.getPath('userData'), 'sounds', f),
    addMedia: (p) => media.add(p).id,
    addSound: (p) => sounds.add(p).id
  })
  handle('hub:templateExport', async (id) => {
    const t = templates.get(str(id, 100))
    if (!t || !win) return null
    const r = await dialog.showOpenDialog(win, { title: 'Куда сохранить алерт (будет создана папка с его именем)', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const out = exportAlert(t, r.filePaths[0], folderLibs())
    shell.showItemInFolder(join(out, 'alert.json'))
    return out
  })
  // Угловые сцены основного набора: resources/alertpack/<набор>/corner/scene.json (шесть положений).
  handle('hub:packCorner', async (id: unknown) => {
    const set = str(id, 70)
    if (!packHas(set)) throw new Error('Нет такого набора')
    return JSON.parse(await readFileAsync(join(resourcesDir, 'alertpack', set, 'corner', 'scene.json'), 'utf8')) as unknown
  })
  handle('hub:templateImport', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { title: 'Папка с алертом (или папка с несколькими алертами)', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const found = findAlerts(r.filePaths[0])
    if (!found.length) throw new Error('В папке нет alert.json — выберите папку, сохранённую кнопкой «В папку»')
    let ok = 0
    const bad: string[] = []
    for (const f of found) {
      try { templates.put(importAlert(f, folderLibs())); ok++ } catch (e) { bad.push(`${basename(f)}: ${(e as Error).message}`) }
    }
    pushUpdate()
    return { ok, bad }
  })
  handle('hub:templateTest', (t, kind) => alerts.enqueue(sanitizeTemplate(t), sampleEvent(kind), true))
  handle('hub:mediaAdd', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { title: 'Картинка или видео для алерта', properties: ['openFile'], filters: [{ name: 'Картинки и видео', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'webm', 'mp4'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const info = media.add(r.filePaths[0])
    pushUpdate()
    return info
  })
  handle('hub:mediaRemove', (id) => {
    const used = templates.usedMedia()
    if (used.has(str(id, 100))) throw new Error('Файл используется в шаблоне — сначала уберите его из слоёв')
    media.remove(String(id))
    pushUpdate()
  })
  // ---------- OBS-действия и озвучка ----------
  handle('hub:openOverlay', (id) => {
    const o = server.info().overlays.find((x) => x.id === id)
    if (o && /^http:\/\/127\.0\.0\.1:\d+\/o\/[\w-]+\?k=[\w-]+$/.test(o.url)) void shell.openExternal(o.url)
  })
  handle('hub:obsCatalog', () => obs.catalog())
  handle('hub:obsTest', (a) => obs.run(sanitizeObs(a), (s) => fill(s, sampleEvent('donation'))))
  handle('hub:ttsVoices', () => tts.voices())
  handle('hub:sileroStatus', () => silero.get())
  handle('hub:sileroInstall', () => { void silero.install(); return silero.get() })
  handle('hub:sileroRemove', () => silero.remove())
  handle('hub:ttsTest', async (text) => {
    const s = settings.get().tts
    const r = await tts.synth(str(text, 500), s.voice, s.rate)
    return `/t/${r.file}`
  })
  handle('hub:stats', (period) => {
    const p = (['stream', 'today', 'week', 'month', 'all'] as StatsPeriod[]).includes(period as StatsPeriod) ? (period as StatsPeriod) : 'stream'
    return stats.snapshot(p)
  })
  handle('hub:chatTest', () => server.testChat())
  // ---------- Аналитика (только локально) ----------
  handle('hub:analytics', (period) => analytics.report(isAnalyticsPeriod(period) ? period : 'month'))
  handle('hub:analyticsStream', (id) => analytics.stream(str(id, 100)))
  handle('hub:analyticsMerge', (refs) => analytics.merge(refs))
  handle('hub:analyticsUnmerge', (ref) => analytics.unmerge(ref))
  handle('hub:analyticsDismiss', (key) => analytics.dismiss(key))
  handle('hub:analyticsForget', (id) => analytics.forget(id))
  handle('hub:analyticsClear', () => analytics.clear())
  handle('hub:soundAdd', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { title: 'Звук для алерта', properties: ['openFile'], filters: [{ name: 'Звук', extensions: ['mp3', 'wav', 'ogg'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const info = sounds.add(r.filePaths[0])
    pushUpdate()
    return info
  })
  handle('hub:soundRemove', (id) => {
    sounds.remove(str(id, 100))
    pushUpdate()
  })
  // ---------- Сервисы донатов ----------
  handle('hub:daLogin', () => da.login())
  handle('hub:daCancel', () => da.cancelLogin())
  handle('hub:dpKey', (key) => dp.setKey(str(key, 300)))
  handle('hub:dxLogin', () => dx.login())
  handle('hub:dxCancel', () => dx.cancelLogin())
  handle('hub:dxToken', (t) => dx.setToken(str(t, 4000)))
  handle('hub:boostyLogin', () => boosty.login())
  handle('hub:boostyCancel', () => boosty.cancelLogin())
  handle('hub:openSite', (id) => { if (isSiteId(id)) openSite(id) })
  handle('hub:clearSite', (id) => (isSiteId(id) ? clearSite(id) : undefined))
  handle('hub:donationLogout', (p) => donations.find((d) => d.id === p)?.logout())
  handle('hub:floatEdit', () => floatChat.toggleEdit())
  handle('hub:floatReset', () => floatChat.reset())
  handle('hub:reconnect', (p) => {
    if (p === 'obs') return obs.reconnect()
    const d = donations.find((x) => x.id === p)
    if (d) return d.restart()
    return chats.get(p as Platform)?.restart()
  })
  handle('hub:twitchLogin', (r) => twitch.login(role(r)))
  handle('hub:twitchCancel', () => twitch.cancelLogin())
  handle('hub:twitchLogout', (r) => twitch.logout(role(r)))
  handle('hub:twitchRestart', () => twitch.restart())
  handle('hub:youtubeLogin', () => youtube.login())
  handle('hub:youtubeCancel', () => youtube.cancelLogin())
  handle('hub:youtubeLogout', () => youtube.logout())
  handle('hub:youtubeSecret', (v) => youtube.setCustomSecret(typeof v === 'string' ? str(v, 200) : null))
  handle('hub:chatSend', (text, as, targets) => {
    const list = Array.isArray(targets) ? (targets.filter((t) => typeof t === 'string') as Platform[]) : []
    return chats.send(str(text), list, role(as))
  })
  handle('hub:chatPin', (id) => hub.togglePin(id === null ? null : str(id, 100)))
  handle('hub:chatDelete', async (id) => {
    const m = hub.findMessage(str(id, 100))
    if (!m) return
    if (m.test) return hub.deleteMessage(m.id)
    await chats.get(m.platform)?.deleteMessage?.(m)
  })
  handle('hub:chatBan', async (id, seconds) => {
    const m = hub.findMessage(str(id, 100))
    const sec = typeof seconds === 'number' ? seconds : 0
    if (m && !m.test) await chats.get(m.platform)?.ban?.(m, sec)
  })

  createWindow()

  try {
    await server.start()
  } catch (e) {
    hub.setStatus('hub', 'error', `Сервер не запустился: ${(e as Error).message}`)
  }
  await obs.start()
  void chats.startAll()
  for (const d of donations) void d.start().catch(() => undefined)
  floatChat.apply()
  pushUpdate()
  // Список наград — когда Twitch успеет подключиться.
  setTimeout(() => { if (twitch.state().broadcaster) void rewards.refresh().catch(() => undefined) }, 8000)
})

app.on('window-all-closed', () => app.quit())
/** Горячие клавиши правил: занимаются глобально (работают, даже когда в фокусе игра). */
const ruleKeys = new Map<string, string>()
let ruleKeysSig = ''
function syncHotkeys(): void {
  const want = rules.hotkeys()
  const sig = JSON.stringify([want, settings.get().vote.hotkey])
  if (sig === ruleKeysSig) return
  ruleKeysSig = sig
  for (const accel of ruleKeys.keys()) globalShortcut.unregister(accel)
  ruleKeys.clear()
  const errors: Record<string, string> = {}
  const floatKey = FLOAT_HOTKEY.replace('CommandOrControl', 'Ctrl')
  for (const { id, accel } of want) {
    if (accel === floatKey) errors[id] = 'это сочетание занято плавающим чатом'
    else if (ruleKeys.has(accel)) errors[id] = 'это сочетание уже у другого правила'
    else if (globalShortcut.register(accel, () => rules.fireRule(id, 'hotkey'))) ruleKeys.set(accel, id)
    else errors[id] = 'это сочетание занято другой программой'
  }
  rules.setHotkeyErrors(errors)
  // Голосование: показать/спрятать долгое.
  const vh = settings.get().vote.hotkey
  if (voteKey) { globalShortcut.unregister(voteKey); voteKey = '' }
  let voteErr = ''
  if (vh) {
    if (vh === floatKey) voteErr = 'это сочетание занято плавающим чатом'
    else if (ruleKeys.has(vh)) voteErr = 'это сочетание уже у правила'
    else if (globalShortcut.register(vh, () => vote.toggleShow())) voteKey = vh
    else voteErr = 'это сочетание занято другой программой'
  }
  vote.setHotkeyError(voteErr)
}
let voteKey = ''

// Выключение Windows — это нормальный выход, не «неожиданное закрытие».
app.on('ready', () => powerMonitor.on('shutdown', () => logger?.close()))

app.on('before-quit', () => {
  logger?.info('app', 'Выход')
  updater?.dispose()
  logger?.close()
  for (const accel of ruleKeys.keys()) globalShortcut.unregister(accel)
  if (voteKey) globalShortcut.unregister(voteKey)
  rules?.dispose()
  auction?.stop()
  wheel?.stop()
  goal?.stop()
  giveaway?.stop()
  vote?.stop()
  points?.stop()
  bot?.stop()
  bets?.stop()
  rewards?.stop()
  music?.stop()
  subathon?.dispose()
  memealerts?.stop()
  analytics?.stop()
  kickAuth?.cancelLogin()
  floatChat?.close()
  chats.stopAll()
  for (const d of donations) d.stop()
  alerts?.dispose()
  tts?.dispose()
  silero?.dispose()
  void obs?.stop()
  void server?.stop()
  store?.close()
})

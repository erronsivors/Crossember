import { EventEmitter } from 'node:events'
import type { Hub } from './hub'
import type { Settings } from './settings'
import type { Points, Viewer } from './points'
import type { Access, BotCommand } from './extsettings'
import type { HubEvent, Platform, ViewerRole } from './types'

/**
 * Бот Crossember (замена RutonyChat): свои команды с ответами, сообщения по таймеру, команды очков
 * (баланс, топ, передать, рулетка, дуэль), аптайм, список команд и команды модераторов.
 * Отвечает на той площадке, откуда пришла команда; таймеры пишут во все чаты, где можно писать.
 */

export interface BotLogEntry {
  ts: number
  platform: Platform
  user: string
  cmd: string
  /** Что ответил бот или почему не ответил. */
  result: string
}

export interface BotState {
  log: BotLogEntry[]
  /** Когда каждый таймер писал последний раз. */
  timers: Record<string, number>
  /** Сколько раз использована каждая своя команда (для {count}). */
  uses: Record<string, number>
}

/** Действия, которые бот вызывает у других модулей (подключаются в index.ts). */
export interface BotDeps {
  reply: (platform: Platform, text: string) => void
  sendAll: (text: string) => void
  isLive: () => boolean
  uptimeMs: () => number | null
  /** Ник бота Twitch и свои аккаунты — их сообщения не считаются командами (кроме стримера). */
  botName: () => string | null
  skipAlert: () => void
  pauseAlerts: (v: boolean) => void
  skipTrack: () => Promise<string>
  betLock: () => string
  betWin: (num: number) => string
  betCancel: () => string
  setTitle: (t: string) => Promise<string>
  setGame: (g: string) => Promise<string>
}

const RANK: Record<ViewerRole | 'none', number> = { none: 0, sub: 1, vip: 2, mod: 3, broadcaster: 4 }
const NEED: Record<Access, number> = { all: 0, sub: 1, vip: 2, mod: 3 }
const LOG_LIMIT = 80
const ACCEPT = ['!принять', '!accept']

const fmt = (n: number): string => Math.round(n).toLocaleString('ru-RU')
const lower = (s: string): string => s.toLowerCase().replace(/^@/, '').trim()

export function fmtUptime(ms: number | null): string {
  if (ms === null || ms < 0) return 'эфир не идёт'
  const m = Math.floor(ms / 60_000)
  const h = Math.floor(m / 60)
  return h ? `${h} ч ${m % 60} мин` : `${m} мин`
}

/** Число из аргумента: «500», «1к», «1.5k», «все»/«all» — весь баланс. */
export function parseAmount(raw: string | undefined, balance: number): number | null {
  if (!raw) return null
  const t = raw.toLowerCase().replace(/\s/g, '').replace(',', '.')
  if (t === 'все' || t === 'всё' || t === 'all' || t === 'ва-банк' || t === 'вабанк') return balance
  const m = /^(\d+(?:\.\d+)?)(к|k|кк|m|м)?$/.exec(t)
  if (!m) return null
  const mult = m[2] === 'к' || m[2] === 'k' ? 1000 : m[2] ? 1_000_000 : 1
  const n = Math.floor(Number(m[1]) * mult)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Подстановка в ответ команды: {user} {target} {args} {points} {currency} {uptime} {random} {random:1-6} {count}. */
export function fillResponse(tpl: string, v: Record<string, string>): string {
  return tpl
    .replace(/\{random(?::(\d{1,9})-(\d{1,9}))?\}/g, (_, a?: string, b?: string) => {
      const lo = a ? Number(a) : 1
      const hi = b ? Number(b) : 100
      const [x, y] = lo <= hi ? [lo, hi] : [hi, lo]
      return String(x + Math.floor(Math.random() * (y - x + 1)))
    })
    .replace(/\{(user|target|args|points|currency|uptime|count|game|title)\}/g, (_, k: string) => v[k] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 450)
}

export class Bot extends EventEmitter {
  private log: BotLogEntry[] = []
  private lastUse = new Map<string, number>()
  private lastUserUse = new Map<string, number>()
  private uses: Record<string, number> = {}
  private timerLast: Record<string, number> = {}
  private msgCount = 0
  private timerMsgAt: Record<string, number> = {}
  private duels = new Map<string, { from: string; fromName: string; amount: number; expires: number; platform: Platform }>()
  private recentOut: string[] = []
  private tick: NodeJS.Timeout | null = null
  deps: BotDeps | null = null

  constructor(private settings: Settings, hub: Hub, private points: Points) {
    super()
    hub.on('event', (e: HubEvent) => { if (e.type === 'message') void this.onMessage(e) })
    this.tick = setInterval(() => this.onTick(), 20_000)
  }

  state(): BotState {
    return { log: this.log.slice(0, 50), timers: { ...this.timerLast }, uses: { ...this.uses } }
  }

  clearLog(): void {
    this.log = []
    this.emit('change')
  }

  private note(e: HubEvent, cmd: string, result: string): void {
    this.log.unshift({ ts: Date.now(), platform: e.platform, user: e.user, cmd: cmd.slice(0, 60), result: result.slice(0, 200) })
    if (this.log.length > LOG_LIMIT) this.log.length = LOG_LIMIT
    this.emit('change')
  }

  private say(e: HubEvent, text: string, cmd: string): void {
    if (!text) return
    this.recentOut.unshift(text)
    if (this.recentOut.length > 20) this.recentOut.length = 20
    this.deps?.reply(e.platform, text)
    this.note(e, cmd, text)
  }

  private rank(e: HubEvent, forMod = false): number {
    const r = RANK[e.role ?? 'none']
    if (forMod && e.role === 'vip' && this.settings.get().mod.vipAsMod) return RANK.mod
    return r
  }

  private viewer(e: HubEvent): Viewer {
    return this.points.ensure(e.platform, e.userId, e.user)
  }

  private cur(): string {
    return this.settings.get().points.name
  }

  /** Тестовое сообщение из интерфейса: как от стримера в Twitch (ответ показывается в журнале, в чат не уходит). */
  async test(text: string): Promise<string> {
    const before = this.log.length
    const saved = this.deps
    let out = ''
    if (saved) this.deps = { ...saved, reply: (_p, t) => { out = t } }
    try {
      await this.onMessage({ id: `bot-test-${Date.now()}`, ts: Date.now(), platform: 'twitch', type: 'message', user: 'Проверка', userId: 'bot-test', text, role: 'broadcaster' }, true)
    } finally {
      this.deps = saved
      this.points.remove('twitch:bot-test')
    }
    return out || (this.log.length > before ? this.log[0].result : 'Бот промолчал: такой команды нет или она выключена')
  }

  private async onMessage(e: HubEvent, testing = false): Promise<void> {
    if (e.test && !testing) return
    const text = (e.text ?? '').trim()
    if (!text || !this.deps) return
    const botName = this.deps.botName()
    if (botName && lower(e.user) === lower(botName)) return
    // Своё же сообщение бота, вернувшееся из чата (бот пишет от имени стримера).
    if (this.recentOut.includes(text)) return
    this.msgCount++
    const cfg = this.settings.get()
    if (!/^[!#.?$%&*+~]/.test(text)) return
    const [first, ...rest] = text.split(/\s+/)
    const cmd = first.toLowerCase()
    const args = rest
    try {
      if (cfg.mod.enabled && (await this.modCommand(e, cmd, args, text))) return
      if (!cfg.bot.enabled) return
      if (this.builtin(e, cmd, args)) return
      const c = cfg.bot.commands.find((x) => x.enabled && (x.trigger === cmd || x.aliases.includes(cmd)))
      if (c) this.custom(e, c, args)
    } catch (err) {
      this.note(e, cmd, `Ошибка: ${(err as Error).message}`)
    }
  }

  private custom(e: HubEvent, c: BotCommand, args: string[]): void {
    const now = Date.now()
    if (this.rank(e) < NEED[c.access]) return this.note(e, c.trigger, 'нет доступа')
    const isMod = this.rank(e) >= RANK.mod
    if (!isMod && now - (this.lastUse.get(c.id) ?? 0) < c.cooldownSec * 1000) return this.note(e, c.trigger, 'кулдаун')
    const uk = `${c.id}|${e.platform}:${lower(e.user)}`
    if (!isMod && now - (this.lastUserUse.get(uk) ?? 0) < c.userCooldownSec * 1000) return this.note(e, c.trigger, 'личный кулдаун')
    const v = this.viewer(e)
    if (c.cost > 0 && this.settings.get().points.enabled) {
      if (!this.points.spend(v.key, c.cost, c.trigger)) return this.say(e, `@${e.user}, нужно ${fmt(c.cost)} ${this.cur()} (у тебя ${fmt(v.balance)})`, c.trigger)
    }
    this.lastUse.set(c.id, now)
    this.lastUserUse.set(uk, now)
    this.uses[c.id] = (this.uses[c.id] ?? 0) + 1
    const target = args[0]?.replace(/^@/, '') || e.user
    const out = fillResponse(c.response, {
      user: e.user, target, args: args.join(' '), points: fmt(v.balance), currency: this.cur(),
      uptime: fmtUptime(this.deps!.uptimeMs()), count: String(this.uses[c.id])
    })
    this.say(e, out, c.trigger)
  }

  private builtin(e: HubEvent, cmd: string, args: string[]): boolean {
    const b = this.settings.get().bot
    const pts = this.settings.get().points.enabled
    const cur = this.cur()
    const is = (c: string): boolean => !!c && c === cmd
    if (is(b.uptimeCmd)) {
      this.say(e, `Эфир идёт ${fmtUptime(this.deps!.uptimeMs())}`, cmd)
      return true
    }
    if (is(b.listCmd)) {
      const list = this.settings.get().bot.commands.filter((c) => c.enabled && c.access === 'all').map((c) => c.trigger)
      const extra = pts ? [b.balanceCmd, b.topCmd, b.gambleCmd, b.duelCmd].filter(Boolean) : []
      this.say(e, `Команды: ${[...list, ...extra].join(' ').slice(0, 400) || 'пока нет'}`, cmd)
      return true
    }
    if (!pts) return false
    if (is(b.balanceCmd)) {
      const who = args[0] ? this.points.byName(args[0], e.platform) : this.viewer(e)
      if (!who) this.say(e, `@${e.user}, не знаю такого зрителя`, cmd)
      else this.say(e, `@${e.user}, у ${who.name === e.user ? 'тебя' : who.name} ${fmt(who.balance)} ${cur} (место ${this.points.rank(who.key)})`, cmd)
      return true
    }
    if (is(b.topCmd)) {
      const top = this.points.top(5)
      this.say(e, top.length ? `Топ по ${cur}: ${top.map((v, i) => `${i + 1}) ${v.name} — ${fmt(v.balance)}`).join(', ')}` : `Пока ни у кого нет ${cur}`, cmd)
      return true
    }
    if (is(b.giveCmd)) {
      const to = args[0] ? this.points.byName(args[0], e.platform) : null
      const me = this.viewer(e)
      const n = parseAmount(args[1], me.balance)
      if (!to || !n) this.say(e, `@${e.user}, так: ${b.giveCmd} @ник сумма`, cmd)
      else if (to.key === me.key) this.say(e, `@${e.user}, самому себе нельзя`, cmd)
      else if (!this.points.transfer(me.key, to.key, n)) this.say(e, `@${e.user}, не хватает ${cur} (у тебя ${fmt(me.balance)})`, cmd)
      else this.say(e, `${e.user} передаёт ${to.name} ${fmt(n)} ${cur}`, cmd)
      return true
    }
    if (is(b.gambleCmd)) {
      this.gamble(e, args, cmd)
      return true
    }
    if (is(b.duelCmd)) {
      this.duel(e, args, cmd)
      return true
    }
    if (b.duelCmd && ACCEPT.includes(cmd)) {
      this.accept(e, cmd)
      return true
    }
    return false
  }

  private gamble(e: HubEvent, args: string[], cmd: string): void {
    const b = this.settings.get().bot
    const me = this.viewer(e)
    const k = `gamble|${me.key}`
    const now = Date.now()
    const left = b.gambleCooldownSec * 1000 - (now - (this.lastUserUse.get(k) ?? 0))
    if (left > 0) return this.note(e, cmd, `кулдаун ${Math.ceil(left / 1000)} с`)
    const n = parseAmount(args[0], me.balance)
    if (!n) return this.say(e, `@${e.user}, так: ${cmd} сумма (от ${fmt(b.gambleMin)} до ${fmt(b.gambleMax)}) или ${cmd} все`, cmd)
    if (n < b.gambleMin || n > b.gambleMax) return this.say(e, `@${e.user}, ставка от ${fmt(b.gambleMin)} до ${fmt(b.gambleMax)}`, cmd)
    if (me.balance < n) return this.say(e, `@${e.user}, не хватает ${this.cur()} (у тебя ${fmt(me.balance)})`, cmd)
    this.lastUserUse.set(k, now)
    const win = Math.random() * 100 < b.gambleChance
    if (win) this.points.add(me.key, n, 'рулетка')
    else this.points.spend(me.key, n, 'рулетка')
    this.say(e, win ? `🎉 ${e.user} выигрывает ${fmt(n)} ${this.cur()}! Теперь ${fmt(me.balance)}` : `💀 ${e.user} проигрывает ${fmt(n)} ${this.cur()}. Осталось ${fmt(me.balance)}`, cmd)
  }

  private duel(e: HubEvent, args: string[], cmd: string): void {
    const b = this.settings.get().bot
    const me = this.viewer(e)
    const to = args[0] ? this.points.byName(args[0], e.platform) : null
    const n = parseAmount(args[1], me.balance)
    if (!to || !n) return this.say(e, `@${e.user}, так: ${cmd} @ник сумма`, cmd)
    if (to.key === me.key) return this.say(e, `@${e.user}, с собой не дерутся`, cmd)
    if (me.balance < n) return this.say(e, `@${e.user}, не хватает ${this.cur()} (у тебя ${fmt(me.balance)})`, cmd)
    if (to.balance < n) return this.say(e, `@${e.user}, у ${to.name} нет ${fmt(n)} ${this.cur()}`, cmd)
    this.duels.set(to.key, { from: me.key, fromName: e.user, amount: n, expires: Date.now() + b.duelSec * 1000, platform: e.platform })
    this.say(e, `⚔ ${e.user} вызывает ${to.name} на дуэль на ${fmt(n)} ${this.cur()}! ${to.name}, пиши ${ACCEPT[0]} (${b.duelSec} с)`, cmd)
  }

  private accept(e: HubEvent, cmd: string): void {
    const me = this.viewer(e)
    const d = this.duels.get(me.key)
    if (!d || d.expires < Date.now()) { this.duels.delete(me.key); return this.note(e, cmd, 'нет вызова') }
    this.duels.delete(me.key)
    const from = this.points.get(d.from)
    if (!from || from.balance < d.amount || me.balance < d.amount) return this.say(e, `Дуэль отменена: у кого-то уже нет ${fmt(d.amount)} ${this.cur()}`, cmd)
    const [win, lose] = Math.random() < 0.5 ? [from, me] : [me, from]
    this.points.spend(lose.key, d.amount, `дуэль с ${win.name}`)
    this.points.add(win.key, d.amount, `дуэль с ${lose.name}`)
    this.say(e, `⚔ ${win.name} побеждает ${lose.name} и забирает ${fmt(d.amount)} ${this.cur()}!`, cmd)
  }

  /** Команды модераторов. true — команда узнана (даже если не хватило прав). */
  private async modCommand(e: HubEvent, cmd: string, args: string[], text: string): Promise<boolean> {
    const m = this.settings.get().mod
    const d = this.deps!
    const all = [m.skipAlertCmd, m.pauseAlertsCmd, m.resumeAlertsCmd, m.skipTrackCmd, m.pointsAddCmd, m.pointsTakeCmd, m.betLockCmd, m.betWinCmd, m.betCancelCmd, m.titleCmd, m.gameCmd]
    if (!all.includes(cmd) || !cmd) return false
    if (this.rank(e, true) < RANK.mod) { this.note(e, cmd, 'не модератор'); return true }
    const rest = text.slice(text.indexOf(' ') + 1).trim()
    const hasRest = text.includes(' ') && !!rest
    switch (cmd) {
      case m.skipAlertCmd: d.skipAlert(); this.note(e, cmd, 'алерт пропущен'); break
      case m.pauseAlertsCmd: d.pauseAlerts(true); this.say(e, 'Алерты на паузе', cmd); break
      case m.resumeAlertsCmd: d.pauseAlerts(false); this.say(e, 'Алерты снова работают', cmd); break
      case m.skipTrackCmd: this.say(e, await d.skipTrack(), cmd); break
      case m.pointsAddCmd:
      case m.pointsTakeCmd: {
        const who = args[0] ? this.points.byName(args[0], e.platform) : null
        const n = parseAmount(args[1], who?.balance ?? 0)
        if (!who || !n) { this.say(e, `@${e.user}, так: ${cmd} @ник сумма`, cmd); break }
        const sign = cmd === m.pointsAddCmd ? 1 : -1
        const bal = this.points.add(who.key, sign * n, `${sign > 0 ? 'выдал' : 'забрал'} ${e.user}`)
        this.say(e, `${who.name}: ${sign > 0 ? '+' : '−'}${fmt(n)} ${this.cur()}, теперь ${fmt(bal)}`, cmd)
        break
      }
      case m.betLockCmd: this.say(e, d.betLock(), cmd); break
      case m.betWinCmd: {
        const n = Number(args[0])
        this.say(e, Number.isInteger(n) && n > 0 ? d.betWin(n) : `@${e.user}, так: ${cmd} номер исхода`, cmd)
        break
      }
      case m.betCancelCmd: this.say(e, d.betCancel(), cmd); break
      case m.titleCmd: if (hasRest) this.say(e, await d.setTitle(rest), cmd); break
      case m.gameCmd: if (hasRest) this.say(e, await d.setGame(rest), cmd); break
    }
    return true
  }

  private onTick(): void {
    const cfg = this.settings.get().bot
    if (!cfg.enabled || !this.deps || !this.deps.isLive()) return
    const now = Date.now()
    for (const t of cfg.timers) {
      if (!t.enabled) continue
      const last = this.timerLast[t.id] ?? 0
      if (!last) { this.timerLast[t.id] = now; this.timerMsgAt[t.id] = this.msgCount; continue }
      if (now - last < t.everyMin * 60_000) continue
      if (this.msgCount - (this.timerMsgAt[t.id] ?? 0) < t.minMessages) continue
      this.timerLast[t.id] = now
      this.timerMsgAt[t.id] = this.msgCount
      const text = fillResponse(t.text, { uptime: fmtUptime(this.deps.uptimeMs()), currency: this.cur() })
      this.recentOut.unshift(text)
      this.deps.sendAll(text)
      this.log.unshift({ ts: now, platform: 'hub', user: 'Таймер', cmd: t.text.slice(0, 40), result: text })
      if (this.log.length > LOG_LIMIT) this.log.length = LOG_LIMIT
      this.emit('change')
    }
    for (const [k, d] of this.duels) if (d.expires < now) this.duels.delete(k)
  }

  stop(): void {
    if (this.tick) clearInterval(this.tick)
    this.tick = null
  }
}

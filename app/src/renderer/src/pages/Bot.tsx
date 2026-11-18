import { useEffect, useState } from 'react'
import type { HubSnapshot, Platform } from '../../../main/core/types'
import type { BotCommand, BotSettings, BotTimer, ModSettings, PointsSettings } from '../../../main/core/extsettings'
import type { Viewer } from '../../../main/core/points'
import { NumberField, Toggle } from '../components'
import { fmtTime } from '../ui'
import { AccessPick, Notes, PLAT_NAME, PlatformPick, ScopeNote, TextSetting, num, useWrap } from './ext'

type Tab = 'commands' | 'timers' | 'points' | 'mods'
const TABS: { id: Tab; label: string }[] = [
  { id: 'commands', label: 'Команды' }, { id: 'timers', label: 'Сообщения по таймеру' }, { id: 'points', label: 'Очки зрителей' }, { id: 'mods', label: 'Модераторы' }
]
const newId = (p: string): string => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** «Бот и очки»: замена RutonyChat — свои команды, таймеры, очки зрителей и команды модераторов. */
export function Bot({ snap }: { snap: HubSnapshot }) {
  const [tab, setTab] = useState<Tab>('commands')
  const b = snap.settings.bot
  return (
    <>
      <div className="head">
        <div>
          <h1>Бот и очки</h1>
          <p>Команды в чате, сообщения по таймеру, очки зрителей ({snap.settings.points.name}) и команды для модераторов — на всех площадках сразу.</p>
        </div>
        <div className="right"><Toggle on={b.enabled} onChange={(v) => void window.hub.setSettings({ bot: { enabled: v } })} label="Бот включён" /></div>
      </div>
      <div className="seg vote-tabs">
        {TABS.map((t) => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === 'commands' && <Commands snap={snap} />}
      {tab === 'timers' && <Timers b={b} snap={snap} />}
      {tab === 'points' && <PointsTab snap={snap} />}
      {tab === 'mods' && <Mods snap={snap} />}
    </>
  )
}

// ---------- Команды ----------

function Commands({ snap }: { snap: HubSnapshot }) {
  const b = snap.settings.bot
  const save = (list: BotCommand[]): void => void window.hub.setSettings({ bot: { commands: list } })
  const add = (): void => save([...b.commands, { id: newId('c'), trigger: '!новая', aliases: [], response: 'Ответ бота, {user}', cooldownSec: 5, userCooldownSec: 0, access: 'all', cost: 0, enabled: true, platforms: [] }])
  return (
    <div className="grid auc-grid">
      <div className="auc-side">
        <div className="card">
          <h3>Свои команды <button className="r btn sm" onClick={add}>+ команда</button></h3>
          {!b.commands.length && <div className="empty">Команд пока нет</div>}
          {b.commands.map((c) => (
            <CommandRow key={c.id} c={c} snap={snap} uses={snap.bot.uses[c.id] ?? 0} currency={snap.settings.points.name}
              onSave={(x) => save(b.commands.map((y) => (y.id === c.id ? x : y)))}
              onRemove={() => save(b.commands.filter((y) => y.id !== c.id))} />
          ))}
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            В ответе: {'{user}'} — кто написал, {'{target}'} — первое слово после команды (или сам зритель), {'{args}'} — весь текст после команды,
            {' {points}'} — очки зрителя, {'{currency}'} — название очков, {'{uptime}'} — сколько идёт эфир, {'{count}'} — сколько раз вызвали, {'{random}'} или {'{random:1-6}'} — случайное число.
          </p>
        </div>
      </div>
      <div className="auc-side">
        <TestCard />
        <BuiltinCard b={b} currency={snap.settings.points.name} />
        <LogCard snap={snap} />
      </div>
    </div>
  )
}

function CommandRow({ c, snap, uses, currency, onSave, onRemove }: { c: BotCommand; snap: HubSnapshot; uses: number; currency: string; onSave: (c: BotCommand) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const [ask, setAsk] = useState(false)
  const set = (p: Partial<BotCommand>): void => onSave({ ...c, ...p })
  return (
    <div className="bot-cmd">
      <div className="bot-cmd-head">
        <Toggle on={c.enabled} onChange={(v) => set({ enabled: v })} label={<b className="mono">{c.trigger}</b>} />
        <span className="grow ellipsis small muted">{c.response}</span>
        {uses > 0 && <span className="tag">{uses}×</span>}
        <button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Свернуть' : 'Изменить'}</button>
      </div>
      {open && (
        <div className="bot-cmd-body">
          <div className="grid g2" style={{ gap: 10 }}>
            <TextSetting label="Команда" value={c.trigger} max={30} onSave={(v) => set({ trigger: v })} />
            <TextSetting label="Другие варианты через запятую" value={c.aliases.join(', ')} max={160} onSave={(v) => set({ aliases: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
          </div>
          <TextSetting label="Ответ бота" value={c.response} max={450} area onSave={(v) => set({ response: v })} />
          <div className="field"><label>Кто может</label><AccessPick value={c.access} onChange={(a) => set({ access: a })} /></div>
          <div className="field"><label>Где работает</label><PlatformPick snap={snap} value={c.platforms} onChange={(p) => set({ platforms: p })} /></div>
          <div className="grid g3" style={{ gap: 10 }}>
            <NumberField label="Общий кулдаун" value={c.cooldownSec} min={0} max={86_400} suffix="сек" onChange={(v) => set({ cooldownSec: v })} />
            <NumberField label="Кулдаун зрителя" value={c.userCooldownSec} min={0} max={86_400} suffix="сек" onChange={(v) => set({ userCooldownSec: v })} />
            <NumberField label={`Цена (${currency})`} value={c.cost} min={0} max={10_000_000} onChange={(v) => set({ cost: v })} />
          </div>
          <div className="btnrow">
            <button className={`btn sm${ask ? ' danger' : ''}`} onClick={() => (ask ? onRemove() : (setAsk(true), setTimeout(() => setAsk(false), 3000)))}>{ask ? 'Точно удалить?' : 'Удалить команду'}</button>
            <span className="small muted">Модераторы и стример не ждут кулдаун.</span>
          </div>
        </div>
      )}
    </div>
  )
}

function TestCard() {
  const [text, setText] = useState('!привет')
  const [out, setOut] = useState('')
  const { err, wrap } = useWrap()
  const run = (): void => wrap(window.hub.botTest(text), (v) => setOut(String(v)))
  return (
    <div className="card">
      <h3>Проверить бота</h3>
      <div className="auc-add">
        <input className="input" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run() }} />
        <button className="btn sm" onClick={run}>Проверить</button>
      </div>
      {out && <div className="note" style={{ marginTop: 10 }}>{out}</div>}
      {err && <div className="note err" style={{ marginTop: 10 }}>{err}</div>}
      <p className="small muted" style={{ margin: '8px 0 0' }}>Как будто написал стример. В чат ничего не уходит.</p>
    </div>
  )
}

function BuiltinCard({ b, currency }: { b: BotSettings; currency: string }) {
  const set = (p: Partial<BotSettings>): void => void window.hub.setSettings({ bot: p })
  return (
    <div className="card">
      <h3>Встроенные команды</h3>
      <p className="small muted" style={{ marginTop: 0 }}>Пустое поле — команда выключена.</p>
      <div className="grid g2" style={{ gap: 10 }}>
        <TextSetting label={`Баланс ${currency}`} value={b.balanceCmd} max={30} onSave={(v) => set({ balanceCmd: v })} />
        <TextSetting label="Топ по очкам" value={b.topCmd} max={30} onSave={(v) => set({ topCmd: v })} />
        <TextSetting label="Передать очки" value={b.giveCmd} max={30} onSave={(v) => set({ giveCmd: v })} />
        <TextSetting label="Рулетка" value={b.gambleCmd} max={30} onSave={(v) => set({ gambleCmd: v })} />
        <TextSetting label="Дуэль" value={b.duelCmd} max={30} onSave={(v) => set({ duelCmd: v })} />
        <TextSetting label="Сколько идёт эфир" value={b.uptimeCmd} max={30} onSave={(v) => set({ uptimeCmd: v })} />
        <TextSetting label="Список команд" value={b.listCmd} max={30} onSave={(v) => set({ listCmd: v })} />
      </div>
      <div className="vote-sep">Рулетка и дуэль</div>
      <div className="grid g2" style={{ gap: 10 }}>
        <NumberField label="Шанс выигрыша" value={b.gambleChance} min={1} max={95} suffix="%" onChange={(v) => set({ gambleChance: v })} />
        <NumberField label="Кулдаун рулетки" value={b.gambleCooldownSec} min={0} max={3600} suffix="сек" onChange={(v) => set({ gambleCooldownSec: v })} />
        <NumberField label="Ставка от" value={b.gambleMin} min={1} max={10_000_000} onChange={(v) => set({ gambleMin: v })} />
        <NumberField label="Ставка до" value={b.gambleMax} min={1} max={100_000_000} onChange={(v) => set({ gambleMax: v })} />
        <NumberField label="Ждать «!принять»" value={b.duelSec} min={10} max={600} suffix="сек" onChange={(v) => set({ duelSec: v })} />
      </div>
    </div>
  )
}

function LogCard({ snap }: { snap: HubSnapshot }) {
  const log = snap.bot.log
  return (
    <div className="card">
      <h3>Что делал бот {log.length > 0 && <button className="r btn sm" onClick={() => void window.hub.botClearLog()}>Очистить</button>}</h3>
      {!log.length && <div className="empty">Пока тихо</div>}
      <div className="list">
        {log.slice(0, 25).map((l, i) => (
          <div key={i} className="row" style={{ padding: '7px 0' }}>
            <span className="small muted mono">{fmtTime(l.ts)}</span>
            <div className="grow"><b className="small">{l.user} · {l.cmd}</b><span className="small muted">{l.result}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- Таймеры ----------

function Timers({ b, snap }: { b: BotSettings; snap: HubSnapshot }) {
  const save = (list: BotTimer[]): void => void window.hub.setSettings({ bot: { timers: list } })
  const set = (id: string, p: Partial<BotTimer>): void => save(b.timers.map((t) => (t.id === id ? { ...t, ...p } : t)))
  return (
    <div className="card">
      <h3>Сообщения по таймеру <button className="r btn sm" onClick={() => save([...b.timers, { id: newId('t'), text: 'Подписывайтесь, чтобы не пропустить эфир!', everyMin: 20, minMessages: 5, enabled: true, platforms: [] }])}>+ сообщение</button></h3>
      <p className="small muted" style={{ marginTop: 0 }}>Пишутся в выбранные чаты (по умолчанию — во все, где можно писать) и только пока идёт эфир. Если в чате тихо (меньше N сообщений с прошлого раза) — бот ждёт.</p>
      {!b.timers.length && <div className="empty">Таймеров нет</div>}
      {b.timers.map((t) => (
        <div key={t.id} className="bot-cmd">
          <div className="bot-cmd-head">
            <Toggle on={t.enabled} onChange={(v) => set(t.id, { enabled: v })} label="" />
            <span className="grow small muted">{snap.bot.timers[t.id] ? `последний раз ${fmtTime(snap.bot.timers[t.id])}` : 'ещё не писал'}</span>
            <button className="btn sm" onClick={() => save(b.timers.filter((x) => x.id !== t.id))}>Удалить</button>
          </div>
          <TextSetting label="Текст" value={t.text} max={450} area onSave={(v) => set(t.id, { text: v })} />
          <div className="grid g2" style={{ gap: 10 }}>
            <NumberField label="Раз в" value={t.everyMin} min={1} max={1440} suffix="мин" onChange={(v) => set(t.id, { everyMin: v })} />
            <NumberField label="Не раньше, чем через сообщений" value={t.minMessages} min={0} max={1000} onChange={(v) => set(t.id, { minMessages: v })} />
          </div>
          <div className="field"><label>Куда писать</label><PlatformPick snap={snap} value={t.platforms} onChange={(p) => set(t.id, { platforms: p })} /></div>
        </div>
      ))}
    </div>
  )
}

// ---------- Очки зрителей ----------

function PointsTab({ snap }: { snap: HubSnapshot }) {
  const p = snap.settings.points
  const st = snap.points
  const set = (x: Partial<PointsSettings>): void => void window.hub.setSettings({ points: x })
  const [q, setQ] = useState('')
  const [list, setList] = useState<Viewer[]>([])
  const [who, setWho] = useState('')
  const [plat, setPlat] = useState<Platform>('twitch')
  const [amount, setAmount] = useState(100)
  const [ask, setAsk] = useState(false)
  const { err, ok, wrap, say } = useWrap()
  useEffect(() => {
    const t = setTimeout(() => void window.hub.pointsSearch(q).then(setList).catch(() => undefined), 200)
    return () => clearTimeout(t)
  }, [q, st.total, st.count])
  const give = (sign: 1 | -1): void => wrap(window.hub.pointsAdjust(who, plat, sign * amount), (v) => say(`${who}: теперь ${num(Number(v))} ${p.name}`))
  return (
    <div className="grid auc-grid">
      <div className="auc-side">
        <div className="card">
          <h3>Зрители <span className="r small muted">{num(st.count)} зрителей · {num(st.total)} {p.name} на руках</span></h3>
          <input className="input" placeholder="Найти по нику" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
          {!list.length && <div className="empty">{q ? 'Никого не нашли' : 'Зрителей пока нет — они появятся, когда напишут в чат'}</div>}
          <div className="list">
            {list.slice(0, 60).map((v, i) => (
              <div key={v.key} className="row" style={{ padding: '7px 0' }}>
                <span className="small muted mono" style={{ width: 28 }}>{q ? '' : i + 1}</span>
                <div className="grow"><b className="ellipsis">{v.name}</b><span className="small muted">{PLAT_NAME[v.platform] ?? v.platform} · заработал {num(v.earned)}, потратил {num(v.spent)}</span></div>
                <b className="mono">{num(v.balance)}</b>
                <button className="btn sm" onClick={() => { setWho(v.name); setPlat(v.platform) }}>±</button>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Выдать или забрать</h3>
          <Notes err={err} ok={ok} />
          <div className="grid g3" style={{ gap: 10 }}>
            <div className="field"><label>Ник</label><input className="input" value={who} maxLength={64} onChange={(e) => setWho(e.target.value)} /></div>
            <div className="field"><label>Площадка</label>
              <select className="input" value={plat} onChange={(e) => setPlat(e.target.value as Platform)}>
                {(['twitch', 'youtube', 'vk', 'kick', 'goodgame'] as Platform[]).map((x) => <option key={x} value={x}>{PLAT_NAME[x]}</option>)}
              </select>
            </div>
            <NumberField label="Сколько" value={amount} min={1} max={1_000_000_000} onChange={setAmount} />
          </div>
          <div className="btnrow">
            <button className="btn sm" disabled={!who.trim()} onClick={() => give(1)}>+ Выдать</button>
            <button className="btn sm" disabled={!who.trim()} onClick={() => give(-1)}>− Забрать</button>
          </div>
        </div>
        <div className="card">
          <h3>Журнал очков {st.log.length > 0 && <button className="r btn sm" onClick={() => void window.hub.pointsClearLog()}>Очистить</button>}</h3>
          {!st.log.length && <div className="empty">Здесь будут траты, выигрыши и ручные выдачи</div>}
          <div className="list">
            {st.log.slice(0, 30).map((l, i) => (
              <div key={i} className="row" style={{ padding: '6px 0' }}>
                <span className="small muted mono">{fmtTime(l.ts)}</span>
                <span className="grow ellipsis small"><b>{l.name}</b> · {l.reason}</span>
                <b className="mono small" style={{ color: l.delta > 0 ? 'var(--ok)' : 'var(--muted)' }}>{l.delta > 0 ? '+' : ''}{num(l.delta)}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="auc-side">
        <div className="card">
          <h3>Как копятся очки</h3>
          <Toggle on={p.enabled} onChange={(v) => set({ enabled: v })} label="Очки зрителей включены" />
          <div className="grid g2" style={{ gap: 10, marginTop: 10 }}>
            <TextSetting label="Название очков" value={p.name} max={24} onSave={(v) => set({ name: v })} />
            <NumberField label="У нового зрителя" value={p.startBalance} min={0} max={1_000_000} onChange={(v) => set({ startBalance: v })} />
            <NumberField label="За сообщение" value={p.perMessage} min={0} max={100_000} onChange={(v) => set({ perMessage: v })} />
            <NumberField label="Не чаще раза в" value={p.messageCooldownSec} min={0} max={3600} suffix="сек" onChange={(v) => set({ messageCooldownSec: v })} />
            <NumberField label="За минуту эфира" value={p.perMinute} min={0} max={100_000} onChange={(v) => set({ perMinute: v })} />
            <NumberField label="Если писал за последние" value={p.activeMin} min={1} max={120} suffix="мин" onChange={(v) => set({ activeMin: v })} />
            <NumberField label="За 1 ₽ доната" value={p.perRub} min={0} max={100_000} onChange={(v) => set({ perRub: v })} />
            <NumberField label="За фоллоу" value={p.perFollow} min={0} max={1_000_000} onChange={(v) => set({ perFollow: v })} />
            <NumberField label="За подписку" value={p.perSub} min={0} max={1_000_000} onChange={(v) => set({ perSub: v })} />
            <NumberField label="За каждую подаренную" value={p.perGift} min={0} max={1_000_000} onChange={(v) => set({ perGift: v })} />
            <NumberField label="За рейд" value={p.perRaid} min={0} max={1_000_000} onChange={(v) => set({ perRaid: v })} />
            <NumberField label="За 100 битов" value={p.perBits100} min={0} max={1_000_000} onChange={(v) => set({ perBits100: v })} />
          </div>
          <Toggle on={p.onlyLive} onChange={(v) => set({ onlyLive: v })} label="Сообщения и минуты — только во время эфира" />
          <Toggle on={p.twitchLurkers} onChange={(v) => set({ twitchLurkers: v })} label="Twitch: минуты и молчащим зрителям (раз в 5 минут)" />
          {p.twitchLurkers && <ScopeNote snap={snap} scope="moderator:read:chatters" what="очков молчащим зрителям" />}
          {st.lurkers && <p className="small muted" style={{ margin: '6px 0 0' }}>{st.lurkers.error ? `Не получилось: ${st.lurkers.error}` : `Последний раз в ${fmtTime(st.lurkers.ts)}: молчащих зрителей — ${st.lurkers.count}`}</p>}
          <p className="small muted">{st.earning ? '● Сейчас очки начисляются.' : 'Сейчас очки за минуты не начисляются (эфир не идёт или очки выключены).'} Донатеров Crossember ищет по нику среди зрителей чата.</p>
          <div className="btnrow">
            <button className={`btn sm${ask ? ' danger' : ''}`} onClick={() => (ask ? (void window.hub.pointsReset(), setAsk(false)) : (setAsk(true), setTimeout(() => setAsk(false), 3000)))}>{ask ? 'Точно обнулить всем?' : 'Обнулить очки всем'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Модераторы ----------

function Mods({ snap }: { snap: HubSnapshot }) {
  const m = snap.settings.mod
  const set = (x: Partial<ModSettings>): void => void window.hub.setSettings({ mod: x })
  const url = snap.server?.modUrl ?? null
  const lanOn = snap.settings.lan.enabled
  return (
    <div className="grid auc-grid">
      <div className="auc-side">
        <div className="card">
          <h3>Команды модераторов в чате</h3>
          <Toggle on={m.enabled} onChange={(v) => set({ enabled: v })} label="Модераторы могут управлять Crossember командами" />
          <Toggle on={m.vipAsMod} onChange={(v) => set({ vipAsMod: v })} label="VIP тоже могут" />
          <p className="small muted">Работает там, где площадка сообщает, что зритель — модератор: Twitch и YouTube. Пустое поле — команда выключена.</p>
          <div className="grid g2" style={{ gap: 10 }}>
            <TextSetting label="Пропустить алерт" value={m.skipAlertCmd} max={30} onSave={(v) => set({ skipAlertCmd: v })} />
            <TextSetting label="Пауза алертов" value={m.pauseAlertsCmd} max={30} onSave={(v) => set({ pauseAlertsCmd: v })} />
            <TextSetting label="Снять паузу алертов" value={m.resumeAlertsCmd} max={30} onSave={(v) => set({ resumeAlertsCmd: v })} />
            <TextSetting label="Пропустить трек" value={m.skipTrackCmd} max={30} onSave={(v) => set({ skipTrackCmd: v })} />
            <TextSetting label="Выдать очки (@ник сумма)" value={m.pointsAddCmd} max={30} onSave={(v) => set({ pointsAddCmd: v })} />
            <TextSetting label="Забрать очки" value={m.pointsTakeCmd} max={30} onSave={(v) => set({ pointsTakeCmd: v })} />
            <TextSetting label="Закрыть приём ставок" value={m.betLockCmd} max={30} onSave={(v) => set({ betLockCmd: v })} />
            <TextSetting label="Итог ставок (номер исхода)" value={m.betWinCmd} max={30} onSave={(v) => set({ betWinCmd: v })} />
            <TextSetting label="Отменить ставки" value={m.betCancelCmd} max={30} onSave={(v) => set({ betCancelCmd: v })} />
            <TextSetting label="Сменить название Twitch" value={m.titleCmd} max={30} onSave={(v) => set({ titleCmd: v })} />
            <TextSetting label="Сменить категорию Twitch" value={m.gameCmd} max={30} onSave={(v) => set({ gameCmd: v })} />
          </div>
        </div>
      </div>
      <div className="auc-side">
        <div className="card">
          <h3>Пульт модератора</h3>
          <p className="small muted" style={{ marginTop: 0 }}>Упрощённая страница без настроек: мультичат с кнопками удалить / таймаут / бан, очередь алертов и наград, голосование, ставки, розыгрыш, музыка. Открывается в браузере на другом устройстве в той же домашней сети (Wi-Fi). Через интернет — нет: всё остаётся у вас дома.</p>
          <Toggle on={m.web} onChange={(v) => set({ web: v })} label="Пульт модератора включён" />
          {m.web && !lanOn && <div className="note" style={{ marginTop: 10 }}>Сначала включите «Чат на другом устройстве» в «Настройках» — пульт работает на том же адресе.</div>}
          {m.web && lanOn && !url && <div className="note" style={{ marginTop: 10 }}>Адрес домашней сети не запущен — проверьте «Настройки» → «Чат на другом устройстве».</div>}
          {m.web && url && (
            <>
              <div className="field" style={{ marginTop: 10 }}>
                <label>Ссылка для модератора (это ключ — не публикуйте её)</label>
                <div className="auc-add">
                  <input className="input mono" readOnly value={url} onFocus={(e) => e.target.select()} />
                  <button className="btn sm" onClick={() => void window.hub.copy(url)}>Копировать</button>
                </div>
              </div>
              <button className="btn sm" onClick={() => void window.hub.rotateKey('mod')}>Сменить ключ (старая ссылка перестанет работать)</button>
            </>
          )}
          <p className="small muted">Сообщения из пульта уходят от имени бота Twitch (если он подключён), иначе — от имени стримера.</p>
        </div>
      </div>
    </div>
  )
}

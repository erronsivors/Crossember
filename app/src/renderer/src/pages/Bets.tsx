import { useState } from 'react'
import type { HubSnapshot, Platform } from '../../../main/core/types'
import type { BetView } from '../../../main/core/bets'
import type { BetsSettings } from '../../../main/core/extsettings'
import { NumberField, Toggle } from '../components'
import { fmtTime, useNow } from '../ui'
import { Notes, PLAT_NAME, ScopeNote, TextSetting, num, useWrap, type Wrap } from './ext'

const mmss = (ms: number): string => {
  const t = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const STATUS: Record<string, string> = { open: '● Приём ставок', locked: 'Приём закрыт — ждём итог', resolved: 'Итог подведён', canceled: 'Отменено' }

/** Ставки (прогнозы) со своим оверлеем: свои очки на всех площадках или прогноз Twitch. */
export function Bets({ snap }: { snap: HubSnapshot }) {
  const st = snap.bets
  const cfg = snap.settings.bets
  const { err, ok, wrap, say } = useWrap()
  const b = st.bet
  return (
    <>
      <div className="head">
        <div>
          <h1>Ставки</h1>
          <p>Зрители угадывают исход: «Пройду босса с первой попытки?». Ставят {st.currency} со всех площадок или баллы канала в прогнозе Twitch. Оверлей «Ставки» показывает банк и коэффициенты.</p>
        </div>
      </div>
      <Notes err={err} ok={ok} />
      {b ? <BetCard b={b} cur={b.source === 'twitch' ? 'баллов' : st.currency} wrap={wrap} say={say} /> : <NewBet snap={snap} cfg={cfg} wrap={wrap} />}
      <div className="grid auc-grid">
        <div className="auc-side">
          {b && b.source === 'own' && (b.status === 'open') && <ManualBet b={b} wrap={wrap} />}
          {b && <RecentCard b={b} />}
          {!b && <HowCard cfg={cfg} cur={st.currency} />}
        </div>
        <div className="auc-side">
          <SettingsCard cfg={cfg} />
          {st.archive.length > 0 && (
            <div className="card">
              <h3>Прошлые ставки <button className="r btn sm" onClick={() => wrap(window.hub.betClearArchive())}>Очистить</button></h3>
              <div className="list">
                {st.archive.slice(0, 15).map((a) => (
                  <div key={a.id} className="row" style={{ padding: '7px 0' }}>
                    <span className="small muted mono">{fmtTime(a.ts)}</span>
                    <div className="grow"><b className="ellipsis">{a.title}</b><span className="small muted">{a.canceled ? 'отменено' : `победил: ${a.winner || '—'}`} · банк {num(a.total)} · {a.bettors} уч.</span></div>
                    {a.source === 'twitch' && <span className="tag">Twitch</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function NewBet({ snap, cfg, wrap }: { snap: HubSnapshot; cfg: BetsSettings; wrap: Wrap }) {
  const [source, setSource] = useState<'own' | 'twitch'>('own')
  const [title, setTitle] = useState('')
  const [outs, setOuts] = useState<string[]>(['Да', 'Нет'])
  const [sec, setSec] = useState(cfg.defaultSec)
  const tw = source === 'twitch'
  const filled = outs.map((o) => o.trim()).filter(Boolean)
  const can = !!title.trim() && filled.length >= 2
  return (
    <div className="card vote-new">
      <h3>Новые ставки</h3>
      <div className="field">
        <label>Чем ставят</label>
        <div className="seg">
          <button className={!tw ? 'on' : ''} onClick={() => setSource('own')}>Свои очки ({snap.settings.points.name}) — все площадки</button>
          <button className={tw ? 'on' : ''} onClick={() => setSource('twitch')}>Прогноз Twitch — баллы канала</button>
        </div>
        {tw && <p className="small muted" style={{ margin: '6px 0 0' }}>Создаётся на самом Twitch, зрители ставят кнопкой в чате Twitch. Только для компаньонов и партнёров: 2–10 исходов до 25 символов, вопрос до 45, приём от 30 секунд до 30 минут.</p>}
        {!tw && !snap.settings.points.enabled && <p className="small" style={{ margin: '6px 0 0', color: 'var(--warn)' }}>Очки зрителей выключены — включите их в «Бот и очки» → «Очки зрителей».</p>}
      </div>
      {tw && <ScopeNote snap={snap} scope="channel:manage:predictions" what="прогнозов Twitch" />}
      <div className="field">
        <label>Вопрос</label>
        <input className="input" value={title} maxLength={tw ? 45 : 120} placeholder="Пройду босса с первой попытки?" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label>Исходы</label>
        <div className="vote-opts-edit">
          {outs.map((o, i) => (
            <div key={i} className="auc-add">
              <span className="vote-num">{i + 1}</span>
              <input className="input" value={o} maxLength={tw ? 25 : 60} placeholder={`Исход ${i + 1}`} onChange={(e) => setOuts(outs.map((x, j) => (j === i ? e.target.value : x)))} />
              <button className="btn sm" disabled={outs.length <= 2} onClick={() => setOuts(outs.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8 }}><button className="btn sm" disabled={outs.length >= 10} onClick={() => setOuts([...outs, ''])}>+ исход</button></div>
      </div>
      <NumberField label={tw ? 'Приём ставок' : 'Приём ставок (0 — пока не закроете вручную)'} value={sec} min={tw ? 30 : 0} max={tw ? 1800 : 86_400} suffix="сек" onChange={setSec} />
      <div className="btnrow" style={{ marginTop: 6 }}>
        <button className="btn primary" disabled={!can} onClick={() => wrap(window.hub.betStart({ source, title: title.trim(), outcomes: filled, sec }))}>▶ Начать ставки</button>
        {!can && <span className="small muted">Нужен вопрос и хотя бы два исхода</span>}
      </div>
    </div>
  )
}

function BetCard({ b, cur, wrap, say }: { b: BetView; cur: string; wrap: Wrap; say: (t: string) => void }) {
  const now = useNow(500)
  const live = b.status === 'open' || b.status === 'locked'
  const [ask, setAsk] = useState<string | null>(null)
  const confirm = (id: string, run: () => void): void => {
    if (ask === id) { setAsk(null); run() } else { setAsk(id); setTimeout(() => setAsk((x) => (x === id ? null : x)), 3000) }
  }
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3>
        {b.title}
        {b.source === 'twitch' && <span className="tag">Twitch</span>}
        <span className="r small muted">{STATUS[b.status]}{b.status === 'open' && b.locksAt ? ` · ${mmss(b.locksAt - now)}` : ''}</span>
      </h3>
      <div className="bet-outs">
        {b.outcomes.map((o) => {
          const pct = b.total ? Math.round((o.pool / b.total) * 100) : 0
          const coef = o.pool ? Math.round((b.total / o.pool) * 100) / 100 : 0
          return (
            <div key={o.id} className={`bet-out${b.winner === o.id ? ' win' : b.winner ? ' lose' : ''}`}>
              <div className="bet-out-h"><span className="vote-num">{o.num}</span><b className="ellipsis">{o.name}</b></div>
              <div className="bet-pool mono">{num(o.pool)} <span className="small muted">{cur}</span></div>
              <div className="small muted">{pct}% · {coef ? `×${String(coef).replace('.', ',')}` : '—'} · {o.users} уч.</div>
              <div className="ix-bar"><i style={{ width: `${pct}%` }} /></div>
              {live && <button className={`btn sm${ask === o.id ? ' danger' : ''}`} style={{ marginTop: 8 }} onClick={() => confirm(o.id, () => wrap(window.hub.betResolve(o.num), (t) => say(String(t))))}>{ask === o.id ? 'Точно этот?' : 'Победил этот'}</button>}
            </div>
          )
        })}
      </div>
      <div className="btnrow" style={{ marginTop: 14 }}>
        {b.status === 'open' && <button className="btn primary" onClick={() => wrap(window.hub.betLock())}>Закрыть приём</button>}
        {b.status === 'open' && b.source === 'own' && <><button className="btn sm" onClick={() => wrap(window.hub.betExtend(30))}>+30 с</button><button className="btn sm" onClick={() => wrap(window.hub.betExtend(60))}>+1 мин</button></>}
        {live && <button className={`btn sm${ask === 'cancel' ? ' danger' : ''}`} onClick={() => confirm('cancel', () => wrap(window.hub.betCancel()))}>{ask === 'cancel' ? 'Точно отменить? Всё вернётся' : 'Отменить ставки'}</button>}
        {!live && <button className="btn" onClick={() => wrap(window.hub.betClose())}>Новые ставки</button>}
        <span className="small muted">Банк: {num(b.total)} {cur} · участников: {b.bettors}</span>
      </div>
      {b.status === 'resolved' && b.payouts.length > 0 && (
        <p className="small" style={{ margin: '12px 0 0' }}>Выиграли: {b.payouts.slice(0, 10).map((p) => `${p.name} +${num(p.won)}`).join(', ')}</p>
      )}
      {b.status === 'resolved' && b.source === 'own' && !b.payouts.length && <p className="small muted" style={{ margin: '12px 0 0' }}>Никто не угадал — банк сгорел.</p>}
    </div>
  )
}

function ManualBet({ b, wrap }: { b: BetView; wrap: Wrap }) {
  const [name, setName] = useState('')
  const [plat, setPlat] = useState<Platform>('twitch')
  const [n, setN] = useState(1)
  const [amount, setAmount] = useState('100')
  return (
    <div className="card">
      <h3>Ставка за зрителя</h3>
      <div className="grid g2" style={{ gap: 10 }}>
        <div className="field"><label>Ник</label><input className="input" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Площадка</label>
          <select className="input" value={plat} onChange={(e) => setPlat(e.target.value as Platform)}>
            {(['twitch', 'youtube', 'vk', 'kick', 'goodgame'] as Platform[]).map((x) => <option key={x} value={x}>{PLAT_NAME[x]}</option>)}
          </select>
        </div>
        <div className="field"><label>Исход</label>
          <select className="input" value={n} onChange={(e) => setN(Number(e.target.value))}>
            {b.outcomes.map((o) => <option key={o.id} value={o.num}>{o.num}) {o.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Сумма (или «все»)</label><input className="input" value={amount} maxLength={12} onChange={(e) => setAmount(e.target.value)} /></div>
      </div>
      <button className="btn sm" disabled={!name.trim()} onClick={() => wrap(window.hub.betManual(name.trim(), plat, n, amount), () => setName(''))}>Поставить</button>
      <p className="small muted" style={{ margin: '8px 0 0' }}>Очки списываются с баланса зрителя.</p>
    </div>
  )
}

function RecentCard({ b }: { b: BetView }) {
  return (
    <div className="card">
      <h3>Последние ставки</h3>
      {!b.recent.length && <div className="empty">{b.source === 'twitch' ? 'Twitch присылает только банк и лучших по каждому исходу' : 'Ставок пока нет'}</div>}
      <div className="list">
        {b.recent.map((x, i) => (
          <div key={i} className="row" style={{ padding: '6px 0' }}>
            <span className="small muted mono">{fmtTime(x.ts)}</span>
            <span className="grow ellipsis"><b>{x.name}</b> <span className="small muted">→ #{b.outcomes.find((o) => o.id === x.outcome)?.num}</span></span>
            <b className="mono small">{num(x.amount)}</b>
          </div>
        ))}
      </div>
      {b.source === 'twitch' && b.outcomes.some((o) => o.top.length) && (
        <div className="small muted" style={{ marginTop: 8 }}>
          {b.outcomes.map((o) => o.top.length ? <div key={o.id}>#{o.num}: {o.top.slice(0, 3).map((t) => `${t.name} ${num(t.amount)}`).join(', ')}</div> : null)}
        </div>
      )}
    </div>
  )
}

function HowCard({ cfg, cur }: { cfg: BetsSettings; cur: string }) {
  return (
    <div className="card">
      <h3>Как ставят зрители</h3>
      <ul className="vote-how">
        <li>Пишут в чат на любой площадке: «{cfg.cmd} 1 500» — 500 {cur} на исход №1. «{cfg.cmd} 2 все» — всё, что есть.</li>
        <li>Можно добавлять к своей ставке, но только на тот же исход. Ставка от {num(cfg.minBet)} до {num(cfg.maxBet)}.</li>
        <li>Угадавшие делят весь банк пропорционально ставкам — как в прогнозах Twitch. Коэффициент на экране показывает, во сколько раз вырастет ставка.</li>
        <li>Отмена возвращает всем их ставки.</li>
      </ul>
    </div>
  )
}

function SettingsCard({ cfg }: { cfg: BetsSettings }) {
  const set = (p: Partial<BetsSettings>): void => void window.hub.setSettings({ bets: p })
  return (
    <div className="card">
      <h3>Правила ставок</h3>
      <div className="grid g2" style={{ gap: 10 }}>
        <TextSetting label="Команда" value={cfg.cmd} max={30} onSave={(v) => set({ cmd: v })} />
        <NumberField label="Приём по умолчанию" value={cfg.defaultSec} min={0} max={86_400} suffix="сек" onChange={(v) => set({ defaultSec: v })} />
        <NumberField label="Ставка от" value={cfg.minBet} min={1} max={10_000_000} onChange={(v) => set({ minBet: v })} />
        <NumberField label="Ставка до" value={cfg.maxBet} min={1} max={100_000_000} onChange={(v) => set({ maxBet: v })} />
      </div>
      <Toggle on={cfg.announce} onChange={(v) => set({ announce: v })} label="Писать в чат о старте, закрытии и итоге" />
      {cfg.announce && (
        <>
          <TextSetting label="При старте" value={cfg.startText} max={300} onSave={(v) => set({ startText: v })} />
          <TextSetting label="Приём закрыт" value={cfg.lockText} max={300} onSave={(v) => set({ lockText: v })} />
          <TextSetting label="Итог" value={cfg.winText} max={300} onSave={(v) => set({ winText: v })} />
          <p className="small muted" style={{ margin: 0 }}>Подстановки: {'{вопрос}'}, {'{исходы}'}, {'{команда}'}, {'{банк}'}, {'{исход}'}, {'{победители}'}. О прогнозе Twitch не пишем — Twitch показывает его сам.</p>
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import type { HubSnapshot } from '../../../main/core/types'
import type { SubathonSettings } from '../../../main/core/extsettings'
import { NumberField, Toggle } from '../components'
import { fmtTime, useNow } from '../ui'
import { Notes, num, useWrap } from './ext'

const hms = (ms: number): string => {
  const t = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const plus = (sec: number): string => `${sec > 0 ? '+' : '−'}${hms(Math.abs(sec) * 1000).replace(/^0:/, '')}`

/** Таймер-сабатон: эфир идёт, пока не кончится время; события зрителей его продлевают. */
export function Subathon({ snap }: { snap: HubSnapshot }) {
  const st = snap.subathon
  const cfg = snap.settings.subathon
  const now = useNow(250)
  const { err, ok, wrap } = useWrap()
  const [startMin, setStartMin] = useState(cfg.startMin)
  const [custom, setCustom] = useState(10)
  const [ask, setAsk] = useState(false)
  const started = st.startedAt !== null
  const left = st.endsAt ? st.endsAt - now : st.pausedLeft ?? 0
  const set = (p: Partial<SubathonSettings>): void => void window.hub.setSettings({ subathon: p })
  return (
    <>
      <div className="head">
        <div>
          <h1>Сабатон</h1>
          <p>Эфир длится, пока не кончится таймер. Подписки, донаты, биты, фолловы и рейды добавляют время. Оверлей «Сабатон» показывает таймер и всплывающие «+5:00».</p>
        </div>
      </div>
      <Notes err={err} ok={ok} />
      <div className="card" style={{ marginBottom: 18 }}>
        {!started ? (
          <>
            <h3>Запустить сабатон</h3>
            <div className="grid g2" style={{ gap: 10, maxWidth: 520 }}>
              <NumberField label="Начальное время" value={startMin} min={1} max={100_000} suffix="мин" onChange={setStartMin} />
            </div>
            <button className="btn primary" onClick={() => wrap(window.hub.subStart(startMin))}>▶ Запустить</button>
          </>
        ) : (
          <>
            <h3>
              {st.ended ? 'Сабатон окончен' : st.running ? '● Идёт' : 'Пауза'}
              {st.happy && <span className="tag">счастливый час ×{cfg.multiplier}</span>}
              {st.capped && <span className="tag">предел</span>}
              <span className="r small muted">добавлено всего {plus(st.added)}</span>
            </h3>
            <div className="sub-clock mono">{hms(left)}</div>
            <div className="btnrow" style={{ marginTop: 12 }}>
              {st.running ? <button className="btn" onClick={() => wrap(window.hub.subPause(true))}>Пауза</button> : <button className="btn primary" onClick={() => wrap(window.hub.subPause(false))} disabled={!left}>Продолжить</button>}
              {[60, 300, 900].map((s) => <button key={s} className="btn sm" onClick={() => wrap(window.hub.subAdd(s))}>+{s / 60} мин</button>)}
              {[60, 300].map((s) => <button key={-s} className="btn sm" onClick={() => wrap(window.hub.subAdd(-s))}>−{s / 60} мин</button>)}
              <NumberField label="" value={custom} min={1} max={10_000} suffix="мин" onChange={setCustom} />
              <button className="btn sm" onClick={() => wrap(window.hub.subAdd(custom * 60))}>Добавить</button>
            </div>
            <div className="btnrow" style={{ marginTop: 8 }}>
              <Toggle on={st.happy} onChange={(v) => wrap(window.hub.subHappy(v))} label={`Счастливый час — добавки ×${cfg.multiplier}`} />
              <button className={`btn sm${ask ? ' danger' : ''}`} onClick={() => (ask ? (setAsk(false), wrap(window.hub.subStop())) : (setAsk(true), setTimeout(() => setAsk(false), 3000)))}>{ask ? 'Точно остановить?' : 'Остановить сабатон'}</button>
            </div>
          </>
        )}
      </div>
      <div className="grid auc-grid">
        <div className="auc-side">
          <div className="card">
            <h3>Что добавило время</h3>
            {!st.log.length && <div className="empty">Пока ничего</div>}
            <div className="list">
              {st.log.slice(0, 40).map((l, i) => (
                <div key={i} className="row" style={{ padding: '6px 0' }}>
                  <span className="small muted mono">{fmtTime(l.ts)}</span>
                  <span className="grow ellipsis"><b>{l.user}</b> <span className="small muted">{l.reason}</span></span>
                  <b className="mono small">{plus(l.sec)}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="auc-side">
          <div className="card">
            <h3>Сколько добавлять</h3>
            <div className="grid g2" style={{ gap: 10 }}>
              <NumberField label="Подписка" value={cfg.perSubSec} min={0} max={86_400} suffix="сек" onChange={(v) => set({ perSubSec: v })} />
              <NumberField label="Каждая подаренная" value={cfg.perGiftSec} min={0} max={86_400} suffix="сек" onChange={(v) => set({ perGiftSec: v })} />
              <NumberField label="Каждые 100 ₽" value={cfg.perRub100Sec} min={0} max={86_400} suffix="сек" onChange={(v) => set({ perRub100Sec: v })} />
              <NumberField label="Каждые 100 битов" value={cfg.perBits100Sec} min={0} max={86_400} suffix="сек" onChange={(v) => set({ perBits100Sec: v })} />
              <NumberField label="Фоллоу" value={cfg.perFollowSec} min={0} max={86_400} suffix="сек" onChange={(v) => set({ perFollowSec: v })} />
              <NumberField label="Рейд" value={cfg.perRaidSec} min={0} max={86_400} suffix="сек" onChange={(v) => set({ perRaidSec: v })} />
              <NumberField label="Множитель счастливого часа" value={cfg.multiplier} min={1} max={10} suffix="×" onChange={(v) => set({ multiplier: v })} />
              <NumberField label="Предел (0 — без предела)" value={cfg.maxHours} min={0} max={10_000} suffix="ч" onChange={(v) => set({ maxHours: v })} />
            </div>
            <p className="small muted" style={{ margin: 0 }}>Предел — общая длительность сабатона с момента запуска. Время добавляет и награда за баллы с действием «Добавить время в сабатон». Сейчас 100 ₽ = {num(cfg.perRub100Sec)} сек.</p>
          </div>
        </div>
      </div>
    </>
  )
}

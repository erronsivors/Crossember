import { useState } from 'react'
import type { HubSnapshot } from '../../../main/core/types'
import type { RewardAction, RewardMeta } from '../../../main/core/rewards'
import type { TwitchReward, TwitchRewardInput } from '../../../main/core/twitch'
import type { MemeSupporter } from '../../../main/core/memealerts'
import { NumberField, Toggle } from '../components'
import { fmtTime } from '../ui'
import { Notes, ScopeNote, num, useWrap, type Wrap } from './ext'

const ACTIONS: { id: RewardAction; label: string; amount?: string }[] = [
  { id: 'none', label: 'Без действия — в очередь' },
  { id: 'track', label: 'Заказ трека (Spotify)' },
  { id: 'points', label: 'Начислить свои очки', amount: 'Сколько очков' },
  { id: 'subathon', label: 'Время в сабатон', amount: 'Сколько секунд' },
  { id: 'memecoins', label: 'Мемкоины Memealerts', amount: 'Сколько мемкоинов' }
]
const EMPTY: TwitchRewardInput = { title: '', cost: 500, prompt: '', inputRequired: false, enabled: true, paused: false, color: '#9147ff', cooldownSec: 0, maxPerStream: 0, maxPerUser: 0, skipQueue: false }

/** Награды за баллы канала Twitch: очередь «кто что выбрал», награды Crossember с действиями, мемкоины. */
export function Rewards({ snap }: { snap: HubSnapshot }) {
  const st = snap.rewards
  const { err, ok, wrap, say } = useWrap()
  const [edit, setEdit] = useState<string | 'new' | null>(null)
  const [showDone, setShowDone] = useState(false)
  const own = st.rewards.filter((r) => r.own)
  const other = st.rewards.filter((r) => !r.own)
  return (
    <>
      <div className="head">
        <div>
          <h1>Награды за баллы</h1>
          <p>Очередь «кто что выбрал» с кнопками «выполнено» и «вернуть баллы». Вернуть баллы Twitch разрешает только за награды, созданные здесь, в Crossember.</p>
        </div>
        <div className="right"><button className="btn sm" onClick={() => wrap(window.hub.rewardsRefresh(), () => say('Список наград обновлён'))}>Обновить список</button></div>
      </div>
      <ScopeNote snap={snap} scope="channel:manage:redemptions" what="создания наград и возврата баллов" />
      <Notes err={err ?? (st.error || null)} ok={ok} />
      <div className="grid auc-grid">
        <div className="auc-side">
          <div className="card">
            <h3>
              Очередь {st.queue.length > 0 && <span className="nav-cnt">{st.queue.length}</span>}
              {st.queue.length > 1 && <button className="r btn sm" onClick={() => wrap(window.hub.redeemDoneAll())}>Всё выполнено</button>}
            </h3>
            {!st.queue.length && <div className="empty">Новых активаций нет</div>}
            <div className="list">
              {st.queue.map((r) => (
                <div key={r.id} className="row" style={{ padding: '9px 0', alignItems: 'flex-start' }}>
                  <span className="small muted mono">{fmtTime(r.ts)}</span>
                  <div className="grow">
                    <b>{r.user} <span className="small muted">· {r.title} · {num(r.cost)}</span></b>
                    {r.input && <div>{r.input}</div>}
                    {r.note && <div className="small" style={{ color: 'var(--warn)' }}>{r.note}</div>}
                  </div>
                  <button className="btn sm" onClick={() => wrap(window.hub.redeemDone(r.id))}>✓ Выполнено</button>
                  {r.own ? <button className="btn sm" onClick={() => wrap(window.hub.redeemRefund(r.id))}>↩ Вернуть</button> : <span className="small muted" title="Награда создана не в Crossember — Twitch не даёт вернуть баллы">без возврата</span>}
                </div>
              ))}
            </div>
            {st.done.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <button className="linkbtn" onClick={() => setShowDone(!showDone)}>{showDone ? 'Скрыть' : 'Показать'} разобранные ({st.done.length})</button>
                {showDone && (
                  <>
                    <div className="list">
                      {st.done.slice(0, 30).map((r) => (
                        <div key={r.id} className="row" style={{ padding: '6px 0' }}>
                          <span className="small muted mono">{fmtTime(r.ts)}</span>
                          <span className="grow ellipsis small"><b>{r.user}</b> · {r.title}{r.input ? ` — ${r.input}` : ''}</span>
                          <span className="tag">{r.status === 'done' ? 'выполнено' : r.status === 'refunded' ? 'возврат' : 'ошибка'}</span>
                        </div>
                      ))}
                    </div>
                    <button className="btn sm" onClick={() => wrap(window.hub.redeemClearDone())}>Очистить</button>
                  </>
                )}
              </div>
            )}
          </div>
          <MemeCard snap={snap} />
        </div>
        <div className="auc-side">
          <div className="card">
            <h3>Награды Crossember <button className="r btn sm" onClick={() => setEdit('new')}>+ награда</button></h3>
            {own.length > 0 && (
              <div className="btnrow" style={{ marginBottom: 8 }}>
                <button className="btn sm" onClick={() => wrap(window.hub.rewardsPause(true))}>Пауза всем</button>
                <button className="btn sm" onClick={() => wrap(window.hub.rewardsPause(false))}>Снять паузу</button>
              </div>
            )}
            {edit === 'new' && <RewardForm init={EMPTY} meta={{ action: 'none', amount: 100, autoDone: true }} wrap={wrap} onDone={() => setEdit(null)} />}
            {!own.length && edit !== 'new' && <div className="empty">{st.loadedAt ? 'Наград Crossember пока нет' : 'Список ещё не загружен — нажмите «Обновить список»'}</div>}
            {own.map((r) => (
              edit === r.id
                ? <RewardForm key={r.id} id={r.id} init={r} meta={st.meta[r.id] ?? { action: 'none', amount: 100, autoDone: true }} wrap={wrap} onDone={() => setEdit(null)} />
                : <RewardRow key={r.id} r={r} meta={st.meta[r.id]} onEdit={() => setEdit(r.id)} wrap={wrap} />
            ))}
          </div>
          {other.length > 0 && (
            <div className="card">
              <h3>Другие награды канала</h3>
              <p className="small muted" style={{ marginTop: 0 }}>Созданы на Twitch. Они попадают в очередь, но вернуть за них баллы и изменить их отсюда нельзя.</p>
              <div className="list">
                {other.map((r) => (
                  <div key={r.id} className="row" style={{ padding: '6px 0' }}>
                    <span className="rw-dot" style={{ background: r.color }} />
                    <span className="grow ellipsis">{r.title}</span>
                    <span className="mono small">{num(r.cost)}</span>
                    {!r.enabled && <span className="tag">выкл.</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="card">
            <h3>Если действие не удалось</h3>
            <Toggle on={snap.settings.rewards.refundOnFail} onChange={(v) => void window.hub.setSettings({ rewards: { refundOnFail: v } })} label="Возвращать баллы (например, трек не нашёлся)" />
          </div>
        </div>
      </div>
    </>
  )
}

function RewardRow({ r, meta, onEdit, wrap }: { r: TwitchReward; meta?: RewardMeta; onEdit: () => void; wrap: Wrap }) {
  const [ask, setAsk] = useState(false)
  const act = ACTIONS.find((a) => a.id === (meta?.action ?? 'none'))
  return (
    <div className="row" style={{ padding: '8px 0' }}>
      <span className="rw-dot" style={{ background: r.color }} />
      <div className="grow">
        <b className="ellipsis">{r.title}</b>
        <span className="small muted">{num(r.cost)} баллов · {act?.label}{act?.amount && meta ? `: ${num(meta.amount)}` : ''}{r.paused ? ' · на паузе' : ''}{!r.enabled ? ' · выключена' : ''}</span>
      </div>
      <Toggle on={r.enabled} onChange={(v) => wrap(window.hub.rewardUpdate(r.id, { enabled: v }))} label="" />
      <button className="btn sm" onClick={onEdit}>Изменить</button>
      <button className={`btn sm${ask ? ' danger' : ''}`} onClick={() => (ask ? wrap(window.hub.rewardRemove(r.id)) : (setAsk(true), setTimeout(() => setAsk(false), 3000)))}>{ask ? 'Удалить?' : '✕'}</button>
    </div>
  )
}

function RewardForm({ id, init, meta, wrap, onDone }: { id?: string; init: TwitchRewardInput; meta: RewardMeta; wrap: Wrap; onDone: () => void }) {
  const [r, setR] = useState<TwitchRewardInput>({ ...init })
  const [m, setM] = useState<RewardMeta>({ ...meta })
  const set = (p: Partial<TwitchRewardInput>): void => setR({ ...r, ...p })
  const act = ACTIONS.find((a) => a.id === m.action)
  const save = (): void => {
    if (id) wrap(Promise.all([window.hub.rewardUpdate(id, r), window.hub.rewardMeta(id, m)]), onDone)
    else wrap(window.hub.rewardCreate(r, m), onDone)
  }
  return (
    <div className="bot-cmd" style={{ marginBottom: 10 }}>
      <div className="grid g2" style={{ gap: 10 }}>
        <div className="field"><label>Название (до 45)</label><input className="input" value={r.title} maxLength={45} onChange={(e) => set({ title: e.target.value })} /></div>
        <NumberField label="Цена, баллов" value={r.cost} min={1} max={1_000_000_000} onChange={(v) => set({ cost: v })} />
      </div>
      <div className="field"><label>Описание для зрителей</label><input className="input" value={r.prompt} maxLength={200} onChange={(e) => set({ prompt: e.target.value })} /></div>
      <div className="field">
        <label>Что сделать при активации</label>
        <select className="input" value={m.action} onChange={(e) => { const a = e.target.value as RewardAction; setM({ ...m, action: a }); if (a === 'track') set({ inputRequired: true }) }}>
          {ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </div>
      {act?.amount && <NumberField label={act.amount} value={m.amount} min={0} max={100_000_000} onChange={(v) => setM({ ...m, amount: v })} />}
      {m.action === 'track' && <p className="small muted" style={{ marginTop: 0 }}>Зритель пишет название или ссылку Spotify в поле награды. Лимиты — в «Музыке».</p>}
      {m.action === 'memecoins' && <p className="small muted" style={{ marginTop: 0 }}>Мемкоины получит зритель с тем же ником в Memealerts (он должен хотя бы раз зайти на вашу страницу Memealerts).</p>}
      <div className="grid g3" style={{ gap: 10 }}>
        <NumberField label="Кулдаун" value={r.cooldownSec} min={0} max={604_800} suffix="сек" onChange={(v) => set({ cooldownSec: v })} />
        <NumberField label="За эфир (0 — без лимита)" value={r.maxPerStream} min={0} max={100_000} onChange={(v) => set({ maxPerStream: v })} />
        <NumberField label="На зрителя за эфир" value={r.maxPerUser} min={0} max={100_000} onChange={(v) => set({ maxPerUser: v })} />
      </div>
      <div className="btnrow">
        <Toggle on={r.inputRequired} onChange={(v) => set({ inputRequired: v })} label="Зритель пишет текст" />
        {m.action !== 'none' && <Toggle on={m.autoDone} onChange={(v) => setM({ ...m, autoDone: v })} label="Сразу «выполнено», если действие прошло" />}
        <label className="small muted">Цвет <input type="color" value={r.color} onChange={(e) => set({ color: e.target.value })} /></label>
      </div>
      <div className="btnrow" style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={!r.title.trim()} onClick={save}>{id ? 'Сохранить' : 'Создать на Twitch'}</button>
        <button className="btn sm" onClick={onDone}>Отмена</button>
      </div>
    </div>
  )
}

export function MemeCard({ snap }: { snap: HubSnapshot }) {
  const m = snap.memealerts
  const { err, ok, wrap, say } = useWrap()
  const [token, setToken] = useState('')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<MemeSupporter[]>([])
  const [who, setWho] = useState('')
  const [n, setN] = useState(10)
  return (
    <div className="card">
      <h3>Memealerts {m.account && <span className="r small muted">{m.account}</span>}</h3>
      <Notes err={err ?? (m.error || null)} ok={ok} />
      {!m.account ? (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>Выдача мемкоинов зрителям вручную и наградой за баллы. У Memealerts нет открытого API — Crossember пользуется внутренним API сайта, как сторонние программы, поэтому после обновлений Memealerts это может сломаться. Ленты входящих мемов в этом API нет.</p>
          <div className="btnrow">
            {m.pending ? <button className="btn sm" onClick={() => wrap(window.hub.memeCancel())}>Закрыть окно входа</button> : <button className="btn primary" onClick={() => wrap(window.hub.memeLogin())}>Войти в Memealerts</button>}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Или вставьте токен (сайт → F12 → Application → Local Storage → accessToken)</label>
            <div className="auc-add">
              <input className="input mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
              <button className="btn sm" disabled={!token.trim()} onClick={() => wrap(window.hub.memeToken(token), () => setToken(''))}>Подключить</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid g2" style={{ gap: 10 }}>
            <div className="field"><label>Ник в Memealerts</label><input className="input" value={who} maxLength={64} onChange={(e) => setWho(e.target.value)} /></div>
            <NumberField label="Мемкоинов" value={n} min={1} max={100_000} onChange={setN} />
          </div>
          <div className="btnrow">
            <button className="btn sm" disabled={!who.trim()} onClick={() => wrap(window.hub.memeGive(who, n), (t) => say(String(t)))}>Выдать</button>
            <input className="input" placeholder="Найти саппортера" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
            <button className="btn sm" onClick={() => wrap(window.hub.memeSupporters(q), (v) => setFound(v as MemeSupporter[]))}>Найти</button>
          </div>
          {found.length > 0 && (
            <div className="chips" style={{ marginTop: 8 }}>
              {found.slice(0, 20).map((f) => <button key={f.id} onClick={() => setWho(f.name)}>{f.name}</button>)}
            </div>
          )}
          {m.log.length > 0 && (
            <div className="list" style={{ marginTop: 8 }}>
              {m.log.slice(0, 8).map((l, i) => (
                <div key={i} className="row" style={{ padding: '5px 0' }}>
                  <span className="small muted mono">{fmtTime(l.ts)}</span>
                  <span className="grow ellipsis small">{l.note}</span>
                  <span className={`tag${l.ok ? '' : ' test'}`}>{l.ok ? 'ок' : 'ошибка'}</span>
                </div>
              ))}
            </div>
          )}
          <button className="btn sm" style={{ marginTop: 10 }} onClick={() => wrap(window.hub.memeLogout())}>Отключить Memealerts</button>
        </>
      )}
    </div>
  )
}

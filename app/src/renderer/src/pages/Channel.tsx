import { useEffect, useState } from 'react'
import type { HubSnapshot } from '../../../main/core/types'
import type { TwitchChatSettings } from '../../../main/core/twitch'
import { Toggle } from '../components'
import { Notes, ScopeNote, useWrap } from './ext'

/** Панель канала Twitch: рейд, шаутаут, бан и разбан по нику, режимы чата, реклама, маркер, клип, объявление. */
export function Channel({ snap }: { snap: HubSnapshot }) {
  const { err, ok, wrap, say } = useWrap()
  const me = snap.twitch.broadcaster
  if (!me) {
    return (
      <>
        <div className="head"><div><h1>Панель Twitch</h1><p>Рейд, шаутаут, бан, режимы чата, реклама, маркеры и клипы — без вкладки с панелью Twitch.</p></div></div>
        <div className="card"><div className="empty">Сначала войдите в Twitch: «Подключения» → Twitch → «Войти».</div></div>
      </>
    )
  }
  return (
    <>
      <div className="head">
        <div>
          <h1>Панель Twitch</h1>
          <p>Канал {me.name}. Рейд, шаутаут, бан, режимы чата, реклама, маркеры и клипы — без вкладки с панелью Twitch.</p>
        </div>
        <div className="right"><button className="btn sm" onClick={() => void window.hub.openExternal(`https://dashboard.twitch.tv/u/${encodeURIComponent(me.login)}/stream-manager`)}>Открыть панель Twitch ↗</button></div>
      </div>
      <Notes err={err} ok={ok} />
      <div className="grid auc-grid">
        <div className="auc-side">
          <RaidCard snap={snap} wrap={wrap} say={say} />
          <BanCard snap={snap} wrap={wrap} say={say} />
          <AnnounceCard snap={snap} wrap={wrap} say={say} />
        </div>
        <div className="auc-side">
          <ChatModes snap={snap} />
          <QuickCard snap={snap} wrap={wrap} say={say} />
          <div className="card">
            <h3>Совместный стрим</h3>
            <p className="small muted" style={{ margin: 0 }}>У Twitch нет открытого API для «Совместных стримов» (Stream Together) — пригласить гостя можно только в панели Twitch. Кнопка «Открыть панель Twitch» вверху ведёт туда.</p>
          </div>
        </div>
      </div>
    </>
  )
}

type P = { snap: HubSnapshot; wrap: ReturnType<typeof useWrap>['wrap']; say: (t: string) => void }

function RaidCard({ snap, wrap, say }: P) {
  const [login, setLogin] = useState('')
  const [shout, setShout] = useState('')
  return (
    <div className="card">
      <h3>Рейд и шаутаут</h3>
      <ScopeNote snap={snap} scope="channel:manage:raids" what="рейда" />
      <div className="field">
        <label>Канал для рейда (ник или ссылка)</label>
        <div className="auc-add">
          <input className="input" value={login} maxLength={100} placeholder="nickname" onChange={(e) => setLogin(e.target.value)} />
          <button className="btn primary" disabled={!login.trim()} onClick={() => wrap(window.hub.twRaid(login), (n) => say(`Рейд на ${String(n)} начат — Twitch отсчитывает 90 секунд, затем подтвердите или дождитесь`))}>Рейд</button>
          <button className="btn sm" onClick={() => wrap(window.hub.twRaidCancel(), () => say('Рейд отменён'))}>Отменить</button>
        </div>
      </div>
      <ScopeNote snap={snap} scope="moderator:manage:shoutouts" what="шаутаута" />
      <div className="field">
        <label>Шаутаут (рекомендация канала в чате Twitch)</label>
        <div className="auc-add">
          <input className="input" value={shout} maxLength={100} placeholder="nickname" onChange={(e) => setShout(e.target.value)} />
          <button className="btn sm" disabled={!shout.trim()} onClick={() => wrap(window.hub.twShoutout(shout), (n) => say(`Шаутаут: ${String(n)}`))}>Шаутаут</button>
        </div>
        <p className="small muted" style={{ margin: '4px 0 0' }}>Twitch разрешает шаутаут не чаще раза в 2 минуты и одному каналу — раз в час. Работает только во время эфира.</p>
      </div>
    </div>
  )
}

function BanCard({ snap, wrap, say }: P) {
  const [login, setLogin] = useState('')
  const [reason, setReason] = useState('')
  return (
    <div className="card">
      <h3>Бан и разбан по нику</h3>
      <ScopeNote snap={snap} scope="moderator:manage:banned_users" what="бана" />
      <div className="grid g2" style={{ gap: 10 }}>
        <div className="field"><label>Ник</label><input className="input" value={login} maxLength={100} onChange={(e) => setLogin(e.target.value)} /></div>
        <div className="field"><label>Причина (видна зрителю)</label><input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
      <div className="btnrow">
        <button className="btn sm" disabled={!login.trim()} onClick={() => wrap(window.hub.twBan(login, 600, reason), (n) => say(`${String(n)}: таймаут 10 минут`))}>Таймаут 10 мин</button>
        <button className="btn sm" disabled={!login.trim()} onClick={() => wrap(window.hub.twBan(login, 86_400, reason), (n) => say(`${String(n)}: таймаут на сутки`))}>На сутки</button>
        <button className="btn sm" disabled={!login.trim()} onClick={() => wrap(window.hub.twBan(login, 0, reason), (n) => say(`${String(n)} забанен`))}>Бан</button>
        <button className="btn sm" disabled={!login.trim()} onClick={() => wrap(window.hub.twUnban(login), (n) => say(`${String(n)} разбанен`))}>Разбан</button>
      </div>
    </div>
  )
}

function AnnounceCard({ snap, wrap, say }: P) {
  const [text, setText] = useState('')
  const [color, setColor] = useState('primary')
  return (
    <div className="card">
      <h3>Объявление в чате Twitch</h3>
      <ScopeNote snap={snap} scope="moderator:manage:announcements" what="объявлений" />
      <textarea className="input" rows={2} value={text} maxLength={500} placeholder="Через 10 минут — розыгрыш!" onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} />
      <div className="btnrow" style={{ marginTop: 8 }}>
        <div className="seg">
          {[['primary', 'Цвет канала'], ['blue', 'Синий'], ['green', 'Зелёный'], ['orange', 'Оранжевый'], ['purple', 'Фиолетовый']].map(([id, label]) => (
            <button key={id} className={color === id ? 'on' : ''} onClick={() => setColor(id)}>{label}</button>
          ))}
        </div>
        <button className="btn sm" disabled={!text.trim()} onClick={() => wrap(window.hub.twAnnounce(text, color), () => { setText(''); say('Объявление отправлено') })}>Отправить</button>
      </div>
    </div>
  )
}

function ChatModes({ snap }: { snap: HubSnapshot }) {
  const { err, wrap } = useWrap()
  const [s, setS] = useState<TwitchChatSettings | null>(null)
  const [slowSec, setSlowSec] = useState(10)
  const [follMin, setFollMin] = useState(10)
  const load = (): void => wrap(window.hub.twChatSettings(), (v) => { const x = v as TwitchChatSettings; setS(x); if (x.slowSec) setSlowSec(x.slowSec); if (x.followersMin) setFollMin(x.followersMin) })
  useEffect(load, [])
  const put = (p: Partial<TwitchChatSettings>): void => wrap(window.hub.twSetChatSettings(p), (v) => setS(v as TwitchChatSettings))
  return (
    <div className="card">
      <h3>Режимы чата <button className="r btn sm" onClick={load}>Обновить</button></h3>
      <ScopeNote snap={snap} scope="moderator:manage:chat_settings" what="смены режимов чата" />
      {err && <div className="note err" style={{ marginBottom: 10 }}>{err}</div>}
      {!s ? <div className="empty">Загрузка…</div> : (
        <>
          <div className="btnrow">
            <Toggle on={s.slow} onChange={(v) => put({ slow: v, slowSec })} label="Медленный режим" />
            <input className="input mono" type="number" min={3} max={120} value={slowSec} style={{ width: 80 }} onChange={(e) => setSlowSec(Number(e.target.value) || 3)} onBlur={() => { if (s.slow) put({ slow: true, slowSec }) }} />
            <span className="small muted">сек</span>
          </div>
          <div className="btnrow">
            <Toggle on={s.followers} onChange={(v) => put({ followers: v, followersMin: follMin })} label="Только фолловеры" />
            <input className="input mono" type="number" min={0} max={129600} value={follMin} style={{ width: 80 }} onChange={(e) => setFollMin(Math.max(0, Number(e.target.value) || 0))} onBlur={() => { if (s.followers) put({ followers: true, followersMin: follMin }) }} />
            <span className="small muted">мин после фоллоу</span>
          </div>
          <div className="tw-modes">
            <Toggle on={s.subs} onChange={(v) => put({ subs: v })} label="Только подписчики" />
            <Toggle on={s.emotes} onChange={(v) => put({ emotes: v })} label="Только смайлы" />
            <Toggle on={s.unique} onChange={(v) => put({ unique: v })} label="Без повторов (уникальные сообщения)" />
          </div>
        </>
      )}
    </div>
  )
}

function QuickCard({ snap, wrap, say }: P) {
  const [marker, setMarker] = useState('')
  const [clip, setClip] = useState<{ url: string; editUrl: string } | null>(null)
  return (
    <div className="card">
      <h3>Реклама, маркер, клип</h3>
      <ScopeNote snap={snap} scope="channel:edit:commercial" what="запуска рекламы и клипов" />
      <div className="field">
        <label>Запустить рекламу (только во время эфира, для компаньонов и партнёров)</label>
        <div className="btnrow">
          {[30, 60, 90, 180].map((sec) => <button key={sec} className="btn sm" onClick={() => wrap(window.hub.twCommercial(sec), (n) => say(`Реклама на ${String(n)} секунд запущена`))}>{sec < 60 ? `${sec} с` : `${sec / 60} мин`}</button>)}
        </div>
      </div>
      <div className="field">
        <label>Маркер для монтажа (отметка в записи эфира)</label>
        <div className="auc-add">
          <input className="input" value={marker} maxLength={140} placeholder="Классный момент" onChange={(e) => setMarker(e.target.value)} />
          <button className="btn sm" onClick={() => wrap(window.hub.twMarker(marker), () => { setMarker(''); say('Маркер поставлен') })}>Поставить</button>
        </div>
      </div>
      <div className="field">
        <label>Клип последних секунд эфира</label>
        <div className="btnrow">
          <button className="btn sm" onClick={() => wrap(window.hub.twClip(), (v) => { setClip(v as { url: string; editUrl: string }); say('Клип создаётся — Twitch обработает его за несколько секунд') })}>Сделать клип</button>
          {clip?.url && <><button className="linkbtn" onClick={() => void window.hub.copy(clip.url)}>Копировать ссылку</button><button className="linkbtn" onClick={() => void window.hub.openExternal(clip.editUrl || clip.url)}>Открыть ↗</button></>}
        </div>
      </div>
    </div>
  )
}

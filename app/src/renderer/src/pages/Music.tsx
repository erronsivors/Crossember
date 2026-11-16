import { useEffect, useState } from 'react'
import type { HubSnapshot } from '../../../main/core/types'
import type { MusicSettings } from '../../../main/core/extsettings'
import type { SpotifyTrack } from '../../../main/core/spotify'
import { NumberField, Toggle } from '../components'
import { fmtTime, useNow } from '../ui'
import { AccessPick, Notes, TextSetting, useWrap } from './ext'

const REDIRECT = 'http://127.0.0.1:47836/callback'
const mss = (ms: number): string => {
  const t = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** Музыка: «сейчас играет» из Spotify или любого плеера Windows, кнопки, заказ треков (только Spotify). */
export function Music({ snap }: { snap: HubSnapshot }) {
  const m = snap.music
  const cfg = snap.settings.music
  const now = useNow(500)
  const { err, ok, wrap, say } = useWrap()
  const set = (p: Partial<MusicSettings>): void => void window.hub.setSettings({ music: p })
  const n = m.now
  const pos = n ? Math.min(n.durMs || 0, n.playing ? n.posMs + (now - n.at) : n.posMs) : 0
  const [vol, setVol] = useState(50)
  return (
    <>
      <div className="head">
        <div>
          <h1>Музыка</h1>
          <p>Что играет — в оверлее «Сейчас играет» и по команде {cfg.nowCmd || '!песня'}. Кнопки работают и для Яндекс Музыки, и для браузера. Заказ треков зрителями — только через Spotify.</p>
        </div>
      </div>
      <Notes err={err ?? (m.error || null)} ok={ok} />
      <div className="card" style={{ marginBottom: 18 }}>
        {n && n.title ? (
          <div className="mu-now">
            {n.image ? <img className="mu-art" src={n.image} alt="" /> : <div className="mu-art">♫</div>}
            <div className="grow">
              <div className="small muted">{n.playing ? '● Играет' : 'Пауза'} · {n.app}{n.requester ? ` · заказал ${n.requester}` : ''}</div>
              <div className="mu-title ellipsis">{n.title}</div>
              <div className="muted ellipsis">{n.artist}{n.album ? ` · ${n.album}` : ''}</div>
              {n.durMs > 0 && <div className="mu-bar"><i style={{ width: `${(pos / n.durMs) * 100}%` }} /><span className="small muted mono">{mss(pos)} / {mss(n.durMs)}</span></div>}
            </div>
          </div>
        ) : <div className="empty">Сейчас ничего не играет{!m.spotify.account && !cfg.smtc ? ' — подключите Spotify или включите «плеер Windows»' : ''}</div>}
        <div className="btnrow" style={{ marginTop: 12 }}>
          <button className="btn sm" onClick={() => wrap(window.hub.musicControl('prev'))}>⏮</button>
          <button className="btn primary" onClick={() => wrap(window.hub.musicControl('toggle'))}>{n?.playing ? '⏸ Пауза' : '▶ Играть'}</button>
          <button className="btn sm" onClick={() => wrap(window.hub.musicControl('next'))}>⏭</button>
          {m.spotify.account && n?.source === 'spotify' && (
            <label className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Громкость Spotify <input type="range" min={0} max={100} value={vol} onChange={(e) => setVol(Number(e.target.value))} onMouseUp={() => wrap(window.hub.musicVolume(vol))} />
            </label>
          )}
        </div>
      </div>
      <div className="grid auc-grid">
        <div className="auc-side">
          <RequestCard snap={snap} wrap={wrap} say={say} />
          <div className="card">
            <h3>Заказы {m.requests.length > 0 && <button className="r btn sm" onClick={() => wrap(window.hub.musicClearRequests())}>Убрать сыгранные</button>}</h3>
            {!m.requests.length && <div className="empty">Заказов пока нет</div>}
            <div className="list">
              {m.requests.map((r) => (
                <div key={r.id} className="row" style={{ padding: '6px 0' }}>
                  <span className="small muted mono">{fmtTime(r.ts)}</span>
                  <div className="grow"><b className="ellipsis">{r.artist} — {r.title}</b><span className="small muted">{r.user} · {r.via === 'reward' ? 'за баллы' : r.via === 'chat' ? 'команда' : 'вручную'}</span></div>
                  <span className="tag">{r.status === 'queued' ? 'в очереди' : r.status === 'playing' ? 'играет' : 'сыгран'}</span>
                </div>
              ))}
            </div>
            <p className="small muted" style={{ margin: '8px 0 0' }}>Spotify не даёт убрать трек из своей очереди — пропустить можно кнопкой ⏭ или командой модератора {snap.settings.mod.skipTrackCmd || '!скип'}.</p>
          </div>
        </div>
        <div className="auc-side">
          <SpotifyCard snap={snap} />
          <div className="card">
            <h3>Плеер Windows</h3>
            <Toggle on={cfg.smtc} onChange={(v) => set({ smtc: v })} label="Следить за любым плеером (Яндекс Музыка, браузер, AIMP…)" />
            <p className="small muted">Через системные медиа-кнопки Windows: название, исполнитель, пауза, дальше, назад. Обложку и заказ треков так получить нельзя. {cfg.smtc && (m.smtc ? 'Плеер отвечает.' : 'Пока ни один плеер не ответил — включите музыку.')}</p>
            <div className="field">
              <label>Что показывать в «Сейчас играет»</label>
              <div className="seg">
                <button className={cfg.nowSource === 'auto' ? 'on' : ''} onClick={() => set({ nowSource: 'auto' })}>Что играет</button>
                <button className={cfg.nowSource === 'spotify' ? 'on' : ''} onClick={() => set({ nowSource: 'spotify' })}>Только Spotify</button>
                <button className={cfg.nowSource === 'smtc' ? 'on' : ''} onClick={() => set({ nowSource: 'smtc' })}>Только плеер Windows</button>
              </div>
            </div>
          </div>
          <RequestSettings snap={snap} />
        </div>
      </div>
    </>
  )
}

function SpotifyCard({ snap }: { snap: HubSnapshot }) {
  const sp = snap.music.spotify
  const cfg = snap.settings.music
  const { err, wrap } = useWrap()
  const [id, setId] = useState(cfg.spotifyClientId)
  useEffect(() => setId(cfg.spotifyClientId), [cfg.spotifyClientId])
  return (
    <div className="card">
      <h3>Spotify {sp.account && <span className="r small muted">{sp.account}{sp.premium === false ? ' · без Premium' : ''}</span>}</h3>
      {err && <div className="note err" style={{ marginBottom: 10 }}>{err}</div>}
      {sp.error && !err && <div className="note err" style={{ marginBottom: 10 }}>{sp.error}</div>}
      {sp.account ? (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>Подключено. {sp.premium === false ? 'Без Premium Spotify показывает, что играет, но не даёт управлять плеером и добавлять треки в очередь.' : 'Управление и заказ треков работают.'}</p>
          <button className="btn sm" onClick={() => wrap(window.hub.spotifyLogout())}>Отключить Spotify</button>
        </>
      ) : (
        <>
          <ol className="small muted" style={{ paddingLeft: 18, marginTop: 0 }}>
            <li>Откройте <button className="linkbtn" onClick={() => void window.hub.openExternal('https://developer.spotify.com/dashboard')}>developer.spotify.com/dashboard</button> и войдите своим аккаунтом Spotify.</li>
            <li>«Create app»: любое название и описание, в «Redirect URIs» вставьте <span className="mono">{REDIRECT}</span> <button className="linkbtn" onClick={() => void window.hub.copy(REDIRECT)}>копировать</button>, отметьте «Web API».</li>
            <li>Скопируйте «Client ID» из настроек приложения сюда и нажмите «Войти».</li>
          </ol>
          <div className="field">
            <label>Client ID</label>
            <input className="input mono" value={id} maxLength={64} onChange={(e) => setId(e.target.value.trim())} onBlur={() => { if (id !== cfg.spotifyClientId) void window.hub.setSettings({ music: { spotifyClientId: id } }) }} />
          </div>
          {sp.pending
            ? <button className="btn sm" onClick={() => wrap(window.hub.spotifyCancel())}>Отменить вход</button>
            : <button className="btn primary" disabled={!sp.clientId} onClick={() => wrap(window.hub.spotifyLogin())}>Войти в Spotify</button>}
          <p className="small muted" style={{ marginBottom: 0 }}>Для управления плеером и заказа треков нужен Spotify Premium. Секрет приложения не нужен и не хранится.</p>
        </>
      )}
    </div>
  )
}

function RequestCard({ snap, wrap, say }: { snap: HubSnapshot; wrap: ReturnType<typeof useWrap>['wrap']; say: (t: string) => void }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<SpotifyTrack[]>([])
  if (!snap.music.spotify.account) return null
  return (
    <div className="card">
      <h3>Добавить трек в очередь</h3>
      <div className="auc-add">
        <input className="input" placeholder="Исполнитель — трек или ссылка Spotify" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') wrap(window.hub.musicSearch(q), (v) => setFound(v as SpotifyTrack[])) }} />
        <button className="btn sm" onClick={() => wrap(window.hub.musicSearch(q), (v) => setFound(v as SpotifyTrack[]))}>Найти</button>
      </div>
      <div className="list">
        {found.map((t) => (
          <div key={t.id} className="row" style={{ padding: '6px 0' }}>
            <div className="grow"><b className="ellipsis">{t.title}</b><span className="small muted">{t.artist} · {mss(t.durationMs)}</span></div>
            <button className="btn sm" onClick={() => wrap(window.hub.musicRequest(t.uri.replace('spotify:track:', 'https://open.spotify.com/track/')), () => say(`В очереди: ${t.artist} — ${t.title}`))}>В очередь</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function RequestSettings({ snap }: { snap: HubSnapshot }) {
  const cfg = snap.settings.music
  const set = (p: Partial<MusicSettings>): void => void window.hub.setSettings({ music: p })
  return (
    <div className="card">
      <h3>Заказ треков зрителями</h3>
      <Toggle on={cfg.requests} onChange={(v) => set({ requests: v })} label={`Команда в чате ${cfg.requestCmd || '!трек'} исполнитель — трек`} />
      <div className="grid g2" style={{ gap: 10, marginTop: 10 }}>
        <TextSetting label="Команда заказа" value={cfg.requestCmd} max={30} onSave={(v) => set({ requestCmd: v })} />
        <TextSetting label="Команда «что играет»" value={cfg.nowCmd} max={30} onSave={(v) => set({ nowCmd: v })} />
        <NumberField label={`Цена (${snap.settings.points.name}, 0 — бесплатно)`} value={cfg.requestCost} min={0} max={10_000_000} onChange={(v) => set({ requestCost: v })} />
        <NumberField label="Заказов у зрителя в очереди" value={cfg.maxPerUser} min={1} max={50} onChange={(v) => set({ maxPerUser: v })} />
        <NumberField label="Трек не длиннее" value={cfg.maxDurationMin} min={1} max={60} suffix="мин" onChange={(v) => set({ maxDurationMin: v })} />
        <NumberField label="Кулдаун зрителя" value={cfg.cooldownSec} min={0} max={3600} suffix="сек" onChange={(v) => set({ cooldownSec: v })} />
      </div>
      <div className="field"><label>Кто может заказывать командой</label><AccessPick value={cfg.requestAccess} onChange={(a) => set({ requestAccess: a })} /></div>
      <TextSetting label="Запрещённые слова в названии или исполнителе (через запятую)" value={cfg.blocked} max={2000} area onSave={(v) => set({ blocked: v })} />
      <p className="small muted" style={{ margin: 0 }}>За баллы Twitch: создайте награду с действием «Заказ трека» в разделе «Награды за баллы» — если трек не найдётся, баллы вернутся.</p>
    </div>
  )
}

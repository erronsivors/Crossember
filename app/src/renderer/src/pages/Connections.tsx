import { useState } from 'react'
import type { ConnStatus, HubSnapshot, Platform } from '../../../main/core/types'
import { Hint, Toggle, errText } from '../components'
import { PlatIcon, fmtTime, useNow } from '../ui'
import { DonationPanel, isDonationService } from './DonationPanels'
import { MemeCard } from './Rewards'

const STATE_LABEL: Record<ConnStatus['state'], string> = { off: 'Не подключено', connecting: 'Подключение…', ok: 'Подключено', error: 'Ошибка' }
const HINT: Partial<Record<Platform, string>> = {
  obs: 'obs', twitch: 'twitch', goodgame: 'goodgame', kick: 'kick', vk: 'vk', youtube: 'youtube',
  donationalerts: 'donationalerts', donatepay: 'donatepay', donatex: 'donatex', boosty: 'boosty'
}

/** Временно выключены: плашки видны, но не нажимаются. */
const PAUSED: Platform[] = ['donatepay', 'donatex']

export function Connections({ snap, initial }: { snap: HubSnapshot; initial?: Platform }) {
  const [sel, setSel] = useState<Platform | 'memealerts'>(initial && !PAUSED.includes(initial) ? initial : 'twitch')
  const cur = snap.connections.find((c) => c.id === sel) ?? snap.connections[0]
  const meme = snap.memealerts
  const active = snap.connections.filter((c) => c.state === 'ok').length

  return (
    <>
      <div className="head">
        <div>
          <h1>Подключения</h1>
          <p>Прямые подключения без посредников. Здесь же видно, что отвалилось и почему.</p>
        </div>
        <div className="actions small muted"><span className="dot ok" /> {active} активно</div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
        <div className="grid g2" style={{ alignContent: 'start' }}>
          {snap.connections.map((c) => {
            const paused = PAUSED.includes(c.id)
            return (
              <div key={c.id} className={`card conn ${sel === c.id ? 'sel' : ''} ${paused ? 'paused' : ''}`} onClick={paused ? undefined : () => setSel(c.id)} title={paused ? 'Временно недоступно' : undefined}>
                <div className="top">
                  <PlatIcon p={c.id} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="name">{c.name}</div>
                    <div className="small muted ellipsis">{paused ? 'Временно недоступно' : c.detail}</div>
                  </div>
                  {!paused && <span className={`dot ${c.state}`} />}
                </div>
              </div>
            )
          })}
          <div className={`card conn ${sel === 'memealerts' ? 'sel' : ''}`} onClick={() => setSel('memealerts')}>
            <div className="top">
              <span className="plat" style={{ background: '#f7b500', color: '#1a1311', fontSize: 14 }}>M</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="name">Memealerts</div>
                <div className="small muted ellipsis">{meme.account ? `Вход выполнен · ${meme.account}` : meme.pending ? 'Вход…' : 'Не подключено'}</div>
              </div>
              <span className={`dot ${meme.error ? 'error' : meme.account ? 'ok' : 'off'}`} />
            </div>
          </div>
        </div>

        {sel === 'memealerts' ? <div style={{ alignSelf: 'start' }}><MemeCard snap={snap} /></div> : <div className="card" style={{ alignSelf: 'start' }}>
          <h3><PlatIcon p={cur.id} /> {cur.name} {HINT[cur.id] && <Hint id={HINT[cur.id]!} />} <span className={`r dot ${cur.state}`} /></h3>
          <p className="muted" style={{ marginTop: 0 }}>{cur.id === 'goodgame' || cur.id === 'vk' ? STATE_LABEL[cur.state] : `${STATE_LABEL[cur.state]} · ${cur.detail}`}</p>
          {cur.id === 'obs' && <ObsForm snap={snap} />}
          {cur.id === 'twitch' && <TwitchPanel snap={snap} />}
          {cur.id === 'youtube' && <YoutubePanel snap={snap} />}
          {(cur.id === 'goodgame' || cur.id === 'kick' || cur.id === 'vk') && <ChannelPanel key={cur.id} id={cur.id} snap={snap} />}
          {isDonationService(cur.id) && <DonationPanel key={cur.id} id={cur.id} snap={snap} />}
          <h3 style={{ marginTop: 20 }}>Журнал</h3>
          <div className="log">
            {cur.log.length ? cur.log.map((l, i) => (
              <div key={i} className={l.level}><time>{fmtTime(l.ts)}</time>{l.text}</div>
            )) : <div className="muted">Пусто</div>}
          </div>
        </div>}
      </div>
    </>
  )
}

function TwitchPanel({ snap }: { snap: HubSnapshot }) {
  const t = snap.twitch
  const s = snap.settings.twitch
  const now = useNow()
  const [err, setErr] = useState<string | null>(null)
  const [clientId, setClientId] = useState(s.customClientId)
  const [advanced, setAdvanced] = useState(false)

  const login = (role: 'broadcaster' | 'bot'): void => {
    setErr(null)
    window.hub.twitchLogin(role).catch((e) => setErr(errText(e)))
  }

  return (
    <div>
      {t.clientIdSource === 'none' && (
        <div className="note warnbox" style={{ marginBottom: 12 }}>
          В этой сборке ещё нет общего Client ID. Укажите свой ниже («Для опытных») — инструкция в подсказке «!».
        </div>
      )}

      {t.pending ? (
        <div className="note" style={{ marginBottom: 12 }}>
          <b>Подтвердите вход в Twitch{t.pending.role === 'bot' ? ' под аккаунтом бота' : ''}</b>
          <p style={{ margin: '8px 0' }}>Страница Twitch открылась в браузере. Если нет — откройте <b>twitch.tv/activate</b> и введите код:</p>
          <div className="code">{t.pending.userCode}</div>
          <p className="small muted">Осталось {Math.max(0, Math.round((t.pending.expiresAt - now) / 60000))} мин.</p>
          <button className="btn sm" onClick={() => void window.hub.twitchCancel()}>Отмена</button>
        </div>
      ) : null}

      <div className="row">
        <div className="grow">
          <b>Аккаунт канала</b>
          <span className="small muted" style={{ display: 'block' }}>{t.broadcaster ? `${t.broadcaster.name} · ${t.live ? `в эфире, зрителей: ${t.viewers ?? 0}` : 'не в эфире'}` : 'Не подключён'}</span>
        </div>
        {t.broadcaster
          ? <button className="btn sm" onClick={() => void window.hub.twitchLogout('broadcaster')}>Выйти</button>
          : <button className="btn primary sm" disabled={!!t.pending || t.clientIdSource === 'none'} onClick={() => login('broadcaster')}>Войти</button>}
      </div>

      <div className="row">
        <div className="grow">
          <b>Аккаунт-бот <Hint id="twitchBot" /></b>
          <span className="small muted" style={{ display: 'block' }}>{t.bot ? t.bot.name : 'Не обязателен'}</span>
        </div>
        {t.bot
          ? <button className="btn sm" onClick={() => void window.hub.twitchLogout('bot')}>Отключить</button>
          : <button className="btn sm" disabled={!!t.pending || !t.broadcaster} onClick={() => login('bot')}>Подключить бота</button>}
      </div>

      {t.bot && (
        <div className="field" style={{ marginTop: 12 }}>
          <label>Автоматические сообщения отправлять</label>
          <div className="seg">
            <button className={s.autoSendAs === 'broadcaster' ? 'on' : ''} onClick={() => void window.hub.setSettings({ twitch: { autoSendAs: 'broadcaster' } })}>от канала</button>
            <button className={s.autoSendAs === 'bot' ? 'on' : ''} onClick={() => void window.hub.setSettings({ twitch: { autoSendAs: 'bot' } })}>от бота</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Toggle on={s.thirdPartyEmotes} onChange={(v) => void window.hub.setSettings({ twitch: { thirdPartyEmotes: v } })}
          label={<>Смайлы 7TV, BTTV, FFZ {t.emotes.thirdParty > 0 && <span className="muted small">({t.emotes.thirdParty})</span>} <Hint id="emotes3p" /></>} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        {t.broadcaster && <button className="btn sm" onClick={() => void window.hub.twitchRestart()}>Переподключить</button>}
        <button className="btn sm" onClick={() => setAdvanced(!advanced)}>{advanced ? 'Скрыть' : 'Для опытных'}</button>
      </div>

      {advanced && (
        <div className="field" style={{ marginTop: 12 }}>
          <label>Свой Client ID <Hint id="twitchClientId" /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input mono" style={{ flex: 1 }} value={clientId} onChange={(e) => setClientId(e.target.value.trim())} placeholder="пусто — общее приложение Crossember" spellCheck={false} />
            <button className="btn sm" onClick={() => void window.hub.setSettings({ twitch: { customClientId: clientId } })}>Сохранить</button>
          </div>
          <span className="small muted">Сейчас: {t.clientIdSource === 'custom' ? 'свой Client ID' : t.clientIdSource === 'shared' ? 'общее приложение Crossember' : 'не задан'}. После смены Client ID нужно войти заново.</span>
        </div>
      )}
      {err && <p className="small" style={{ color: '#ff7a84' }}>{err}</p>}
    </div>
  )
}

function YoutubePanel({ snap }: { snap: HubSnapshot }) {
  const y = snap.youtube
  const [err, setErr] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [clientId, setClientId] = useState(snap.settings.youtube.customClientId)
  const [secret, setSecret] = useState('')

  const saveCustom = async (): Promise<void> => {
    setErr(null)
    try {
      if (secret) await window.hub.youtubeSecret(secret)
      await window.hub.setSettings({ youtube: { customClientId: clientId } })
      setSecret('')
    } catch (e) {
      setErr(errText(e))
    }
  }

  return (
    <div>
      {y.clientIdSource === 'none' && (
        <div className="note warnbox" style={{ marginBottom: 12 }}>
          В этой сборке ещё нет общего входа Google. Укажите свой Client ID ниже («Для опытных») — инструкция в подсказке «!».
        </div>
      )}
      {y.pending && (
        <div className="note" style={{ marginBottom: 12 }}>
          <b>Подтвердите вход в Google</b>
          <p style={{ margin: '8px 0' }}>Страница Google открылась в браузере на этом ПК. Выберите аккаунт с YouTube-каналом и разрешите доступ.</p>
          <button className="btn sm" onClick={() => void window.hub.youtubeCancel()}>Отмена</button>
        </div>
      )}
      <div className="row">
        <div className="grow">
          <b>Канал YouTube</b>
          <span className="small muted" style={{ display: 'block' }}>{y.account ? `${y.account.name} · ${y.live ? `в эфире, зрителей: ${y.viewers ?? 0}` : 'ждём эфир'}` : 'Не подключён'}</span>
        </div>
        {y.account
          ? <button className="btn sm" onClick={() => void window.hub.youtubeLogout()}>Выйти</button>
          : <button className="btn primary sm" disabled={y.pending || y.clientIdSource === 'none'} onClick={() => { setErr(null); window.hub.youtubeLogin().catch((e) => setErr(errText(e))) }}>Войти</button>}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        {y.account && <button className="btn sm" onClick={() => void window.hub.reconnect('youtube')}>Переподключить</button>}
        <button className="btn sm" onClick={() => setAdvanced(!advanced)}>{advanced ? 'Скрыть' : 'Для опытных'}</button>
      </div>
      {advanced && (
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <label>Свой Client ID Google <Hint id="youtubeClientId" /></label>
            <input className="input mono" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} placeholder="пусто — общее приложение Crossember" spellCheck={false} />
          </div>
          <div className="field">
            <label>Client secret {y.hasCustomSecret ? '(сохранён и зашифрован — введите новый, чтобы заменить)' : ''}</label>
            <input className="input mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value.trim())} placeholder="GOCSPX-…" spellCheck={false} />
          </div>
          <button className="btn sm" onClick={() => void saveCustom()}>Сохранить</button>
          <span className="small muted" style={{ display: 'block', marginTop: 6 }}>Сейчас: {y.clientIdSource === 'custom' ? 'свой Client ID' : y.clientIdSource === 'shared' ? 'общее приложение Crossember' : 'не задан'}. После смены Client ID нужно войти заново.</span>
        </div>
      )}
      {err && <p className="small" style={{ color: '#ff7a84' }}>{err}</p>}
    </div>
  )
}

function ObsForm({ snap }: { snap: HubSnapshot }) {
  const [url, setUrl] = useState(snap.obsConfig.url)
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (clear = false): Promise<void> => {
    setBusy(true)
    setMsg(null)
    try {
      await window.hub.obsConfigure(url, clear ? '' : pass || undefined)
      setPass('')
      setMsg(clear ? 'Пароль удалён' : 'Сохранено')
    } catch (e) {
      setMsg(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="field">
        <label>Адрес obs-websocket</label>
        <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
      </div>
      <div className="field">
        <label>Пароль {snap.obsConfig.hasPassword ? '(сохранён и зашифрован — введите новый, чтобы заменить)' : ''}</label>
        <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={snap.obsConfig.hasPassword ? '••••••••' : 'OBS → Инструменты → Настройки сервера WebSocket'} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn primary sm" disabled={busy} onClick={() => void save()}>Сохранить и подключить</button>
        <button className="btn sm" disabled={busy} onClick={() => void window.hub.obsReconnect()}>Переподключить</button>
        {snap.obsConfig.hasPassword && <button className="btn sm" disabled={busy} onClick={() => void save(true)}>Удалить пароль</button>}
      </div>
      {msg && <p className="small muted">{msg}</p>}
    </div>
  )
}

/** Kick: ник канала (чат читается без входа) + вход. GoodGame и VK: только вход — канал берётся из аккаунта. */
function ChannelPanel({ id, snap }: { id: 'goodgame' | 'kick' | 'vk'; snap: HubSnapshot }) {
  const saved = snap.settings[id].channel
  const [nick, setNick] = useState(saved)
  const p = snap.platforms.find((x) => x.id === id)
  const site = id === 'goodgame' ? 'goodgame.ru/ник' : id === 'kick' ? 'kick.com/ник' : 'live.vkvideo.ru/ник'
  const auth = id === 'vk' ? snap.vkAuth : id === 'goodgame' ? snap.ggAuth : null
  const account = auth?.account ?? null
  // Без приложения для входа (нет общего в сборке и не задано своё) остаётся чтение по нику.
  const byLogin = !!auth?.available
  if (id === 'goodgame') return <AppLogin p="goodgame" a={snap.ggAuth} />
  return (
    <div>
      {byLogin && saved && (
        <div className="btnrow">
          <span className="small">Канал: <b>{saved}</b></span>
          {/* Канал, подключённый раньше по нику, без входа: можно отключить отдельно. */}
          {!account && <button className="btn sm" onClick={() => void window.hub.setSettings({ [id]: { channel: '' } })}>Отключить</button>}
        </div>
      )}
      {!byLogin && <div className="field">
        <label>Ник канала (как в ссылке {site})</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" style={{ flex: 1 }} value={nick} onChange={(e) => setNick(e.target.value)} placeholder="например, erron" spellCheck={false} />
          <button className="btn primary sm" disabled={nick.trim() === saved} onClick={() => void window.hub.setSettings({ [id]: { channel: nick } })}>Сохранить</button>
          {saved && <button className="btn sm" onClick={() => { setNick(''); void window.hub.setSettings({ [id]: { channel: '' } }) }}>Отключить</button>}
        </div>
        <span className="small muted">Можно вставить ссылку на канал целиком — Crossember сам возьмёт ник.</span>
      </div>}
      {p?.configured && <p className="small muted">{p.live ? 'В эфире · зрителей: ' + (p.viewers ?? 0) : 'Не в эфире'} · {SEND_NOTE[id](snap)}</p>}
      {saved && <button className="btn sm" onClick={() => void window.hub.reconnect(id)}>Переподключить</button>}
      {id === 'kick' && <AppLogin p="kick" a={snap.kickAuth} />}
      {id === 'vk' && <AppLogin p="vk" a={snap.vkAuth} />}
    </div>
  )
}

const SEND_NOTE: Record<'goodgame' | 'kick' | 'vk', (snap: HubSnapshot) => string> = {
  kick: (s) => (s.kickAuth.canChat ? 'писать в чат можно из Crossember' : 'чтобы писать в чат из Crossember, войдите в Kick ниже'),
  vk: (s) => (s.vkAuth.canChat ? 'писать в чат можно из Crossember во время эфира' : 'чтобы писать в чат из Crossember, войдите в VK Видео Live ниже'),
  goodgame: (s) => (s.ggAuth.canChat ? 'писать в чат можно из Crossember' : 'чтобы писать в чат из Crossember, войдите в GoodGame ниже')
}

type AppPlatform = 'kick' | 'vk' | 'goodgame'
/** Как один раз завести своё приложение на площадке — простыми словами. */
const APP_SETUP: Record<AppPlatform, { name: string; url: string; where: string; secret: 'need' | 'optional' }> = {
  kick: { name: 'Kick', url: 'https://kick.com/settings/developer', where: 'На kick.com откройте настройки → Developer и создайте приложение (любое название).', secret: 'need' },
  vk: { name: 'VK Видео Live', url: 'https://dev.live.vkvideo.ru/apps', where: 'На dev.live.vkvideo.ru войдите через VK ID, откройте «Приложения» и создайте приложение. Отметьте права: отправка сообщений в чат и настройки трансляции.', secret: 'optional' },
  goodgame: { name: 'GoodGame', url: 'https://goodgame.ru/', where: 'На goodgame.ru откройте адрес goodgame.ru/user/ВАШ_ID/oauth2 (ID — число в ссылке на ваш профиль) и добавьте приложение.', secret: 'need' }
}
const LOGIN: Record<AppPlatform, { login: () => Promise<unknown>; cancel: () => Promise<unknown>; logout: () => Promise<unknown> }> = {
  kick: { login: () => window.hub.kickLogin(), cancel: () => window.hub.kickCancel(), logout: () => window.hub.kickLogout() },
  vk: { login: () => window.hub.vkLogin(), cancel: () => window.hub.vkCancel(), logout: () => window.hub.vkLogout() },
  goodgame: { login: () => window.hub.ggLogin(), cancel: () => window.hub.ggCancel(), logout: () => window.hub.ggLogout() }
}

/** Вход в Kick / VK Видео Live / GoodGame: сообщения в чат и смена названия и категории эфира (чат читается и без входа). */
function AppLogin({ p, a }: { p: AppPlatform; a: HubSnapshot['kickAuth'] }) {
  const cfg = APP_SETUP[p]
  const act = LOGIN[p]
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [clientId, setClientId] = useState(a.customId)
  const [secret, setSecret] = useState('')
  const [copied, setCopied] = useState(false)
  const login = (): void => { setErr(null); act.login().catch((e) => setErr(errText(e))) }
  const saveApp = (id: string): void => {
    setErr(null)
    window.hub.oauthApp(p, id, secret).then(() => { setSecret(''); setOpen(false) }).catch((e) => setErr(errText(e)))
  }
  // Реквизиты приложения не загромождают карточку, но остаются доступны для восстановления входа.
  const setup = open
  return (
    <div className="field" style={{ marginTop: 18 }}>
      <label>{p === 'kick' ? 'Чат и название эфира' : 'Вход в аккаунт — чат, сообщения и название эфира'}</label>
      {!a.available && <p className="small muted">Вход пока не настроен. Если он работал раньше, после восстановления данных могли потеряться настройки приложения. Откройте «Продвинутая настройка» и укажите прежнее приложение с сайта площадки, затем войдите заново.</p>}
      {a.available && (a.account
        ? <div className="btnrow"><span className="small">Вход выполнен: <b>{a.account}</b></span><button className="btn sm" onClick={() => void act.logout()}>Выйти</button></div>
        : a.pending
          ? <div className="btnrow"><span className="small muted">Подтвердите вход в открывшемся браузере…</span><button className="btn sm" onClick={() => void act.cancel()}>Отмена</button></div>
          : <div className="btnrow"><button className="btn sm primary" onClick={login}>Войти в {cfg.name}</button><span className="small muted">чтобы писать в чат и менять название и игру из Crossember</span></div>)}
      {a.account && a.needRelogin && (
        <div className="note warnbox" style={{ marginTop: 8 }}>Crossember нужно новое разрешение (писать в чат). Выйдите и войдите в {cfg.name} заново — один раз.</div>
      )}
      {setup && (
        <div className="note" style={{ marginTop: 8 }}>
          {!a.available && <p className="small" style={{ marginTop: 0 }}>Чтобы входить в {cfg.name} одной кнопкой, один раз подключите своё приложение {cfg.name} — это бесплатно и займёт пару минут.</p>}
          <ol className="small" style={{ margin: '0 0 10px', paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>{cfg.where} <button className="btn sm" onClick={() => void window.hub.openExternal(cfg.url)}>Открыть сайт</button></li>
            <li>
              В поле «адрес возврата» (Redirect URI) вставьте: <span className="mono">{a.redirect}</span>{' '}
              <button className="btn sm" onClick={() => { void window.hub.copy(a.redirect); setCopied(true) }}>{copied ? 'Скопировано' : 'Копировать'}</button>
            </li>
            <li>Скопируйте с сайта {cfg.secret === 'need' ? 'Client ID и секрет (Client Secret)' : 'Client ID (секрет не нужен)'} и вставьте ниже.</li>
          </ol>
          <div className="field">
            <label>Client ID</label>
            <input className="input mono" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} spellCheck={false} />
          </div>
          {cfg.secret === 'need' && (
            <div className="field">
              <label>Client Secret {a.hasCustom ? '(сохранён — введите новый, чтобы заменить)' : ''}</label>
              <input className="input mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value.trim())} spellCheck={false} />
            </div>
          )}
          <div className="btnrow">
            <button className="btn sm primary" disabled={!clientId} onClick={() => saveApp(clientId)}>Сохранить</button>
            {a.hasCustom && a.source === 'custom' && <button className="btn sm" onClick={() => { setClientId(''); saveApp('') }}>Убрать своё приложение</button>}
          </div>
          <span className="small muted" style={{ display: 'block', marginTop: 6 }}>Секрет хранится зашифрованным только на этом ПК. После смены приложения нужно войти заново.</span>
        </div>
      )}
      <div style={{ marginTop: 8 }}><button className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Скрыть продвинутую настройку' : 'Продвинутая настройка'}</button></div>
      {err && <span className="small" style={{ color: '#ff7a84' }}>{err}</span>}
    </div>
  )
}

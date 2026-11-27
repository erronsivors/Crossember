import { useEffect, useState } from 'react'
import type { HubSnapshot } from '../../main/core/types'
import type { BotPlatform, BotProfile, BotProfileView } from '../../main/core/botaccounttypes'
import { Toggle, errText } from './components'

/** Один список для всех площадок: отметка по нику и независимый вход — разные действия. */
export function BotProfilesPanel({ snap, platform }: { snap: HubSnapshot; platform: BotPlatform }) {
  const profiles = (snap.botAccounts?.profiles ?? []).filter((p) => p.platform === platform)
  const selected = snap.botAccounts?.senders[platform] ?? ''
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const wrap = (p: Promise<unknown>): void => { setError(null); p.catch((e) => setError(errText(e))) }
  const add = async (): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await window.hub.botProfileAdd(platform, name.trim())
      setName('')
      setAdding(false)
    } catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }
  return <section style={{ borderTop: '1px solid var(--line-2)', paddingTop: 18, marginTop: 20 }}>
    <h3>Боты и отдельные профили</h3>
    <p className="small muted">Добавьте ник бота или обычного человека, например модератора. Отметка по нику работает без входа. Для отправки сообщений от этого профиля отдельно войдите в его аккаунт — это не меняет основной канал.</p>
    {profiles.length > 0 && <div className="field">
      <label>Автоматические сообщения на этой площадке</label>
      <select className="input" value={selected} onChange={(e) => wrap(window.hub.botProfileSender(platform, e.target.value || null))}>
        <option value="">От основного аккаунта{platform === 'twitch' ? ' / прежняя настройка Twitch' : ''}</option>
        {profiles.map((p) => <option key={p.id} value={p.id} disabled={!p.auth.account}>{p.auth.account ?? p.name}{p.auth.account ? '' : ' — сначала войдите'}</option>)}
      </select>
      <p className="small muted">Выбран один отправитель: бот не дублирует каждый ответ со всех добавленных аккаунтов. Получение сообщений остаётся у основного канала.</p>
    </div>}
    <div style={{ display: 'grid', gap: 12 }}>
      {profiles.map((p) => <ProfileRow key={p.id} p={p} wrap={wrap} />)}
    </div>
    {adding ? <form style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); void add() }}>
      <label className="small" htmlFor={`bot-name-${platform}`}>Ник или имя профиля</label>
      <input id={`bot-name-${platform}`} className="input" value={name} autoFocus maxLength={100} placeholder="Например, Nightbot или ник модератора" onChange={(e) => setName(e.target.value)} />
      <div className="btnrow" style={{ marginTop: 8 }}>
        <button className="btn sm primary" disabled={busy || !name.trim()} type="submit">Добавить</button>
        <button className="btn sm" type="button" disabled={busy} onClick={() => { setAdding(false); setName('') }}>Отмена</button>
      </div>
    </form> : <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>{profiles.length ? '+ Добавить ещё бота' : '+ Добавить бота'}</button>}
    {error && <p role="alert" className="small" style={{ color: 'var(--bad, #ff6e7f)' }}>{error}</p>}
  </section>
}

function ProfileRow({ p, wrap }: { p: BotProfileView; wrap: (p: Promise<unknown>) => void }) {
  const [name, setName] = useState(p.name)
  useEffect(() => setName(p.name), [p.name])
  const [sure, setSure] = useState(false)
  const update = (patch: Partial<BotProfile>): void => wrap(window.hub.botProfileUpdate(p.id, patch))
  return <div style={{ border: '1px solid var(--line-2)', borderRadius: 10, padding: 12, minWidth: 0 }}>
    <div className="btnrow" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <b style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{p.name}{p.selected && <span className="chip" style={{ marginLeft: 8 }}>Отправитель</span>}</b>
      <span className="small muted">{p.auth.account ? `Вход: ${p.auth.account}` : p.auth.pending ? 'Вход ожидает подтверждения' : 'Только отметка по нику'}</span>
    </div>
    <div className="field" style={{ marginTop: 10 }}>
      <label>Ник для исключений</label>
      <input className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onBlur={() => {
        const value = name.trim()
        if (!value) setName(p.name)
        else if (value !== p.name) update({ name: value })
      }} />
    </div>
    <Toggle on={p.excludeAnalytics} onChange={(v) => update({ excludeAnalytics: v })} label="Не учитывать в аналитике зрителей" />
    <Toggle on={p.excludePoints} onChange={(v) => update({ excludePoints: v })} label="Не начислять очки и исключить из рейтинга" />
    <Toggle on={p.hideChat} onChange={(v) => update({ hideChat: v })} label="Скрывать сообщения в оверлеях чата" />
    <p className="small muted">Настройки действуют только на этой площадке. Обычный мультичат остаётся видимым; прошлые балансы и история не удаляются. Сводки уже завершённых эфиров не пересчитываются.</p>
    {p.auth.device && <div className="note">
      <b>Подтвердите вход под нужным аккаунтом</b>
      <div className="btnrow" style={{ marginTop: 8 }}>
        <code>{p.auth.device.userCode}</code>
        <button className="btn sm" onClick={() => wrap(window.hub.copy(p.auth.device!.userCode))}>Копировать код</button>
        <button className="btn sm" onClick={() => wrap(window.hub.openExternal(p.auth.device!.uri))}>Открыть подтверждение ↗</button>
      </div>
    </div>}
    {p.auth.error && <p className="small" role="alert" style={{ color: 'var(--bad, #ff6e7f)' }}>{p.auth.error}</p>}
    {!p.auth.available && <p className="small muted">Вход для площадки пока не настроен. Сначала настройте её основное подключение. Отметка по нику и исключения уже доступны.</p>}
    <div className="btnrow" style={{ marginTop: 10, flexWrap: 'wrap' }}>
      {p.auth.pending
        ? <button className="btn sm" onClick={() => wrap(window.hub.botProfileCancel(p.id))}>Отменить вход</button>
        : <button className="btn sm" disabled={!p.auth.available} onClick={() => wrap(window.hub.botProfileLogin(p.id))}>{p.auth.account ? 'Войти заново' : 'Войти в аккаунт'}</button>}
      {p.auth.account && <>
        <button className="btn sm" onClick={() => wrap(window.hub.botProfileSender(p.platform, p.selected ? null : p.id))}>{p.selected ? 'Убрать как отправителя' : 'Отправлять от этого профиля'}</button>
        <button className="btn sm" onClick={() => wrap(window.hub.botProfileLogout(p.id))}>Выйти из аккаунта</button>
      </>}
      {!sure ? <button className="btn sm" onClick={() => setSure(true)}>Удалить профиль</button> : <>
        <button className="btn sm danger" onClick={() => wrap(window.hub.botProfileRemove(p.id))}>Да, удалить</button>
        <button className="btn sm" onClick={() => setSure(false)}>Отмена</button>
      </>}
    </div>
  </div>
}

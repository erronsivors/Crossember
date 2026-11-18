import { useEffect, useState } from 'react'
import type { HubSnapshot } from '../../main/core/types'
import { CHANGELOG } from './changelog'
import { errText } from './components'
import mark from './assets/mark.svg'

/** a ≥ b по номеру версии (1.2.10 > 1.2.9): >0, =0, <0. Будущие версии из журнала не показываем. */
function newer(a: string, b: string): number {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  return 0
}

/** Справка → Что нового: журнал версий, текущая отмечена. */
export function WhatsNew({ current }: { current: string }) {
  return (
    <>
      <div className="head"><div><h1>Что нового</h1><p>Коротко о том, что менялось в каждой версии. У вас установлена {current}.</p></div></div>
      <div className="changelog">
        {CHANGELOG.filter((e) => newer(current, e.version) >= 0).map((e) => (
          <div key={e.version} className={`card cl-entry ${e.version === current ? 'cur' : ''}`}>
            <h3>Версия {e.version} <span className="small muted">{e.date}</span>{e.version === current && <span className="chip">установлена</span>}</h3>
            {e.fixed?.length ? <><div className="cl-sec">Исправления</div><ul>{e.fixed.map((t, i) => <li key={i}>{t}</li>)}</ul></> : null}
            {e.added?.length ? <><div className="cl-sec">Нововведения</div><ul>{e.added.map((t, i) => <li key={i}>{t}</li>)}</ul></> : null}
            {e.items?.length ? <ul>{e.items.map((t, i) => <li key={i}>{t}</li>)}</ul> : null}
          </div>
        ))}
      </div>
    </>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal narrow">
        <h2>{title}</h2>
        {children}
        <div className="modal-actions"><button className="btn" onClick={onClose}>Закрыть</button></div>
      </div>
    </div>
  )
}

/** Справка → О программе. */
export function AboutModal({ snap, onClose }: { snap: HubSnapshot; onClose: () => void }) {
  return (
    <Modal title="О программе" onClose={onClose}>
      <div className="brand" style={{ padding: 0, margin: '4px 0 14px' }}>
        <img src={mark} alt="" />
        <div><b>Crossember {snap.update.current}</b><small>made by erron for friends</small></div>
      </div>
      <p className="muted">Всё для эфира в одной программе: мультичат, события и донаты, алерты, оверлеи для OBS, интерактив и бот. Работает на вашем ПК, без серверов-посредников: площадки и донат-сервисы подключаются напрямую.</p>
      <p className="small muted">Исходный код и выпуски: <a href="https://github.com/erronsivors/Crossember" target="_blank" rel="noreferrer">github.com/erronsivors/Crossember</a></p>
      {snap.feedback.email && <p className="small muted">Связь с автором: {snap.feedback.email} или «Справка → Обратная связь».</p>}
    </Modal>
  )
}

/** Справка → Проверить обновления. */
export function UpdatesModal({ snap, onClose }: { snap: HubSnapshot; onClose: () => void }) {
  const u = snap.update
  const text = u.status === 'checking' ? 'Проверяю…'
    : u.status === 'available' ? `Есть новая версия ${u.version}.`
      : u.status === 'downloading' ? `Скачиваю версию ${u.version}: ${u.percent}%`
        : u.status === 'ready' ? `Версия ${u.version} скачана и готова к установке.`
          : u.status === 'error' ? u.error
            : u.latest ? 'Установлена последняя версия.' : 'Нажмите «Проверить сейчас».'
  return (
    <Modal title="Обновления" onClose={onClose}>
      <div className="kv"><div><span>У вас</span><b className="mono" style={{ fontSize: 15 }}>{u.current}</b></div></div>
      <p>{text}</p>
      <div className="btnrow">
        <button className="btn sm" disabled={u.status === 'checking' || u.status === 'downloading'} onClick={() => void window.hub.updateCheck()}>Проверить сейчас</button>
        {(u.status === 'available' || u.status === 'error') && <button className="btn sm primary" onClick={() => { void window.hub.updateDownload(); onClose() }}>Скачать</button>}
        {u.status === 'ready' && <button className="btn sm primary" onClick={() => void window.hub.updateInstall()}>Установить и перезапустить</button>}
      </div>
      <p className="small muted">Обновления приходят с GitHub, каждое подписано ключом автора: подменённую версию программа не поставит. В версии для разработки проверка не работает.</p>
    </Modal>
  )
}

/** Файл → Профили: наборы настроек, правил и шаблонов под именем, переключение одним нажатием. */
export function ProfilesModal({ snap, onClose }: { snap: HubSnapshot; onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [ask, setAsk] = useState<string | null>(null)
  const { named, current } = snap.profile
  const run = (p: Promise<unknown>, ok: string): void => {
    setBusy(true)
    setMsg(null)
    p.then(() => setMsg({ ok: true, text: ok })).catch((e) => setMsg({ ok: false, text: errText(e) })).finally(() => setBusy(false))
  }
  return (
    <Modal title="Профили" onClose={onClose}>
      <p className="small muted" style={{ marginTop: -4 }}>
        Профиль — это настройки, правила, счётчики и шаблоны алертов. Например, «Стрим», «Турнир», «Без донатов».
        При переключении текущий профиль сохраняется сам. Подключения к площадкам, картинки и звуки — общие для всех профилей.
      </p>
      {named.length ? (
        <div className="prof-list">
          {named.map((p) => (
            <div key={p.name} className={`prof-row ${p.name === current ? 'cur' : ''}`}>
              <div className="grow"><b>{p.name}</b>{p.name === current && <span className="chip">сейчас</span>}<div className="small muted">сохранён {new Date(p.savedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></div>
              {p.name !== current && <button className="btn sm primary" disabled={busy} onClick={() => run(window.hub.profileSwitch(p.name), `Включён профиль «${p.name}»`)}>Включить</button>}
              <button className="btn sm" disabled={busy} title="Записать в этот профиль то, что настроено сейчас" onClick={() => run(window.hub.profileSave(p.name), `Профиль «${p.name}» перезаписан`)}>Перезаписать</button>
              {ask === p.name
                ? <button className="btn sm danger" disabled={busy} onClick={() => { setAsk(null); run(window.hub.profileRemove(p.name), `Профиль «${p.name}» удалён`) }}>Удалить?</button>
                : <button className="btn sm" disabled={busy} title="Удалить профиль" onClick={() => { setAsk(p.name); setTimeout(() => setAsk((a) => (a === p.name ? null : a)), 3000) }}>✕</button>}
            </div>
          ))}
        </div>
      ) : <p className="small muted">Профилей пока нет — сохраните текущее состояние под именем.</p>}
      <div className="field" style={{ marginTop: 12 }}>
        <label>Сохранить то, что настроено сейчас, как новый профиль</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" style={{ flex: 1 }} value={name} maxLength={40} placeholder="Например: Турнир" onChange={(e) => setName(e.target.value)} />
          <button className="btn sm primary" disabled={busy || !name.trim()} onClick={() => { run(window.hub.profileSave(name), `Сохранён профиль «${name.trim()}»`); setName('') }}>Сохранить</button>
        </div>
      </div>
      {msg && <p className={`note ${msg.ok ? '' : 'err'}`}>{msg.text}</p>}
      <p className="small muted">Перед каждым переключением делается резервная копия: «Настройки → Профиль → Вернуть как было».</p>
    </Modal>
  )
}

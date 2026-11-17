import type { UpdateState } from '../../main/core/updater'

const run = (p: Promise<unknown>): void => { p.catch(() => undefined) }

/** Окно обновления: «есть новая версия» → процент скачивания → «что нового» и установка. «Позже» прячет окно в строку меню. */
export function UpdateModal({ u }: { u: UpdateState }) {
  if (u.later || !['available', 'downloading', 'ready', 'error'].includes(u.status)) return null
  const later = (): void => run(window.hub.updateLater())
  return (
    <div className="modal-back">
      <div className="modal narrow upd">
        {u.status === 'available' && <>
          <h2>Есть новая версия</h2>
          <p className="muted">Crossember {u.version} (сейчас у вас {u.current}). Скачать сейчас или позже? Настройки, подключения и шаблоны сохранятся.</p>
          <div className="modal-actions">
            <button className="btn" onClick={later}>Позже</button>
            <button className="btn primary" onClick={() => run(window.hub.updateDownload())}>Скачать сейчас</button>
          </div>
        </>}
        {u.status === 'downloading' && <>
          <h2>Скачиваю версию {u.version}</h2>
          <Progress percent={u.percent} />
          <div className="modal-actions">
            <button className="btn" onClick={later}>Скрыть, качать в фоне</button>
          </div>
        </>}
        {u.status === 'ready' && <>
          <h2>Что нового в {u.version}</h2>
          {u.notes.length
            ? <ul className="upd-notes">{u.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            : <p className="muted">Описание изменений не указано.</p>}
          {u.error && <p className="note err">{u.error}</p>}
          <p className="small muted">Crossember закроется, установится новая версия и откроется снова. «Позже» — установится при следующем выходе из программы.</p>
          <div className="modal-actions">
            <button className="btn" onClick={later}>Позже</button>
            <button className="btn primary" onClick={() => run(window.hub.updateInstall())}>{u.error ? 'Повторить установку' : 'Установить и перезапустить'}</button>
          </div>
        </>}
        {u.status === 'error' && <>
          <h2>Обновление не скачалось</h2>
          <p className="muted">{u.error || 'Нет связи с GitHub.'}</p>
          <div className="modal-actions">
            <button className="btn" onClick={later}>Позже</button>
            <button className="btn primary" onClick={() => run(window.hub.updateDownload())}>Повторить</button>
          </div>
        </>}
      </div>
    </div>
  )
}

/** Строка в меню под «Обратной связью» — пока обновление не установлено. */
export function UpdateNav({ u }: { u: UpdateState }) {
  if (!['available', 'downloading', 'ready', 'error'].includes(u.status)) return null
  return (
    <div className="upd-nav">
      <span>Обновление {u.version}</span>
      {u.status === 'downloading'
        ? <Progress percent={u.percent} small />
        : u.status === 'ready'
          ? <button className="btn sm primary" onClick={() => run(window.hub.updateInstall())}>Установить</button>
          : <button className="btn sm primary" onClick={() => run(window.hub.updateDownload())}>{u.status === 'error' ? 'Повторить' : 'Скачать'}</button>}
    </div>
  )
}

function Progress({ percent, small }: { percent: number; small?: boolean }) {
  return (
    <div className={`upd-progress ${small ? 'sm' : ''}`} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="upd-bar"><div style={{ width: `${percent}%` }} /></div>
      <b>{percent}%</b>
    </div>
  )
}

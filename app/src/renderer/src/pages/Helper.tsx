import { useState } from 'react'
import type { HubSnapshot } from '../../../main/core/types'
import { parseHelperUrl } from '../../../main/core/keyslayout'
import mark from '../assets/mark.svg'

/** Игровой ПК в режиме «Помощник»: одна ссылка со стрим-ПК, статус и выход в полную версию. */
export function Helper({ snap }: { snap: HubSnapshot }) {
  const saved = snap.settings.helper.url
  const [link, setLink] = useState(saved)
  const [askLeave, setAskLeave] = useState(false)
  const h = snap.keyHelper
  const valid = parseHelperUrl(link) !== null
  const save = (): void => void window.hub.setSettings({ helper: { url: link.trim() } })

  const status = !saved ? 'Вставьте ссылку со стрим-ПК.'
    : h.status === 'ok' ? (h.capturing ? 'Подключено. Нажатия передаются на стрим-ПК.' : 'Подключено. Ждём: на стрим-ПК оверлей «Клавиатура» закрыт или показ нажатий выключен.')
      : h.status === 'connecting' ? 'Подключаемся к стрим-ПК…'
        : h.error ?? 'Нет связи со стрим-ПК.'
  const dot = h.status === 'ok' ? (h.capturing ? 'live' : 'ok') : h.status === 'connecting' ? '' : 'error'

  return (
    <div className="helper-page">
      <div className="card helper-card">
        <div className="brand" style={{ padding: 0, marginBottom: 18 }}>
          <img src={mark} alt="" />
          <div>
            <b>Crossember</b>
            <small>помощник для игрового ПК</small>
          </div>
        </div>
        <h2 style={{ marginTop: 0 }}>Этот ПК — игровой</h2>
        <p className="muted">
          Crossember здесь только передаёт нажатия клавиш и мыши на стрим-ПК для оверлея «Клавиатура и мышь».
          Чат, алерты и всё остальное работают на стрим-ПК.
        </p>
        <div className="field">
          <label>Ссылка со стрим-ПК</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" style={{ flex: 1 }} value={link} maxLength={300} placeholder="http://192.168.…/kws?k=…" onChange={(e) => setLink(e.target.value)} />
            <button className="btn primary" disabled={!valid || link.trim() === saved} onClick={save}>Подключить</button>
          </div>
          <span className="small muted">На стрим-ПК: Crossember → «Оверлеи для OBS» → «Клавиатура и мышь» → «Ссылка для игрового ПК».</span>
          {link.trim() !== '' && !valid && <span className="small" style={{ color: 'var(--danger-ink)' }}>Это не похоже на ссылку для игрового ПК.</span>}
        </div>
        <div className="helper-status"><span className={`dot ${dot}`} /> {status}</div>
        <p className="small muted">
          Нажатия уходят только на стрим-ПК в вашей домашней сети и только те клавиши, что нарисованы на оверлее. Ничего не записывается.
          Нарисованные буквы загораются при любом наборе, в том числе паролей: перед вводом пароля в эфире выключите показ на стрим-ПК.
          Окно можно свернуть — помощник работает, пока Crossember запущен.
        </p>
        <div className="btnrow">
          {askLeave ? (
            <>
              <span className="small">Открыть полную версию на этом ПК?</span>
              <button className="btn sm" onClick={() => void window.hub.setSettings({ role: 'main' })}>Да</button>
              <button className="btn sm" onClick={() => setAskLeave(false)}>Нет</button>
            </>
          ) : <button className="btn sm" onClick={() => setAskLeave(true)}>Это не игровой ПК</button>}
        </div>
      </div>
    </div>
  )
}

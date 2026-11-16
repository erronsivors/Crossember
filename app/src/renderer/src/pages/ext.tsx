import { useEffect, useState } from 'react'
import type { HubSnapshot } from '../../../main/core/types'
import type { Access } from '../../../main/core/extsettings'

export type Wrap = (p: Promise<unknown>, after?: (v: unknown) => void) => void

export const num = (n: number): string => Math.round(n).toLocaleString('ru-RU')

/** Ошибка и обёртка для вызовов ядра: одна строка ошибки на экран. */
export function useWrap(): { err: string | null; ok: string | null; wrap: Wrap; say: (t: string) => void; clear: () => void } {
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const wrap: Wrap = (p, after) => {
    setErr(null)
    setOk(null)
    p.then((v) => after?.(v)).catch((e) => setErr(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  }
  return { err, ok, wrap, say: (t) => { setErr(null); setOk(t) }, clear: () => { setErr(null); setOk(null) } }
}

export function Notes({ err, ok }: { err: string | null; ok: string | null }) {
  if (!err && !ok) return null
  return <div className={`note${err ? ' err' : ''}`} style={{ marginBottom: 14 }}>{err ?? ok}</div>
}

/** Текстовая настройка: сохраняется, когда поле теряет фокус. */
export function TextSetting({ label, value, max, placeholder, onSave, area }: { label: string; value: string; max: number; placeholder?: string; onSave: (v: string) => void; area?: boolean }) {
  const [x, setX] = useState(value)
  useEffect(() => setX(value), [value])
  const save = (): void => { if (x.trim() !== value) onSave(x.trim()) }
  return (
    <div className="field">
      <label>{label}</label>
      {area
        ? <textarea className="input" rows={2} value={x} maxLength={max} placeholder={placeholder} onChange={(e) => setX(e.target.value)} onBlur={save} />
        : <input className="input" value={x} maxLength={max} placeholder={placeholder} onChange={(e) => setX(e.target.value)} onBlur={save} />}
    </div>
  )
}

export const ACCESS: { id: Access; label: string }[] = [
  { id: 'all', label: 'Все' }, { id: 'sub', label: 'Подписчики' }, { id: 'vip', label: 'VIP' }, { id: 'mod', label: 'Модераторы' }
]

export function AccessPick({ value, onChange }: { value: Access; onChange: (a: Access) => void }) {
  return (
    <div className="seg">
      {ACCESS.map((a) => <button key={a.id} className={value === a.id ? 'on' : ''} onClick={() => onChange(a.id)}>{a.label}</button>)}
    </div>
  )
}

/** Плашка: для раздела нужен вход в Twitch или новое разрешение. */
export function ScopeNote({ snap, scope, what }: { snap: HubSnapshot; scope: string; what: string }) {
  const a = snap.twitchScopes[scope] ?? 'login'
  if (a === 'ok') return null
  return (
    <div className="note" style={{ marginBottom: 14 }}>
      {a === 'login'
        ? <>Для {what} нужен вход в Twitch — «Подключения» → Twitch → «Войти».</>
        : <>Для {what} нужно новое разрешение Twitch: выйдите и войдите в Twitch заново («Подключения» → Twitch). Это нужно один раз.</>}
    </div>
  )
}

export const PLAT_NAME: Record<string, string> = { twitch: 'Twitch', youtube: 'YouTube', vk: 'VK', kick: 'Kick', goodgame: 'GoodGame', donationalerts: 'DonationAlerts', donatepay: 'DonatePay', donatex: 'DonateX', boosty: 'Boosty', hub: 'Crossember', obs: 'OBS' }

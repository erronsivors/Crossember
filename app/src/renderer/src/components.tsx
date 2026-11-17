import { createContext, useContext, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { SetupMode, Theme } from '../../main/core/settings'
import { hintText } from './hints'

export const ModeContext = createContext<SetupMode | null>(null)

/** Значок «!» с всплывающей подсказкой (наведение или фокус с клавиатуры). */
export function Hint({ id }: { id: string }) {
  const mode = useContext(ModeContext)
  const h = hintText(id, mode)
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const timer = useRef<number | null>(null)
  if (!h) return null
  // Окно подсказки — поверх всего (в body) и целиком в пределах окна: внутри карточек его обрезали края.
  const show = (): void => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const m = 12
    const w = Math.min(340, window.innerWidth - m * 2)
    const left = Math.min(Math.max(m, r.left + r.width / 2 - w / 2), window.innerWidth - w - m)
    const below = window.innerHeight - r.bottom - m - 8
    const above = r.top - m - 8
    const down = below >= 220 || below >= above
    setPos({ left, width: w, maxHeight: Math.max(120, down ? below : above), ...(down ? { top: r.bottom + 8 } : { bottom: window.innerHeight - r.top + 8 }) })
  }
  // Небольшая задержка закрытия: можно перевести мышь на подсказку и прокрутить длинный текст.
  const hide = (): void => { timer.current = window.setTimeout(() => setPos(null), 180) }
  const keep = (): void => { if (timer.current) window.clearTimeout(timer.current) }
  return (
    <span ref={ref} className="hint" tabIndex={0} aria-label={`Подсказка: ${h.title}`} onMouseEnter={() => { keep(); show() }} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      !
      {pos && createPortal(
        <span className="hint-pop" role="tooltip" style={pos} onMouseEnter={keep} onMouseLeave={hide}>
          <b>{h.title}</b>
          {h.body}
        </span>,
        document.body
      )}
    </span>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw" />
      <span>{label}</span>
    </label>
  )
}

export function ThemePicker({ value, onChange }: { value: Theme; onChange: (t: Theme) => void }) {
  return (
    <div className="seg">
      <button className={value === 'general' ? 'on' : ''} onClick={() => onChange('general')}>Общий</button>
      <button className={value === 'campfire' ? 'on' : ''} onClick={() => onChange('campfire')}>У костра</button>
    </div>
  )
}

export function NumberField({ label, value, min, max, onChange, suffix }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  const [v, setV] = useState(String(value))
  return (
    <div className="field">
      <label>{label}</label>
      <div className="numrow">
        <input
          className="input mono"
          type="number"
          min={min}
          max={max}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => {
            const n = Math.min(max, Math.max(min, Number(v) || min))
            setV(String(n))
            if (n !== value) onChange(n)
          }}
        />
        {suffix && <span className="muted small">{suffix}</span>}
      </div>
    </div>
  )
}

/** Превращает «Error invoking remote method 'x': Error: текст» в «текст». */
export function errText(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

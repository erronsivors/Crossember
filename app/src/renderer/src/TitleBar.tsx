import { useEffect, useRef, useState } from 'react'

/** Цвет из CSS (rgb(), color(srgb …) после color-mix) → #rrggbb для кнопок окна Windows. */
function toHex(css: string): string {
  const c = document.createElement('canvas').getContext('2d')
  if (!c) return '#000000'
  c.fillStyle = '#000000'
  c.fillStyle = css
  c.fillRect(0, 0, 1, 1)
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

export type MenuItem = { label: string; hint?: string; on: () => void; disabled?: boolean } | 'sep'
export interface MenuDef { label: string; items?: MenuItem[]; on?: () => void }

/**
 * Верхняя панель окна в цвете темы: «назад / вперёд», меню (как в настольных программах), за пустое место окно
 * перетаскивается; справа — системные кнопки Windows, их цвет подстраивается под панель.
 */
export function TitleBar({ menus, canBack, canFwd, onBack, onFwd }: { menus: MenuDef[]; canBack: boolean; canFwd: boolean; onBack: () => void; onFwd: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    let last = ''
    const sync = (): void => {
      if (!ref.current) return
      const st = getComputedStyle(ref.current)
      const color = toHex(st.backgroundColor)
      const symbol = toHex(st.color)
      if (color + symbol === last) return
      last = color + symbol
      void window.hub.titleBar(color, symbol).catch(() => undefined)
    }
    sync()
    // Тема и схема меняются атрибутами на <html> — тогда перекрасить и кнопки окна.
    const mo = new MutationObserver(sync)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-look', 'data-palette'] })
    return () => mo.disconnect()
  }, [])

  useEffect(() => {
    if (open === null) return
    const close = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      e.stopPropagation()
      setOpen(null)
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', close, true)
    return () => { window.removeEventListener('mousedown', close, true); window.removeEventListener('keydown', close, true) }
  }, [open])

  return (
    <div className="titlebar" ref={ref}>
      <button className="tb-btn tb-arrow" disabled={!canBack} title="Назад (Esc, Ctrl+[, боковая кнопка мыши)" onClick={onBack}>←</button>
      <button className="tb-btn tb-arrow" disabled={!canFwd} title="Вперёд (Ctrl+], боковая кнопка мыши)" onClick={onFwd}>→</button>
      <nav className="tb-menus">
        {menus.map((m, i) => (
          <div key={m.label} className="tb-menu">
            <button
              className={`tb-btn ${open === i ? 'on' : ''}`}
              onClick={() => (m.items ? setOpen(open === i ? null : i) : (setOpen(null), m.on?.()))}
              onMouseEnter={() => { if (open !== null && m.items) setOpen(i) }}
            >{m.label}</button>
            {open === i && m.items && (
              <div className="tb-drop">
                {m.items.map((it, j) => it === 'sep' ? <div key={j} className="tb-sep" /> : (
                  <button key={j} className="tb-item" disabled={it.disabled} onClick={() => { setOpen(null); it.on() }}>
                    <span>{it.label}</span>{it.hint && <span className="tb-hint">{it.hint}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </div>
  )
}

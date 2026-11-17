import { useEffect, useRef } from 'react'
import mark from './assets/mark.svg'

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

/** Верхняя панель окна в цветах темы; за неё окно перетаскивается, справа — кнопки Windows того же цвета. */
export function TitleBar() {
  const ref = useRef<HTMLDivElement>(null)
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
  return (
    <div className="titlebar" ref={ref}>
      <img src={mark} alt="" />
      <span>Crossember</span>
    </div>
  )
}

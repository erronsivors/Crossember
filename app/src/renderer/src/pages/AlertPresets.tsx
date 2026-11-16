import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { HubSnapshot } from '../../../main/core/types'
import type { AlertTemplate } from '../../../main/core/templates'
import { kit, serverUrl, type KitHandle } from '../editors'
import { PRESETS, packTemplate } from '../presets'
import { PACK_CATEGORIES, PACK_MODES, PACK_SETS, type PackSet } from '../../../main/core/alertpack'
import { blankTemplate, previewItem } from './AlertEditor'

/** Живая миниатюра шаблона: стоп-кадр, при наведении — проигрывается (без звука). */
function Thumb({ t, snap, live }: { t: AlertTemplate; snap: HubSnapshot; live: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(0.15)
  const item = useMemo(() => ({ ...(previewItem(t, 'donation', 0) as object), test: false }), [t])
  const theme = snap.settings.overlays.alert.theme
  // Адрес сервера — строкой: снимок состояния обновляется часто, миниатюра не должна из-за этого перезапускаться.
  const base = snap.server ? `${snap.server.baseUrl}|${snap.server.overlayKey}` : ''
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setK(el.clientWidth / 1920))
    ro.observe(el)
    setK(el.clientWidth / 1920)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!stage.current) return
    const url = (s: string): string => serverUrl(snap, s)
    const el = stage.current
    let h: KitHandle | null = null
    let loop: number | undefined
    if (live) {
      const run = (): void => { h?.stop(); h = kit().mount(el, item, { url, theme }) }
      run()
      loop = window.setInterval(run, ((h as KitHandle | null)?.duration ?? 6000) + 900)
    } else h = kit().mount(el, item, { url, theme, paused: true, startAt: 1800 })
    return () => { if (loop) clearInterval(loop); h?.stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, live, theme, base])
  return (
    <div ref={box} className="preset-thumb">
      <div ref={stage} style={{ transform: `scale(${k})`, transformOrigin: '0 0' }} />
    </div>
  )
}

type Section = 'main' | 'vector' | 'text'
const SECTIONS: { id: Section; name: string }[] = [{ id: 'main', name: 'Основные' }, { id: 'vector', name: 'Векторные' }, { id: 'text', name: 'Текстовые' }]
const VECTOR_GROUPS = [...new Set(PRESETS.map((p) => p.group).filter((g): g is string => !!g))]

/** Карточка набора из основного набора: статичная миниатюра, при наведении — анимация; три кнопки стилей. */
function PackCard({ s, snap, installed, onPick }: { s: PackSet; snap: HubSnapshot; installed: boolean; onPick: (t: AlertTemplate) => void }) {
  const [hover, setHover] = useState(false)
  const src = (f: string): string => serverUrl(snap, `/p/${s.id}/${f}`)
  return (
    <div className="preset pack" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="pack-thumb">
        {installed && (hover
          ? <img src={src('anim-classic.webp')} alt="" />
          : <><img className="pf" src={src('frame.png')} alt="" /><img className="ph" src={src('hero.png')} alt="" /></>)}
      </div>
      <b>{s.name}</b>
      <span>{s.action}</span>
      <div className="pack-modes">
        {PACK_MODES.map((m) => <button key={m.id} className="btn sm" onClick={() => onPick(packTemplate(s, m.id))}>{m.name}</button>)}
      </div>
    </div>
  )
}

/** Выбор готового стиля при создании шаблона. */
export function PresetPicker({ snap, onPick, onClose }: { snap: HubSnapshot; onPick: (t: AlertTemplate) => void; onClose: () => void }) {
  const [hover, setHover] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('main')
  const [packCat, setPackCat] = useState(PACK_CATEGORIES[0])
  const [vecGroup, setVecGroup] = useState(VECTOR_GROUPS[0])
  const [err, setErr] = useState('')
  const pack = snap.alertPack
  const samples = useMemo(() => section === 'main' ? [] : PRESETS
    .filter((p) => section === 'vector' ? p.group === vecGroup : !p.group)
    .map((p) => ({ p, t: p.make() })), [section, vecGroup])
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const doImport = (): void => { setErr(''); window.hub.packImport().catch((e: Error) => setErr(e.message)) }
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal wide">
        <h2>Новый шаблон</h2>
        <p className="muted">Выберите готовый стиль — дальше его можно поменять в конструкторе: текст, цвета, анимации, звук, картинки.</p>
        <div className="seg preset-groups">
          {SECTIONS.map((x) => <button key={x.id} className={section === x.id ? 'on' : ''} onClick={() => setSection(x.id)}>{x.name} · {x.id === 'main' ? PACK_SETS.length * 3 : PRESETS.filter((p) => (x.id === 'vector') === !!p.group).length}</button>)}
        </div>
        {section === 'main' && <>
          {(pack.installed < pack.total || pack.importing || err || pack.error) && (
            <div className="note pack-note">
              {pack.importing
                ? <>Импорт набора: {pack.importing.done} из {pack.importing.total}…</>
                : <>
                  {pack.installed === 0 ? 'Картинки основного набора ещё не подключены.' : `Подключено ${pack.installed} из ${pack.total} наборов.`}
                  {' '}Укажите папку Crossember-Alerts (где лежат archives и assets) — файлы скопируются в данные Crossember, около 600 МБ.
                  <button className="btn sm primary" onClick={doImport}>Выбрать папку…</button>
                </>}
              {(err || pack.error) && <div className="small" style={{ marginTop: 6 }}>{err || pack.error}{pack.missing.length > 0 && `: ${pack.missing.slice(0, 3).join('; ')}${pack.missing.length > 3 ? '…' : ''}`}</div>}
            </div>
          )}
          <div className="seg preset-groups sub">
            {PACK_CATEGORIES.map((g) => <button key={g} className={packCat === g ? 'on' : ''} onClick={() => setPackCat(g)}>{g}</button>)}
          </div>
          <div className="preset-grid">
            {PACK_SETS.filter((s) => s.category === packCat).map((s) => <PackCard key={s.id} s={s} snap={snap} installed={pack.installed > 0} onPick={onPick} />)}
          </div>
        </>}
        {section === 'vector' && (
          <div className="seg preset-groups sub">
            {VECTOR_GROUPS.map((g) => <button key={g} className={vecGroup === g ? 'on' : ''} onClick={() => setVecGroup(g)}>{g}</button>)}
          </div>
        )}
        {section !== 'main' && (
          <div className="preset-grid">
            {samples.map(({ p, t }) => (
              <button key={p.id} className="preset" onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} onClick={() => onPick(p.make())}>
                <Thumb t={t} snap={snap} live={hover === p.id} />
                <b>{p.name}</b>
                <span>{p.desc}</span>
              </button>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={() => onPick(blankTemplate())}>Начать с нуля</button>
          <button className="btn" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { HubSnapshot } from '../../../main/core/types'
import type { AlertTemplate } from '../../../main/core/templates'
import { kit, serverUrl, type KitHandle } from '../editors'
import { PRESETS, cornerTemplate, packTemplate } from '../presets'
import { CORNER_POSITIONS, CORNER_POSITION_NAME, PACK_CATEGORIES, PACK_MODES, PACK_SETS, type CornerFile, type CornerPosition, type PackMode, type PackSet } from '../../../main/core/alertpack'
import { Toggle } from '../components'
import { playBuiltin } from '../sounds'
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

type Section = 'main' | 'vector' | 'text' | 'own' | 'campfire'
const SECTIONS: { id: Section; name: string }[] = [
  { id: 'main', name: 'Основные' }, { id: 'vector', name: 'Векторные' }, { id: 'text', name: 'Текстовые' }, { id: 'own', name: 'Свои' }, { id: 'campfire', name: 'У костра' }
]
/** Копия своего шаблона: новые id, чтобы исходный не перезаписался при сохранении. */
const copyOf = (t: AlertTemplate): AlertTemplate => {
  const c = JSON.parse(JSON.stringify(t)) as AlertTemplate
  return { ...c, id: crypto.randomUUID(), name: `${t.name} (копия)`.slice(0, 60), layers: c.layers.map((l) => ({ ...l, id: crypto.randomUUID() })) }
}
const VECTOR_GROUPS = [...new Set(PRESETS.map((p) => p.group).filter((g): g is string => !!g))]
const SAMPLE_KINDS: { id: string; label: string }[] = [
  { id: 'donation', label: 'Донат' }, { id: 'sub', label: 'Подписка' }, { id: 'follow', label: 'Фоллоу' }, { id: 'raid', label: 'Рейд' }
]

/** Что выбрано в окне: переживает закрытие окна, чтобы «← К выбору шаблона» вернул туда же. */
type Pick = { key: string; title: string; make: () => AlertTemplate }
const memo: { section: Section; packCat: string; vecGroup: string; pick: Pick | null; sound: boolean; pos: CornerPosition; breathe: boolean } = {
  section: 'main', packCat: PACK_CATEGORIES[0], vecGroup: VECTOR_GROUPS[0], pick: null, sound: false, pos: 'bottom-right', breathe: true
}
/** Угловые сцены, уже прочитанные с диска (по набору). */
const corners = new Map<string, CornerFile>()
const POS_ARROW: Record<CornerPosition, string> = {
  'top-left': '↖', 'top-center': '↑', 'top-right': '↗', 'bottom-left': '↙', 'bottom-center': '↓', 'bottom-right': '↘'
}

/** Большой предпросмотр: проигрывает шаблон целиком, по кругу. */
function Preview({ t, snap, kind, sound, run }: { t: AlertTemplate; snap: HubSnapshot; kind: string; sound: boolean; run: number }) {
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(0.3)
  const theme = snap.settings.overlays.alert.theme
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
    const el = stage.current
    const url = (src: string): string => serverUrl(snap, src)
    const item = { ...(previewItem(t, kind, sound ? 0.8 : 0) as object), test: false }
    let h: KitHandle | null = null
    let timer: number | undefined
    const play = (): void => {
      h?.stop()
      h = kit().mount(el, item, { url, theme, playBuiltin: sound ? (id: string, v: number) => playBuiltin(id, v) : undefined })
      timer = window.setTimeout(play, h.duration + 1200)
    }
    play()
    return () => { if (timer) clearTimeout(timer); h?.stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, kind, sound, run, theme, base])
  return (
    <div ref={box} className="pick-stage">
      <div ref={stage} style={{ transform: `scale(${k})`, transformOrigin: '0 0' }} />
    </div>
  )
}

/** Карточка набора из основного набора: рамка и персонаж, три кнопки стилей. */
function PackCard({ s, snap, active, onPlay }: { s: PackSet; snap: HubSnapshot; active: string | null; onPlay: (mode: PackMode) => void }) {
  const src = (f: string): string => serverUrl(snap, `/p/${s.id}/${f}.webp`)
  return (
    <div className={`preset pack${active ? ' on' : ''}`}>
      <button className="pack-thumb" onClick={() => onPlay('classic')} title="Проиграть">
        <img className="pf" src={src('frame')} alt="" loading="lazy" />
        <img className="ph" src={src('hero')} alt="" loading="lazy" />
      </button>
      <b>{s.name}</b>
      <span>{s.action}</span>
      <div className="pack-modes">
        {PACK_MODES.map((m) => <button key={m.id} className={`btn sm${active === m.id ? ' primary' : ''}`} onClick={() => onPlay(m.id)}>▶ {m.name}</button>)}
      </div>
    </div>
  )
}

/** Выбор готового стиля при создании шаблона: карточка — проиграть в предпросмотре, «Выбрать» — открыть в конструкторе. */
export function PresetPicker({ snap, onPick, onClose }: { snap: HubSnapshot; onPick: (t: AlertTemplate) => void; onClose: () => void }) {
  const campfire = snap.settings.ui.look === 'campfire'
  // Раздел «У костра» есть только в этом оформлении приложения.
  const [section, setSectionS] = useState<Section>(memo.section === 'campfire' && !campfire ? 'main' : memo.section)
  const [packCat, setPackCatS] = useState(memo.packCat)
  const [vecGroup, setVecGroupS] = useState(memo.vecGroup)
  const [pick, setPickS] = useState<Pick | null>(memo.pick)
  const [sound, setSoundS] = useState(memo.sound)
  const [kind, setKind] = useState('donation')
  const [run, setRun] = useState(0)
  const [pos, setPosS] = useState<CornerPosition>(memo.pos)
  const [breathe, setBreatheS] = useState(memo.breathe)
  const setBreathe = (v: boolean): void => { memo.breathe = v; setBreatheS(v); setRun((n) => n + 1) }
  const [err, setErr] = useState('')
  const [del, setDel] = useState<string | null>(null)
  const setPos = (v: CornerPosition): void => { memo.pos = v; setPosS(v); setRun((n) => n + 1) }
  const setSection = (v: Section): void => { memo.section = v; setSectionS(v) }
  const setPackCat = (v: string): void => { memo.packCat = v; setPackCatS(v) }
  const setVecGroup = (v: string): void => { memo.vecGroup = v; setVecGroupS(v) }
  const setSound = (v: boolean): void => { memo.sound = v; setSoundS(v) }
  const choose = (p: Pick): void => { memo.pick = p; setPickS(p); setRun((n) => n + 1) }
  const preview = useMemo(() => pick?.make() ?? null, [pick, pos, breathe])
  const playPack = (s: PackSet, mode: PackMode): void => {
    const title = `${s.name} · ${PACK_MODES.find((m) => m.id === mode)?.name ?? ''}`
    if (mode !== 'corner') { choose({ key: `${s.id}:${mode}`, title, make: () => packTemplate(s, mode) }); return }
    const go = (f: CornerFile): void => choose({ key: `${s.id}:corner`, title, make: () => cornerTemplate(s, f, memo.pos, memo.breathe) })
    const have = corners.get(s.id)
    if (have) { go(have); return }
    setErr('')
    window.hub.packCorner(s.id)
      .then((f) => { corners.set(s.id, f as CornerFile); go(f as CornerFile) })
      .catch((e: Error) => setErr(`Не удалось открыть угловую сцену: ${e.message}`))
  }
  const cornerPicked = !!pick?.key.endsWith(':corner')
  const samples = useMemo(() => section === 'main' || section === 'own' || section === 'campfire' ? [] : PRESETS
    .filter((p) => section === 'vector' ? p.group === vecGroup : !p.group)
    .map((p) => ({ p, t: p.make() })), [section, vecGroup])
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal wide pick-modal">
        <div className="pick-top">
          <div className="pick-preview">
            {preview ? <Preview t={preview} snap={snap} kind={kind} sound={sound} run={run} /> : <div className="pick-stage empty">Нажмите на стиль ниже — он проиграется здесь</div>}
          </div>
          <div className="pick-side">
            <h2>Новый шаблон</h2>
            <p className="muted small">Нажмите на стиль — он проиграется здесь с примером текста. «Выбрать» откроет его в конструкторе, оттуда можно вернуться к выбору.</p>
            {pick && <b className="pick-title">{pick.title}</b>}
            {cornerPicked && (
              <div className="pos-grid" title="Где на экране стоит алерт">
                {CORNER_POSITIONS.map((p) => <button key={p} className={pos === p ? 'on' : ''} title={CORNER_POSITION_NAME[p]} onClick={() => setPos(p)}>{POS_ARROW[p]}</button>)}
              </div>
            )}
            {cornerPicked && <Toggle on={breathe} onChange={setBreathe} label="Герой дышит и покачивается" />}
            {err && <div className="note err">{err}</div>}
            <div className="seg">
              {SAMPLE_KINDS.map((x) => <button key={x.id} className={kind === x.id ? 'on' : ''} onClick={() => setKind(x.id)}>{x.label}</button>)}
            </div>
            <Toggle on={sound} onChange={setSound} label="Со звуком" />
            <div className="btnrow">
              <button className="btn primary" disabled={!pick} onClick={() => { if (pick) onPick(pick.make()) }}>Выбрать</button>
              <button className="btn sm" disabled={!pick} onClick={() => setRun((n) => n + 1)}>↻ Ещё раз</button>
            </div>
            <div className="btnrow">
              <button className="btn sm" onClick={() => onPick(blankTemplate())}>Начать с нуля</button>
              <button className="btn sm" onClick={onClose}>Отмена</button>
            </div>
          </div>
        </div>
        <div className="seg preset-groups">
          {SECTIONS.filter((x) => x.id !== 'campfire' || campfire).map((x) => (
            <button key={x.id} className={section === x.id ? 'on' : ''} onClick={() => setSection(x.id)}>
              {x.name}{x.id === 'campfire' ? <span className="beta">BETA</span> : ` · ${x.id === 'main' ? PACK_SETS.length * 3 : x.id === 'own' ? snap.templates.length : PRESETS.filter((p) => (x.id === 'vector') === !!p.group).length}`}
            </button>
          ))}
        </div>
        {section === 'main' && <>
          <div className="seg preset-groups sub">
            {PACK_CATEGORIES.map((g) => <button key={g} className={packCat === g ? 'on' : ''} onClick={() => setPackCat(g)}>{g}</button>)}
          </div>
          <div className="preset-grid">
            {PACK_SETS.filter((s) => s.category === packCat).map((s) => (
              <PackCard key={s.id} s={s} snap={snap} active={pick?.key.startsWith(s.id + ':') ? pick.key.slice(s.id.length + 1) : null}
                onPlay={(mode) => playPack(s, mode)} />
            ))}
          </div>
        </>}
        {section === 'vector' && (
          <div className="seg preset-groups sub">
            {VECTOR_GROUPS.map((g) => <button key={g} className={vecGroup === g ? 'on' : ''} onClick={() => setVecGroup(g)}>{g}</button>)}
          </div>
        )}
        {section === 'own' && (snap.templates.length
          ? <div className="preset-grid">
            {snap.templates.map((t) => (
              <div key={t.id} className="preset-own">
                <button className={`preset${pick?.key === 'own:' + t.id ? ' on' : ''}`} onClick={() => choose({ key: 'own:' + t.id, title: t.name, make: () => copyOf(t) })}>
                  <Thumb t={t} snap={snap} live={false} />
                  <b>{t.name}</b>
                  <span>{t.layers.length} сл. · {(t.durationMs / 1000).toFixed(1)} с · откроется копия</span>
                </button>
                {del === t.id
                  ? <button className="btn sm preset-del ask" onClick={() => { setDel(null); if (pick?.key === 'own:' + t.id) { memo.pick = null; setPickS(null) } window.hub.templateRemove(t.id).catch((e: Error) => setErr(e.message)) }}>Удалить?</button>
                  : <button className="btn sm preset-del" title="Удалить шаблон" onClick={() => { setDel(t.id); window.setTimeout(() => setDel((d) => (d === t.id ? null : d)), 3000) }}>✕</button>}
              </div>
            ))}
          </div>
          : <div className="empty">Своих шаблонов пока нет. Выберите любой стиль, измените его в конструкторе и сохраните — он появится здесь.</div>)}
        {section === 'campfire' && <div className="empty">Здесь появятся алерты «У костра» — они в работе.</div>}
        {(section === 'vector' || section === 'text') && (
          <div className="preset-grid">
            {samples.map(({ p, t }) => (
              <button key={p.id} className={`preset${pick?.key === p.id ? ' on' : ''}`} onClick={() => choose({ key: p.id, title: p.name, make: p.make })}>
                <Thumb t={t} snap={snap} live={false} />
                <b>{p.name}</b>
                <span>{p.desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import type { ConnStatus, HubSnapshot, Platform } from '../../../main/core/types'
import { DEFAULT_HOME, HOME_BLOCKS, HOME_BLOCK_INFO, HOME_COLS, HOME_ROWS, overlaps, type HomeBlock, type HomeItem } from '../../../main/core/home'
import type { Page } from '../App'
import { EventRow, PlatIcon, useNow } from '../ui'
import { INTERACTIVE, toolStatus } from './Interactive'
import { StreamInfoCard } from './StreamInfoCard'

/** Группы подключений: сразу видно, что работает, а что отвалилось. */
const GROUPS: { title: string; ids: Platform[] }[] = [
  { title: 'Программы', ids: ['obs', 'hub'] },
  { title: 'Донаты', ids: ['donationalerts', 'donatepay', 'donatex', 'boosty'] },
  { title: 'Стрим-площадки', ids: ['twitch', 'youtube', 'vk', 'kick', 'goodgame'] }
]
const SHORT: Record<ConnStatus['state'], string> = { ok: 'работает', connecting: 'подключение…', error: 'ошибка', off: 'не подключено' }

type Go = (p: Page, sel?: Platform) => void

/**
 * Главная: блоки на сетке во весь экран, без прокрутки. «Настроить главную» — перетаскивать за заголовок,
 * тянуть за угол, убирать и добавлять блоки. Раскладка хранится в настройках (home).
 */
export function Home({ snap, go }: { snap: HubSnapshot; go: Go }) {
  const [edit, setEdit] = useState(false)
  const [items, setItems] = useState<HomeItem[]>(snap.settings.home)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { if (!edit) setItems(snap.settings.home) }, [snap.settings.home, edit])
  const problems = snap.connections.filter((c) => c.state === 'error')

  const save = (next: HomeItem[]): void => {
    setItems(next)
    void window.hub.setSettings({ home: next })
  }
  const add = (id: HomeBlock): void => {
    const m = HOME_BLOCK_INFO[id]
    for (let y = 0; y + m.minH <= HOME_ROWS; y++) {
      for (let x = 0; x + m.minW <= HOME_COLS; x++) {
        const it = { id, x, y, w: m.minW, h: m.minH }
        if (!items.some((o) => overlaps(o, it))) { save([...items, it]); setMsg(null); return }
      }
    }
    setMsg('Нет свободного места — уменьшите или уберите какой-нибудь блок')
  }

  return (
    <div className="dash-page">
      <div className="head dash-head">
        <div>
          <h1>Главная</h1>
          {edit && <p>Тяните блок за заголовок, размер — за правый нижний угол. Сохраняется сразу.</p>}
        </div>
        <div className="actions">
          {edit ? <>
            <button className="btn" onClick={() => { save(DEFAULT_HOME.map((i) => ({ ...i }))); setMsg(null) }}>Как было</button>
            <button className="btn primary" onClick={() => { setEdit(false); setMsg(null) }}>Готово</button>
          </> : <>
            <button className="btn" onClick={() => void window.hub.testEvent('donation')}>Тестовый донат</button>
            <button className="btn" onClick={() => setEdit(true)}>Настроить главную</button>
          </>}
        </div>
      </div>

      {problems.length > 0 && !edit && (
        <div className="note warnbox" style={{ marginBottom: 12 }}>
          <b>Есть проблемы с подключениями:</b> {problems.map((p) => `${p.name} — ${p.detail}`).join('; ')}{' '}
          <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => go('connections', problems[0].id)}>Открыть диагностику</button>
        </div>
      )}

      {edit && (
        <div className="dash-add">
          <span className="small muted">Добавить:</span>
          {HOME_BLOCKS.filter((b) => !items.some((i) => i.id === b)).map((b) => (
            <button key={b} className="btn sm" title={HOME_BLOCK_INFO[b].desc} onClick={() => add(b)}>+ {HOME_BLOCK_INFO[b].name}</button>
          ))}
          {msg && <span className="small" style={{ color: 'var(--danger-ink)' }}>{msg}</span>}
        </div>
      )}

      <Board items={items} edit={edit} onMove={(l) => { setItems(l); setMsg(null) }} onDrop={save} onRemove={(id) => save(items.filter((i) => i.id !== id))}>
        {(id) => <Block id={id} snap={snap} go={go} />}
      </Board>
      {!items.length && !edit && <div className="empty">Главная пустая — нажмите «Настроить главную» и добавьте блоки.</div>}
    </div>
  )
}

// ---------- Сетка ----------

/** Блок сообщает сетке, сколько ему нужно высоты (px). */
const NeedCtx = createContext<(px: number) => void>(() => undefined)

function Board({ items, edit, onMove, onDrop, onRemove, children }: {
  items: HomeItem[]
  edit: boolean
  onMove: (next: HomeItem[]) => void
  onDrop: (next: HomeItem[]) => void
  onRemove: (id: HomeBlock) => void
  children: (id: HomeBlock) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [fitH, setFitH] = useState(600)
  // Сколько высоты нужно каждому блоку (сообщает сам блок). Строка сетки — такая, чтобы всем хватило:
  // влезает в окно — главная без прокрутки, не влезает — прокручивается вся страница, а блоки не обрезаются.
  const [needs, setNeeds] = useState<Partial<Record<HomeBlock, number>>>({})
  // У каждой строки своя высота: тесному блоку добавляем высоту только в его строках, остальные не раздуваются.
  const tops = useMemo(() => {
    const rows = new Array<number>(HOME_ROWS).fill(fitH / HOME_ROWS)
    for (let pass = 0; pass < 3; pass++) {
      for (const it of items) {
        let sum = 0
        for (let k = it.y; k < it.y + it.h; k++) sum += rows[k]
        const lack = (needs[it.id] ?? 0) - sum
        if (lack > 0.5) for (let k = it.y; k < it.y + it.h; k++) rows[k] += lack / it.h
      }
    }
    const t = [0]
    for (const r of rows) t.push(t[t.length - 1] + r)
    return t
  }, [items, needs, fitH])
  const height = Math.ceil(tops[HOME_ROWS])
  const reporters = useMemo(() => {
    const m = {} as Record<HomeBlock, (px: number) => void>
    for (const id of HOME_BLOCKS) m[id] = (px) => setNeeds((n) => (Math.abs((n[id] ?? 0) - px) < 2 ? n : { ...n, [id]: px }))
    return m
  }, [])
  useLayoutEffect(() => {
    const fit = (): void => {
      const top = ref.current?.getBoundingClientRect().top ?? 0
      // 46 — нижний отступ основной части окна.
      setFitH(Math.max(420, window.innerHeight - top - 46))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  })

  const drag = useRef<{ id: HomeBlock; mode: 'move' | 'size'; sx: number; sy: number; start: HomeItem; cur: HomeItem[] } | null>(null)
  const down = (e: RPointerEvent, it: HomeItem, mode: 'move' | 'size'): void => {
    if (!edit || e.button !== 0) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { id: it.id, mode, sx: e.clientX, sy: e.clientY, start: { ...it }, cur: items }
  }
  const move = (e: RPointerEvent): void => {
    const d = drag.current
    const box = ref.current?.getBoundingClientRect()
    if (!d || !box) return
    const dx = Math.round((e.clientX - d.sx) / (box.width / HOME_COLS))
    const dy = Math.round((e.clientY - d.sy) / (box.height / HOME_ROWS))
    const m = HOME_BLOCK_INFO[d.id]
    const s = d.start
    const next = d.mode === 'move'
      ? { ...s, x: Math.min(HOME_COLS - s.w, Math.max(0, s.x + dx)), y: Math.min(HOME_ROWS - s.h, Math.max(0, s.y + dy)) }
      : { ...s, w: Math.min(HOME_COLS - s.x, Math.max(m.minW, s.w + dx)), h: Math.min(HOME_ROWS - s.y, Math.max(m.minH, s.h + dy)) }
    // На занятое место блок не встаёт — остаётся в последнем свободном положении.
    if (items.some((o) => o.id !== d.id && overlaps(o, next))) return
    const list = items.map((o) => (o.id === d.id ? next : o))
    d.cur = list
    onMove(list)
  }
  const up = (): void => {
    const d = drag.current
    drag.current = null
    if (d) onDrop(d.cur)
  }

  return (
    <div ref={ref} className={`dash ${edit ? 'edit' : ''}`} style={{ height }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {edit && <div className="dash-grid" style={{ backgroundSize: `${100 / HOME_COLS}% ${100 / HOME_ROWS}%` }} />}
      {items.map((it) => (
        <div key={it.id} className={`dash-cell dash-${it.id}`}
          style={{ left: `${(it.x / HOME_COLS) * 100}%`, top: tops[it.y], width: `${(it.w / HOME_COLS) * 100}%`, height: tops[it.y + it.h] - tops[it.y] }}>
          <NeedCtx.Provider value={reporters[it.id]}>{children(it.id)}</NeedCtx.Provider>
          {edit && <>
            <div className="dash-bar" onPointerDown={(e) => down(e, it, 'move')}>
              <span>⠿ {HOME_BLOCK_INFO[it.id].name}</span>
              <button className="dash-x" title="Убрать с главной" onPointerDown={(e) => e.stopPropagation()} onClick={() => onRemove(it.id)}>✕</button>
            </div>
            <div className="dash-size" title="Потяните, чтобы изменить размер" onPointerDown={(e) => down(e, it, 'size')} />
          </>}
        </div>
      ))}
    </div>
  )
}

/**
 * Карточка блока: содержимое не уменьшается и не обрезается — сетка растягивается под самый «высокий» блок.
 * Списки (dash-fill) не растягивают блок: в них видно столько строк, сколько влезло (не меньше трёх).
 */
function Card({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const report = useContext(NeedCtx)
  // Меряем, сколько содержимому нужно по высоте (списки — минимум в три строки), сообщаем сетке и заполняем блок.
  const fit = (): void => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    i.style.width = `${o.clientWidth}px`
    i.style.height = ''
    const cell = o.closest('.dash-cell') as HTMLElement | null
    if (cell) report(Math.ceil(i.scrollHeight + (cell.clientHeight - o.clientHeight)))
    i.style.height = `${o.clientHeight}px`
  }
  useLayoutEffect(fit)
  useEffect(() => {
    const ro = new ResizeObserver(fit)
    if (outer.current) ro.observe(outer.current)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="card dash-card">
      <div ref={outer} className="dash-fit"><div ref={inner} className="dash-inner">{children}</div></div>
    </div>
  )
}

// ---------- Блоки ----------

function Block({ id, snap, go }: { id: HomeBlock; snap: HubSnapshot; go: Go }) {
  const now = useNow(id === 'events' || id === 'chat' ? 15000 : 1000)
  const { obs } = snap
  switch (id) {
    case 'viewers': {
      const configured = snap.platforms.filter((p) => p.configured)
      const live = configured.filter((p) => p.live)
      const counted = live.filter((p) => p.viewers !== null)
      const viewers = counted.length ? counted.reduce((a, p) => a + (p.viewers ?? 0), 0) : null
      return (
        <Card>
          <h3>Зрители в эфире {live.length > 0 && <span className="r tag">в эфире: {live.length}</span>}</h3>
          <div className={`big ${viewers === null ? 'muted' : ''}`}>{viewers ?? '—'}</div>
          {configured.length
            ? <div className="list dash-fill">{configured.map((p) => (
              <div key={p.id} className="row"><PlatIcon p={p.id} /><span className="grow ellipsis">{p.name}</span><b className={p.live ? '' : 'muted small'}>{p.live ? (p.viewers ?? 0) : 'не в эфире'}</b></div>
            ))}</div>
            : <p className="small muted">Подключите площадки в «Подключениях» — здесь появятся зрители каждой.</p>}
        </Card>
      )
    }
    case 'obs':
      return (
        <Card>
          <h3>OBS Studio <span className={`r dot ${obs.connected ? 'ok' : 'connecting'}`} /></h3>
          {obs.connected ? <>
            <div className="kv">
              <div><span>Разрешение</span><b>{obs.resolution}</b></div>
              <div><span>Частота</span><b>{obs.fps} FPS</b></div>
            </div>
            <div className="row"><span className="grow muted">Текущая сцена</span><b className="ellipsis">{obs.scene}</b></div>
            <div className="row"><span className="grow muted">Эфир</span><b style={{ color: obs.streaming ? 'var(--ok)' : undefined }}>{obs.streaming ? 'В сети' : 'Не в эфире'}</b></div>
          </> : <>
            <p className="muted">{snap.connections.find((c) => c.id === 'obs')?.detail}</p>
            <button className="btn sm" onClick={() => go('connections')}>Настроить подключение</button>
          </>}
        </Card>
      )
    case 'alerts':
      return (
        <Card>
          <h3>Алерты <button className="r btn sm" onClick={() => go('alerts')}>Открыть →</button></h3>
          <div className="kv">
            <div><span>Сейчас</span><b className="ellipsis" style={{ display: 'block' }}>{snap.alerts.current ? snap.alerts.current.user : '—'}</b></div>
            <div><span>В очереди</span><b>{snap.alerts.queue.length}</b></div>
          </div>
          <div className="row">
            <span className="grow muted">{!snap.settings.alerts.enabled ? 'Алерты выключены' : snap.alerts.paused ? 'На паузе' : 'Показываются'}</span>
            <button className="btn sm" onClick={() => void window.hub.alertPause(!snap.alerts.paused)}>{snap.alerts.paused ? '▶ Продолжить' : '❚❚ Пауза'}</button>
          </div>
        </Card>
      )
    case 'streaminfo':
      return <div className="dash-own"><Card><StreamInfoCard snap={snap} go={go} /></Card></div>
    case 'connections': {
      const all = GROUPS.flatMap((g) => g.ids)
      const ok = snap.connections.filter((c) => c.state === 'ok' && all.includes(c.id)).length
      return (
        <Card>
          <h3>Подключения <span className="small muted" style={{ fontWeight: 500 }}>активно {ok} из {all.length}</span> <button className="r btn sm" onClick={() => go('connections')}>Все →</button></h3>
          <div className="dash-cols dash-fill">
            {GROUPS.map((g) => {
              const list = g.ids.map((cid) => snap.connections.find((c) => c.id === cid)).filter((c): c is ConnStatus => !!c)
              return (
                <div key={g.title} className="dash-col">
                  <div className="small muted dash-cap">{g.title} · {list.filter((c) => c.state === 'ok').length}/{list.length}</div>
                  <div className="list">
                    {list.map((c) => (
                      <div key={c.id} className="row" style={{ cursor: 'pointer', opacity: c.state === 'off' ? 0.55 : 1 }} title={c.detail} onClick={() => go('connections', c.id)}>
                        <PlatIcon p={c.id} />
                        <div className="grow" style={{ minWidth: 0 }}>
                          <span className="ellipsis" style={{ display: 'block' }}>{c.name}</span>
                          <span className="small ellipsis" style={{ display: 'block', color: c.state === 'error' ? 'var(--danger-ink)' : 'var(--muted)' }}>{c.state === 'error' ? c.detail : SHORT[c.state]}</span>
                        </div>
                        <span className={`dot ${c.state}`} />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )
    }
    case 'events': {
      const events = snap.events.filter((e) => e.type !== 'message').slice(0, 20)
      return (
        <Card>
          <h3>Последние события <button className="r btn sm" onClick={() => go('events')}>Все →</button></h3>
          {events.length ? <div className="list dash-fill">{events.map((e) => <EventRow key={e.id} e={e} now={now} />)}</div>
            : <div className="empty">Событий пока нет — нажмите «Тестовый донат»</div>}
        </Card>
      )
    }
    case 'quick':
      return (
        <Card>
          <h3>Под рукой</h3>
          <div className="dash-quick">
            {([['Оверлеи для OBS', 'Ссылки и ключи', 'overlays'], ['Подключения', 'Диагностика площадок', 'connections'], ['События', 'Лента и тесты', 'events'], ['Настройки', 'Сервер, ключи, OBS', 'settings']] as const).map(([t, d, p]) => (
              <button key={t} className="btn" onClick={() => go(p)}>{t}<span className="small muted">{d}</span></button>
            ))}
          </div>
        </Card>
      )
    case 'chat': {
      // В данных новые сверху; в блоке новые внизу, как в мультичате.
      const msgs = snap.chat.filter((m) => m.type === 'message').slice(0, 40).reverse()
      return (
        <Card>
          <h3>Чат <button className="r btn sm" onClick={() => go('chat')}>Открыть →</button></h3>
          {msgs.length
            ? <div className="dash-fill dash-chat">{msgs.map((m) => (
              <div key={m.id} className="dash-msg"><PlatIcon p={m.platform} /><b style={{ color: m.color && /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : undefined }}>{m.user}</b> {m.text}</div>
            ))}</div>
            : <div className="empty">Сообщений пока нет</div>}
        </Card>
      )
    }
    case 'music': {
      const m = snap.music.now
      return (
        <Card>
          <h3>Музыка <button className="r btn sm" onClick={() => go('music')}>Открыть →</button></h3>
          {m ? <>
            <div className="dash-track">
              {m.image && <img src={m.image} alt="" />}
              <div style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{m.title}</b><span className="small muted ellipsis" style={{ display: 'block' }}>{m.artist}</span></div>
            </div>
            <div className="btnrow">
              <button className="btn sm" onClick={() => void window.hub.musicControl('prev')}>⏮</button>
              <button className="btn sm" onClick={() => void window.hub.musicControl('toggle')}>{m.playing ? '❚❚' : '▶'}</button>
              <button className="btn sm" onClick={() => void window.hub.musicControl('next')}>⏭</button>
            </div>
          </> : <p className="small muted">Сейчас ничего не играет.</p>}
        </Card>
      )
    }
    case 'counters':
      return (
        <Card>
          <h3>Счётчики <button className="r btn sm" onClick={() => go('rules')}>Открыть →</button></h3>
          {snap.counters.length
            ? <div className="list dash-fill">{snap.counters.map((c) => (
              <div key={c.id} className="row">
                <span className="grow ellipsis">{c.name}</span>
                <button className="btn sm" onClick={() => void window.hub.counterApply(c.id, 'sub', 1)}>−</button>
                <b className="mono" style={{ minWidth: '2.5em', textAlign: 'center' }}>{c.value}</b>
                <button className="btn sm" onClick={() => void window.hub.counterApply(c.id, 'add', 1)}>+</button>
              </div>
            ))}</div>
            : <p className="small muted">Счётчиков нет — заведите их в «Алертах и правилах».</p>}
        </Card>
      )
    default: {
      const tool = INTERACTIVE.find((t) => t.id === id)
      if (!tool) return null
      const s = toolStatus(tool.id, snap, now)
      return (
        <Card>
          <h3><span className="ix-ico">{tool.ico}</span>{tool.label}{!!s.badge && <span className="nav-cnt">{s.badge}</span>} <button className="r btn sm" onClick={() => go(tool.id)}>Открыть →</button></h3>
          <div className="ix-status">
            <span className={`ix-st ${s.live ? 'live' : ''}`}>{s.text}</span>
            {s.extra && <span className="small muted ellipsis">{s.extra}</span>}
          </div>
          {s.bar !== undefined && <div className="ix-bar"><i style={{ width: `${s.bar}%` }} /></div>}
        </Card>
      )
    }
  }
}

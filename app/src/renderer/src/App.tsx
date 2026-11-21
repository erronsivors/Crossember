import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HubSnapshot, Platform } from '../../main/core/types'
import mark from './assets/mark.svg'
import { Home } from './pages/Home'
import { Chat } from './pages/Chat'
import { Connections } from './pages/Connections'
import { Events } from './pages/Events'
import { Overlays } from './pages/Overlays'
import { Settings } from './pages/Settings'
import { Alerts } from './pages/Alerts'
import { Rules } from './pages/Rules'
import { Auction } from './pages/Auction'
import { Wheel } from './pages/Wheel'
import { Goal } from './pages/Goal'
import { Giveaway } from './pages/Giveaway'
import { Vote } from './pages/Vote'
import { Bot } from './pages/Bot'
import { Bets } from './pages/Bets'
import { Subathon } from './pages/Subathon'
import { Rewards } from './pages/Rewards'
import { Music } from './pages/Music'
import { Channel } from './pages/Channel'
import { Analytics } from './pages/Analytics'
import { ChatStyle } from './pages/ChatStyle'
import { ALERT_TABS, INTERACTIVE, InteractiveHub, SubTabs } from './pages/Interactive'
import { Feedback } from './pages/Feedback'
import { Wizard } from './pages/Wizard'
import { Helper } from './pages/Helper'
import { ModeContext } from './components'
import { useNow, fmtDuration } from './ui'
import { UpdateModal, UpdateNav } from './Update'
import { PALETTES } from './palettes'
import { TitleBar, type MenuDef } from './TitleBar'
import { AboutModal, ProfilesModal, UpdatesModal, WhatsNew } from './Help'

export type Page = 'home' | 'chat' | 'events' | 'alerts' | 'rules' | 'interactive' | 'auction' | 'wheel' | 'goal' | 'giveaway' | 'vote' | 'bets' | 'subathon' | 'rewards' | 'bot' | 'music' | 'channel' | 'analytics' | 'overlays' | 'chatstyle' | 'connections' | 'settings' | 'feedback' | 'whatsnew'

/** Пункт меню и страницы, при которых он подсвечен (вложенные разделы). */
const NAV: { id: Page; label: string; ico: string; also?: Page[] }[] = [
  { id: 'home', label: 'Главная', ico: '⌂' },
  { id: 'chat', label: 'Мультичат', ico: '💬' },
  { id: 'channel', label: 'Панель Twitch', ico: '▤' },
  { id: 'events', label: 'События', ico: '⚡' },
  { id: 'alerts', label: 'Алерты и правила', ico: '✦', also: ['rules'] },
  { id: 'interactive', label: 'Интерактив', ico: '◈', also: ['auction', 'vote', 'bets', 'rewards', 'subathon', 'wheel', 'goal', 'giveaway'] },
  { id: 'bot', label: 'Бот и очки', ico: '⌘' },
  { id: 'music', label: 'Музыка', ico: '♫' },
  { id: 'analytics', label: 'Аналитика', ico: '◫' }
]
/** Настраивается один раз — ниже, под подписью. «Настройки» — в меню окна сверху. */
const SETUP: { id: Page; label: string; ico: string; also?: Page[] }[] = [
  { id: 'overlays', label: 'Оверлеи', ico: '▣', also: ['chatstyle'] },
  { id: 'connections', label: 'Подключения', ico: '⏚' }
]
const TOOL_PAGES = INTERACTIVE.map((t) => t.id)

const LATER: string[] = []

export function App() {
  const [snap, setSnap] = useState<HubSnapshot | null>(null)
  // История разделов, как в браузере: «назад» — Esc, боковая кнопка мыши, Ctrl+[; «вперёд» — Ctrl+].
  const [nav, setNav] = useState<{ list: Page[]; i: number }>({ list: ['home'], i: 0 })
  const page = nav.list[nav.i]
  const [connSel, setConnSel] = useState<Platform | undefined>(undefined)
  const [modal, setModal] = useState<'about' | 'updates' | 'profiles' | null>(null)
  const go = (p: Page, sel?: Platform): void => {
    // Редактор с несохранённым может придержать переход и выполнить его сам после ответа в окне.
    if (!window.dispatchEvent(new CustomEvent('cb:leave', { cancelable: true, detail: () => go(p, sel) }))) return
    setConnSel(sel)
    setNav((n) => {
      if (n.list[n.i] === p) return n
      const list = [...n.list.slice(0, n.i + 1), p].slice(-50)
      return { list, i: list.length - 1 }
    })
  }
  const step = (d: -1 | 1): void => {
    // Раздел может сам решить, что «назад» — это закрыть редактор (и спросить про несохранённое).
    if (d === -1 && !window.dispatchEvent(new CustomEvent('cb:back', { cancelable: true }))) return
    setConnSel(undefined)
    setNav((n) => (n.i + d < 0 || n.i + d >= n.list.length ? n : { ...n, i: n.i + d }))
  }
  const stepRef = useRef(step)
  const goRef = useRef(go)
  goRef.current = go
  stepRef.current = step
  useEffect(() => { void window.hub.view(page).catch(() => undefined) }, [page])
  useEffect(() => window.hub.onGo((p) => { if (p === 'feedback') goRef.current('feedback') }), [])
  useEffect(() => {
    const field = (el: Element | null): boolean => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || (el as HTMLElement).isContentEditable)
    const key = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      // По коду клавиши: при русской раскладке [ и ] — это Х и Ъ.
      if (e.ctrlKey && e.code === 'BracketLeft') { e.preventDefault(); stepRef.current(-1) }
      else if (e.ctrlKey && e.code === 'BracketRight') { e.preventDefault(); stepRef.current(1) }
      else if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !field(document.activeElement) && !document.querySelector('.modal-back')) stepRef.current(-1)
    }
    const mouse = (e: MouseEvent): void => {
      if (e.button === 3) { e.preventDefault(); stepRef.current(-1) }
      else if (e.button === 4) { e.preventDefault(); stepRef.current(1) }
    }
    window.addEventListener('keydown', key)
    window.addEventListener('mouseup', mouse)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mouseup', mouse) }
  }, [])
  const menus: MenuDef[] = [
    { label: 'Файл', items: [
      { label: 'Профили…', on: () => setModal('profiles') },
      { label: 'Экспорт и импорт профиля', on: () => go('settings') },
      'sep',
      { label: 'Выход', on: () => void window.hub.quit() }
    ] },
    { label: 'Вид', items: [
      { label: 'Главная', on: () => go('home') },
      { label: 'Мультичат', on: () => go('chat') },
      { label: 'События', on: () => go('events') },
      { label: 'Алерты и правила', on: () => go('alerts') },
      { label: 'Оверлеи', on: () => go('overlays') },
      { label: 'Подключения', on: () => go('connections') },
      'sep',
      { label: 'Оформление и цвета', on: () => go('settings') }
    ] },
    { label: 'Настройки', on: () => go('settings') },
    { label: 'Справка', items: [
      { label: 'Что нового', on: () => go('whatsnew') },
      { label: 'Проверить обновления', on: () => setModal('updates') },
      { label: 'Руководство по программе', on: () => void window.hub.openGuide() },
      { label: 'Обратная связь', on: () => go('feedback') },
      'sep',
      { label: 'О программе', on: () => setModal('about') }
    ] }
  ]
  const host = document.getElementById('titlebar')
  const bar = host ? createPortal(<TitleBar menus={snap?.settings.role === 'helper' ? [] : menus} canBack={nav.i > 0} canFwd={nav.i < nav.list.length - 1} onBack={() => step(-1)} onFwd={() => step(1)} />, host) : null
  const now = useNow()

  useEffect(() => {
    void window.hub.snapshot().then(setSnap)
    return window.hub.onUpdate(setSnap)
  }, [])

  // Оформление приложения: атрибуты на <html>, цвета — в themes.css.
  const ui = snap?.settings.ui
  useEffect(() => {
    if (!ui) return
    document.documentElement.dataset.look = ui.look
    document.documentElement.dataset.palette = PALETTES.some((p) => p.id === ui.palette) ? ui.palette : 'classic'
  }, [ui?.look, ui?.palette])

  if (!snap) return <>{bar}<div className="empty">Запуск…</div></>
  if (snap.settings.role === 'helper') return <>{bar}<Helper snap={snap} /></>
  const { obs, twitch } = snap
  const okCount = snap.connections.filter((c) => c.state === 'ok').length
  const live = obs.streaming || snap.platforms.some((p) => p.live)
  const counted = snap.platforms.filter((p) => p.viewers !== null)
  const totalViewers = counted.length ? counted.reduce((a, p) => a + (p.viewers ?? 0), 0) : null
  const pendingBets = snap.auction.bets.filter((b) => b.status === 'pending').length + snap.rewards.queue.length

  return (
    <ModeContext.Provider value={snap.settings.setupMode}>
      {bar}
      <div className="layout">
        <aside className="side">
          <div className="brand">
            <img src={mark} alt="" />
            <div>
              <b>Crossember</b>
              <small>made by erron for friends</small>
            </div>
          </div>
          {NAV.map((n) => (
            <button key={n.id} className={`nav ${page === n.id || n.also?.includes(page) ? 'on' : ''}`} onClick={() => go(n.id)}>
              <span className="ico">{n.ico}</span>
              {n.label}
              {n.id === 'interactive' && pendingBets > 0 && <span className="nav-cnt" title="Ставки аукциона и награды за баллы ждут решения">{pendingBets}</span>}
            </button>
          ))}
          <div className="side-sep">Настройка</div>
          {SETUP.map((n) => (
            <button key={n.id} className={`nav ${page === n.id || n.also?.includes(page) ? 'on' : ''}`} onClick={() => go(n.id)}>
              <span className="ico">{n.ico}</span>
              {n.label}
            </button>
          ))}
          {LATER.length > 0 && <div className="side-sep">Дальше по плану</div>}
          {LATER.map((l) => (
            <div key={l} className="nav" style={{ cursor: 'default', opacity: 0.45 }}>
              <span className="ico">·</span>
              {l}
            </div>
          ))}
          <UpdateNav u={snap.update} />
          <div className="side-foot">
            <span className={`dot ${snap.server ? 'ok' : 'error'}`} /> {snap.settings.setupMode === 'two' ? 'Режим: 2 ПК' : snap.settings.setupMode === 'one' ? 'Режим: 1 ПК' : 'Режим не выбран'} · всё локально
          </div>
        </aside>

        <main className="main">
          <div className="topbar">
            <span className="live">
              <span className={`dot ${live ? 'live' : ''}`} />
              {live ? 'В эфире' : obs.connected || twitch.broadcaster ? 'Не в эфире' : 'Ничего не подключено'}
            </span>
            {obs.streaming && obs.streamStartedAt && <span className="mono">{fmtDuration(now - obs.streamStartedAt)}</span>}
            {totalViewers !== null && <span title="Зрители на всех площадках">👁 {totalViewers}</span>}
            {obs.recording && <span>● Запись</span>}
            {obs.scene && <span>Сцена: <b style={{ color: 'var(--ink)' }}>{obs.scene}</b></span>}
            <div className="right">
              <span>Подключений: {okCount}/{snap.connections.length}</span>
              {obs.resolution && <span className="chip">{obs.resolution} · {obs.fps} FPS</span>}
            </div>
          </div>

          {snap.feedback.crash && page !== 'feedback' && (
            <div className="crash-bar">
              <span className="grow">
                <b>{snap.feedback.crash.kind === 'db' ? 'Файл данных Crossember был повреждён и восстановлен.' : snap.feedback.crash.previous ? 'Прошлый запуск Crossember закрылся неожиданно.' : 'В Crossember произошла ошибка.'}</b>{' '}
                <span className="muted">Если что-то работает не так — сообщите автору, логи соберутся сами.</span>
              </span>
              <button className="btn sm primary" onClick={() => go('feedback')}>Сообщить об ошибке</button>
              <button className="btn sm" onClick={() => void window.hub.crashDismiss()}>Скрыть</button>
            </div>
          )}
          {page === 'home' && <Home snap={snap} go={go} />}
          {page === 'chat' && <Chat snap={snap} />}
          {page === 'connections' && <Connections key={connSel ?? ""} snap={snap} initial={connSel} />}
          {page === 'events' && <Events snap={snap} />}
          {page === 'overlays' && <Overlays snap={snap} go={go} />}
          {page === 'chatstyle' && <ChatStyle snap={snap} go={go} />}
          {page === 'settings' && <Settings snap={snap} />}
          {(page === 'alerts' || page === 'rules') && <SubTabs tabs={ALERT_TABS} page={page} go={go} snap={snap} now={now} />}
          {page === 'alerts' && <Alerts snap={snap} />}
          {page === 'rules' && <Rules snap={snap} />}
          {page === 'interactive' && <InteractiveHub snap={snap} go={go} now={now} />}
          {TOOL_PAGES.includes(page) && <SubTabs tabs={INTERACTIVE} page={page} go={go} back={{ label: 'Интерактив', page: 'interactive' }} snap={snap} now={now} />}
          {page === 'auction' && <Auction snap={snap} go={go} />}
          {page === 'wheel' && <Wheel snap={snap} />}
          {page === 'goal' && <Goal snap={snap} />}
          {page === 'giveaway' && <Giveaway snap={snap} />}
          {page === 'vote' && <Vote snap={snap} />}
          {page === 'bets' && <Bets snap={snap} />}
          {page === 'subathon' && <Subathon snap={snap} />}
          {page === 'rewards' && <Rewards snap={snap} />}
          {page === 'bot' && <Bot snap={snap} />}
          {page === 'music' && <Music snap={snap} />}
          {page === 'channel' && <Channel snap={snap} />}
          {page === 'analytics' && <Analytics snap={snap} />}
          {page === 'feedback' && <Feedback snap={snap} />}
          {page === 'whatsnew' && <WhatsNew current={snap.update.current} />}
          <UpdateModal u={snap.update} />
          {modal === 'about' && <AboutModal snap={snap} onClose={() => setModal(null)} />}
          {modal === 'updates' && <UpdatesModal snap={snap} onClose={() => setModal(null)} />}
          {modal === 'profiles' && <ProfilesModal snap={snap} onClose={() => setModal(null)} />}
          <button className="app-ver" title="Версия программы — обновления в Настройках" onClick={() => go('settings')}>Crossember {snap.update.current}</button>
        </main>
      </div>
      {snap.settings.setupMode === null && <Wizard />}
    </ModeContext.Provider>
  )
}

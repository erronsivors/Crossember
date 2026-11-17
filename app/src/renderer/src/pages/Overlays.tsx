import { useEffect, useState } from 'react'
import type { HubSnapshot, OverlayInfo } from '../../../main/core/types'
import type { Page } from '../App'
import type { AppSettings, ChatOverlaySettings, StatsPeriod, Theme } from '../../../main/core/settings'
import { Hint, NumberField, ThemePicker, Toggle } from '../components'
import { DOCK_BLOCKS, DOCK_PRESETS, type DockBlock } from '../../../main/core/dock'
import { KeyRotate } from './Settings'
import { VIZ_STYLES, type VizSettings, type VizStyle } from '../../../main/core/viz'
import { audioInputs } from '../audioviz'
import { KEY_DEFS, KEYS_PRESETS, type KeysOverlaySettings, type KeysPreset } from '../../../main/core/keyslayout'

type Key = keyof AppSettings['overlays']
const KEY: Record<string, Key> = { alert: 'alert', chat: 'chat', 'chat-h': 'chatH', pinned: 'pinned', top: 'top', last: 'last', counter: 'counter', auction: 'auction', wheel: 'wheel', goal: 'goal', giveaway: 'giveaway', vote: 'vote', bets: 'bets', music: 'music', subathon: 'subathon', keys: 'keys', viz: 'viz' }
const DESC: Record<string, string> = {
  alert: 'Донаты, подписки, рейды, фолловы — по очереди, по центру экрана.',
  chat: 'Колонка чата: новые сообщения снизу.',
  'chat-h': 'Строка чата внизу экрана: новые сообщения слева.',
  pinned: 'Сообщение, которое вы закрепили в Мультичате (📌).',
  top: 'Самые щедрые зрители за эфир, день, неделю, месяц или всё время. Тестовые донаты не считаются.',
  last: 'Последний донат (и последняя подписка) — строкой поверх сцены.',
  counter: 'Смерти, победы и другие счётчики из раздела «Правила». Число коротко подпрыгивает, когда меняется.',
  auction: 'Таймер и топ лотов с полосками доли, в конце — победитель. Ники и сообщения зрителей не показываются.',
  wheel: 'Появляется, когда крутите колесо, показывает итог и само прячется. Источник можно держать включённым всегда.',
  goal: 'Цель с полоской прогресса и этапами, последний донат, топ сбора и срок. Этап или цель достигнуты — короткий праздник.',
  giveaway: 'Во время приёма — слово для участия, число участников и таймер. При выборе ники прокручиваются до победителя.',
  vote: 'Вопрос, варианты с номерами и полосками, таймер и итог. Быстрое висит до конца, долгое появляется иногда. Ники зрителей не показываются.',
  bets: 'Вопрос, исходы с банком, долей и коэффициентом, таймер приёма и итог. После итога держится 25 секунд и прячется.',
  music: 'Обложка, название, исполнитель и кто заказал трек. Spotify или любой плеер Windows (Яндекс Музыка, браузер).',
  subathon: 'Большой таймер сабатона, пометки «пауза» и «счастливый час», всплывающие «+5:00» от подписок и донатов.',
  keys: 'Какие клавиши и кнопки мыши вы нажимаете — для гайдов, спидранов и обучающих эфиров.',
  viz: 'Столбики, волна или круг, которые двигаются под музыку, игру или ваш голос.'
}

export function Overlays({ snap, go }: { snap: HubSnapshot; go?: (p: Page) => void }) {
  return (
    <>
      <div className="head">
        <div>
          <h1>Оверлеи для OBS <Hint id="overlays" /></h1>
          <p>Каждый оверлей — одна ссылка для источника «Браузер». Настройки применяются в OBS сразу.</p>
        </div>
        <div className="actions">
          <button className="btn sm" onClick={() => void window.hub.testEvent('message')}>Тест: сообщение</button>
          <button className="btn sm" onClick={() => void window.hub.testEvent('donation')}>Тест: донат</button>
        </div>
      </div>
      {!snap.server ? <div className="note warnbox">Сервер оверлеев не запущен — смотрите «Подключения».</div> : (
        <>
        <DockCard snap={snap} url={snap.server.dockUrl} />
        <div className="grid g2">
          {snap.server.overlays.map((o) => <OverlayCard key={o.id} o={o} snap={snap} go={go} />)}
        </div>
        </>
      )}
      <div className="note" style={{ marginTop: 18 }}>
        🔒 В ссылках есть ключ доступа. Если ссылка засветилась — «Настройки → Ключ оверлеев → Перевыпустить».
      </div>
    </>
  )
}

const BLOCK_NAMES: Record<DockBlock, string> = {
  chat: 'Чат', events: 'События', alerts: 'Алерты', auction: 'Аукцион', vote: 'Голосование', goal: 'Сбор средств', giveaway: 'Розыгрыш', wheel: 'Колесо', counters: 'Счётчики',
  bets: 'Ставки', music: 'Музыка', rewards: 'Награды за баллы', subathon: 'Сабатон'
}
const BLOCK_DESC: Record<DockBlock, string> = {
  chat: 'читать, писать, закреплять', events: 'донаты, подписки, рейды', alerts: 'очередь, пауза, пропуск, тест',
  auction: 'таймер, приём, итог', vote: 'итог, время, показать долгое', goal: 'пауза, срок, добавить сумму', giveaway: 'приём, выбор, перевыбор',
  wheel: 'кнопка «Крутить»', counters: 'плюс и минус',
  bets: 'закрыть, итог, отмена', music: 'что играет, пауза, дальше', rewards: 'выполнено, вернуть баллы', subathon: 'пауза, +5 минут'
}
const PRESET_NAMES: { id: keyof typeof DOCK_PRESETS; name: string }[] = [
  { id: 'operator', name: 'Панель оператора' },
  { id: 'buttons', name: 'Быстрые кнопки' },
  { id: 'chat', name: 'Чат и алерты' }
]

/** Док для OBS: набор блоков (готовый или свой) и ссылка. */
function DockCard({ snap, url }: { snap: HubSnapshot; url: string }) {
  const [copied, setCopied] = useState<'main' | 'fixed' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const blocks = snap.settings.dock.blocks
  const setBlocks = (list: DockBlock[]): void => void window.hub.setSettings({ dock: { blocks: DOCK_BLOCKS.filter((b) => list.includes(b)) } })
  const preset = PRESET_NAMES.find((p) => DOCK_PRESETS[p.id].join() === blocks.join())?.id
  const copy = (which: 'main' | 'fixed', text: string): void => {
    void window.hub.copy(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1500)
  }
  return (
    <div className="card dock-card">
      <h3>Док для OBS <Hint id="dock" /></h3>
      <p className="small muted" style={{ marginTop: -6 }}>Панель прямо в окне OBS: нажимать кнопки во время эфира, не переключаясь в Crossember. Выберите готовый набор или отметьте блоки сами.</p>
      <div className="seg" style={{ flexWrap: 'wrap' }}>
        {PRESET_NAMES.map((p) => <button key={p.id} className={preset === p.id ? 'on' : ''} onClick={() => setBlocks(DOCK_PRESETS[p.id])}>{p.name}</button>)}
        <button className={preset ? '' : 'on'} disabled style={{ cursor: 'default' }}>Свой набор</button>
      </div>
      <div className="profile-parts dock-blocks">
        {DOCK_BLOCKS.map((b) => (
          <label key={b} className="profile-part">
            <input type="checkbox" checked={blocks.includes(b)} onChange={(e) => setBlocks(e.target.checked ? [...blocks, b] : blocks.filter((x) => x !== b))} />
            <span><b>{BLOCK_NAMES[b]}</b><span className="small muted">{BLOCK_DESC[b]}</span></span>
          </label>
        ))}
      </div>
      <div className="url">
        <code title="Ссылка содержит ключ доступа — не показывайте её в эфире">{url.replace(/k=.+$/, 'k=••••••')}</code>
        <button className="btn sm" onClick={() => copy('main', url)}>{copied === 'main' ? 'Скопировано ✓' : 'Скопировать'}</button>
      </div>
      <p className="small muted">В OBS: <b>Док-панели → Пользовательские док-панели браузера</b> (Docks → Custom Browser Docks) → любое имя, например «Crossember» → вставьте ссылку → «Применить». Галочки здесь меняют док сразу, ссылку заново вставлять не нужно.</p>
      <div className="btnrow" style={{ alignItems: 'center' }}>
        <button className="btn sm" disabled={!blocks.length} onClick={() => copy('fixed', `${url}&b=${blocks.join(',')}`)}>{copied === 'fixed' ? 'Скопировано ✓' : 'Ссылка только с этими блоками'}</button>
        <span className="small muted">— для второго дока с другим набором (например, чат отдельно, кнопки отдельно). Такая ссылка запоминает текущие галочки.</span>
      </div>
      <KeyRotate label="Перевыпустить ключ дока" confirm={confirm} onAsk={() => setConfirm(true)} onCancel={() => setConfirm(false)} onYes={() => { void window.hub.rotateKey('dock'); setConfirm(false) }} />
    </div>
  )
}

function OverlayCard({ o, snap, go }: { o: OverlayInfo; snap: HubSnapshot; go?: (p: Page) => void }) {
  const [copied, setCopied] = useState(false)
  const key = KEY[o.id]
  const cfg = snap.settings.overlays[key]
  const set = (patch: Record<string, unknown>): void => void window.hub.setSettings({ overlays: { [key]: patch } })

  return (
    <div className="card">
      <h3>{o.name} <span className="r chip">{o.size}</span></h3>
      <p className="small muted" style={{ marginTop: -6 }}>{DESC[o.id]}</p>
      <div className="url">
        <code title="Ссылка содержит ключ доступа — не показывайте её в эфире">{o.url.replace(/k=.+$/, 'k=••••••')}</code>
        <button className="btn sm" onClick={() => { void window.hub.copy(o.url); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Скопировано ✓' : 'Скопировать'}</button>
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label>Тема <Hint id="theme" /></label>
        <ThemePicker value={cfg.theme} onChange={(t: Theme) => set({ theme: t })} />
      </div>
      {(key === 'chat' || key === 'chatH') && <ChatSettings c={cfg as ChatOverlaySettings} set={set} />}
      {(key === 'chat' || key === 'chatH') && go && <button className="btn sm primary" style={{ marginTop: 10 }} onClick={() => go('chatstyle')}>Оформление чата: анимации, события, шрифты →</button>}
      {key === 'top' && <TopSettings c={cfg as AppSettings['overlays']['top']} set={set} />}
      {key === 'last' && (
        <>
          <NumberField label="Размер шрифта" value={(cfg as { fontSize: number }).fontSize} min={12} max={72} suffix="px" onChange={(v) => set({ fontSize: v })} />
          <Toggle on={(cfg as AppSettings['overlays']['last']).showSub} onChange={(v) => set({ showSub: v })} label="Показывать последнюю подписку" />
        </>
      )}
      {key === 'viz' && <VizOverlaySettings c={cfg as VizSettings} snap={snap} set={set} />}
      {key === 'keys' && <KeysSettings c={cfg as KeysOverlaySettings} snap={snap} set={set} />}
      {key === 'counter' && <CounterSettings c={cfg as AppSettings['overlays']['counter']} snap={snap} set={set} />}
      {key === 'auction' && <AuctionOverlaySettings c={cfg as AppSettings['overlays']['auction']} set={set} />}
      {key === 'vote' && <VoteOverlaySettings c={cfg as AppSettings['overlays']['vote']} set={set} />}
      {key === 'giveaway' && (
        <div className="grid g3" style={{ gap: 10 }}>
          <NumberField label="Шрифт" value={(cfg as AppSettings['overlays']['giveaway']).fontSize} min={12} max={72} suffix="px" onChange={(v) => set({ fontSize: v })} />
          <NumberField label="Прокрутка" value={(cfg as AppSettings['overlays']['giveaway']).revealSec} min={2} max={20} suffix="сек" onChange={(v) => set({ revealSec: v })} />
          <NumberField label="Скрыть итог через" value={(cfg as AppSettings['overlays']['giveaway']).hideAfterSec} min={0} max={600} suffix="сек (0 — нет)" onChange={(v) => set({ hideAfterSec: v })} />
        </div>
      )}
      {key === 'bets' && (
        <>
          <NumberField label="Размер шрифта" value={(cfg as AppSettings['overlays']['bets']).fontSize} min={12} max={72} suffix="px" onChange={(v) => set({ fontSize: v })} />
          <Toggle on={(cfg as AppSettings['overlays']['bets']).showTop} onChange={(v) => set({ showTop: v })} label="Показывать крупнейшие ставки по исходам" />
        </>
      )}
      {key === 'music' && (
        <>
          <NumberField label="Размер шрифта" value={(cfg as AppSettings['overlays']['music']).fontSize} min={12} max={72} suffix="px" onChange={(v) => set({ fontSize: v })} />
          <Toggle on={(cfg as AppSettings['overlays']['music']).showRequester} onChange={(v) => set({ showRequester: v })} label="Кто заказал трек" />
          <Toggle on={(cfg as AppSettings['overlays']['music']).showProgress} onChange={(v) => set({ showProgress: v })} label="Полоса времени" />
          <Toggle on={(cfg as AppSettings['overlays']['music']).hideWhenPaused} onChange={(v) => set({ hideWhenPaused: v })} label="Прятать на паузе" />
        </>
      )}
      {key === 'subathon' && (
        <>
          <NumberField label="Размер таймера" value={(cfg as AppSettings['overlays']['subathon']).fontSize} min={16} max={200} suffix="px" onChange={(v) => set({ fontSize: v })} />
          <Toggle on={(cfg as AppSettings['overlays']['subathon']).showAdds} onChange={(v) => set({ showAdds: v })} label="Всплывающие «+время»" />
        </>
      )}
      {key === 'goal' && <GoalOverlaySettings c={cfg as AppSettings['overlays']['goal']} set={set} />}
      {key === 'wheel' && <NumberField label="Скрыть после итога через" value={(cfg as AppSettings['overlays']['wheel']).hideAfterSec} min={0} max={600} suffix="сек (0 — не скрывать)" onChange={(v) => set({ hideAfterSec: v })} />}
      {key === 'pinned' && (
        <NumberField label="Размер шрифта" value={(cfg as { fontSize: number }).fontSize} min={12} max={96} suffix="px" onChange={(v) => set({ fontSize: v })} />
      )}
    </div>
  )
}

function ChatSettings({ c, set }: { c: ChatOverlaySettings; set: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="grid g3" style={{ gap: 10 }}>
        <NumberField label="Шрифт" value={c.fontSize} min={10} max={72} suffix="px" onChange={(v) => set({ fontSize: v })} />
        <NumberField label="Сообщений" value={c.maxMessages} min={1} max={100} onChange={(v) => set({ maxMessages: v })} />
        <NumberField label="Скрывать через" value={c.hideAfterSec} min={0} max={3600} suffix="сек (0 — нет)" onChange={(v) => set({ hideAfterSec: v })} />
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Toggle on={c.showBadges} onChange={(v) => set({ showBadges: v })} label="Бейджи" />
        <Toggle on={c.showPlatform} onChange={(v) => set({ showPlatform: v })} label="Значок площадки" />
        <Toggle on={c.showStatus} onChange={(v) => set({ showStatus: v })} label={<>Строки о сбоях площадок <Hint id="showStatus" /></>} />
      </div>
    </>
  )
}

function VizOverlaySettings({ c, snap, set }: { c: VizSettings; snap: HubSnapshot; set: (p: Record<string, unknown>) => void }) {
  const [inputs, setInputs] = useState<{ id: string; label: string }[]>([])
  useEffect(() => { if (c.source === 'device') void audioInputs().then(setInputs).catch(() => setInputs([])) }, [c.source, c.enabled])
  const st = snap.viz
  return (
    <>
      <Toggle on={c.enabled} onChange={(v) => set({ enabled: v })} label="Слушать звук" />
      <p className="small muted" style={{ margin: '4px 0 10px' }}>
        Звук слушает Crossember, пока галочка стоит и оверлей открыт в OBS или браузере. В оверлей уходят только уровни полос — сам звук никуда не передаётся и не записывается.
        {c.enabled && <> Сейчас: <b>{st.state === 'on' ? 'слушает' : st.state === 'error' ? `ошибка — ${st.error}` : 'ждёт, пока откроют оверлей'}</b>.</>}
      </p>
      <div className="field">
        <label>Что слушать</label>
        <div className="seg">
          <button className={c.source === 'system' ? 'on' : ''} onClick={() => set({ source: 'system' })}>Звук системы</button>
          <button className={c.source === 'device' ? 'on' : ''} onClick={() => set({ source: 'device' })}>Устройство записи</button>
        </div>
        <span className="small muted">
          {c.source === 'system' ? 'Всё, что слышно в колонках или наушниках этого ПК: музыка, игра, браузер.' : 'Микрофон, карта захвата или виртуальный кабель. При двух ПК — звук игры, пришедший на стрим-ПК.'}
        </span>
      </div>
      {c.source === 'device' && (
        <div className="field">
          <label>Устройство</label>
          <select className="input" value={c.deviceId} onChange={(e) => set({ deviceId: e.target.value })}>
            <option value="">Устройство по умолчанию</option>
            {inputs.filter((d) => d.id !== 'default').map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label>Вид</label>
        <div className="seg">
          {(Object.keys(VIZ_STYLES) as VizStyle[]).map((v) => <button key={v} className={c.style === v ? 'on' : ''} onClick={() => set({ style: v })}>{VIZ_STYLES[v]}</button>)}
        </div>
      </div>
      <div className="grid g3" style={{ gap: 10 }}>
        <NumberField label="Полос" value={c.bars} min={8} max={96} onChange={(v) => set({ bars: v })} />
        <NumberField label="Чувствительность" value={c.gain} min={10} max={400} suffix="%" onChange={(v) => set({ gain: v })} />
        <NumberField label="Плавность" value={c.smooth} min={0} max={95} onChange={(v) => set({ smooth: v })} />
      </div>
      <div className="set-row" style={{ marginTop: 8 }}>
        <Toggle on={c.color !== ''} onChange={(v) => set({ color: v ? '#ffffff' : '' })} label="Свой цвет" />
        {c.color !== '' && <input type="color" value={c.color} onChange={(e) => set({ color: e.target.value })} />}
        {c.color === '' && <span className="small muted">— цвет темы оверлея</span>}
      </div>
    </>
  )
}

/** Режим «2 ПК»: нажатия приходят с игрового ПК, где Crossember запущен в режиме «Помощник». */
function KeysHelperBox({ snap }: { snap: HubSnapshot }) {
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const h = snap.server?.keysHelper
  return (
    <div className="note" style={{ margin: '0 0 12px' }}>
      <b>Игровой ПК.</b> Поставьте туда Crossember, в первом окне выберите «Два ПК» → «Игровой ПК» и вставьте эту ссылку.
      {h?.url ? (
        <>
          <div className="url" style={{ marginTop: 8 }}>
            <code title="В ссылке ключ — не показывайте её в эфире">{h.url.replace(/k=.+$/, 'k=••••••')}</code>
            <button className="btn sm" onClick={() => { void window.hub.copy(h.url!); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Скопировано ✓' : 'Ссылка для игрового ПК'}</button>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            <span className={`dot ${h.connected ? 'ok' : ''}`} /> {h.connected ? `Игровой ПК подключён${h.connected > 1 ? ` (${h.connected})` : ''}` : 'Игровой ПК не подключён'}
          </div>
          <KeyRotate label="Перевыпустить ключ игрового ПК" confirm={confirm} onAsk={() => setConfirm(true)} onCancel={() => setConfirm(false)} onYes={() => { void window.hub.rotateKey('keys'); setConfirm(false) }} />
        </>
      ) : (
        <div className="small" style={{ marginTop: 6 }}>Сначала включите «Настройки → Чат на другом устройстве» и выберите адрес этого ПК в домашней сети — по нему игровой ПК найдёт стрим-ПК.</div>
      )}
    </div>
  )
}

function KeysSettings({ c, snap, set }: { c: KeysOverlaySettings; snap: HubSnapshot; set: (p: Record<string, unknown>) => void }) {
  const free = Object.keys(KEY_DEFS).filter((id) => !c.extra.includes(id))
  return (
    <>
      <Toggle on={c.capture} onChange={(v) => set({ capture: v })} label="Показывать мои нажатия" />
      <p className="small muted" style={{ margin: '4px 0 10px' }}>
        Crossember видит нажатия, только пока галочка стоит и оверлей открыт в OBS или в браузере. В оверлей уходят лишь клавиши,
        которые на нём нарисованы, ничего не записывается, движение мыши не передаётся. Но нарисованные буквы загораются при любом наборе —
        в чате и в полях паролей тоже. Перед вводом пароля в эфире снимите галочку или скройте источник в OBS.
      </p>
      {snap.settings.setupMode === 'two' && <KeysHelperBox snap={snap} />}
      <div className="field">
        <label>Раскладка</label>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {(Object.keys(KEYS_PRESETS) as KeysPreset[]).map((p) => <button key={p} className={c.preset === p ? 'on' : ''} onClick={() => set({ preset: p })}>{KEYS_PRESETS[p].name}</button>)}
        </div>
      </div>
      <Toggle on={c.mouse} onChange={(v) => set({ mouse: v })} label="Мышь: кнопки и колесо" />
      <div className="field" style={{ marginTop: 10 }}>
        <label>Свои клавиши (отдельным рядом)</label>
        <div className="chips">
          {c.extra.map((id) => <button key={id} className="on" title="Убрать" onClick={() => set({ extra: c.extra.filter((x) => x !== id) })}>{KEY_DEFS[id].label} ✕</button>)}
          {c.extra.length < 20 && (
            <select className="input" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && set({ extra: [...c.extra, e.target.value] })}>
              <option value="">+ Добавить клавишу</option>
              {free.map((id) => <option key={id} value={id}>{id === KEY_DEFS[id].label ? id : `${id} (${KEY_DEFS[id].label})`}</option>)}
            </select>
          )}
        </div>
      </div>
      <div className="grid g2" style={{ gap: 10 }}>
        <NumberField label="Размер клавиши" value={c.size} min={24} max={140} suffix="px" onChange={(v) => set({ size: v })} />
        <NumberField label="Яркость ненажатых" value={c.idle} min={0} max={100} suffix="%" onChange={(v) => set({ idle: v })} />
      </div>
    </>
  )
}

function CounterSettings({ c, snap, set }: { c: AppSettings['overlays']['counter']; snap: HubSnapshot; set: (p: Record<string, unknown>) => void }) {
  const all = c.ids.length === 0
  const toggle = (id: string): void => {
    const cur = all ? [] : c.ids.filter((x) => snap.counters.some((k) => k.id === x))
    set({ ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  }
  return (
    <>
      <div className="field">
        <label>Какие показывать</label>
        {snap.counters.length ? (
          <div className="chips">
            <button className={all ? 'on' : ''} onClick={() => set({ ids: [] })}>Все</button>
            {snap.counters.map((k) => <button key={k.id} className={!all && c.ids.includes(k.id) ? 'on' : ''} onClick={() => toggle(k.id)}>{k.name}</button>)}
          </div>
        ) : <p className="small muted" style={{ margin: 0 }}>Счётчиков пока нет — добавьте в «Правила» → «Счётчики».</p>}
      </div>
      <div className="grid g2" style={{ gap: 10 }}>
        <div className="field">
          <label>Расположение</label>
          <div className="seg">
            <button className={c.layout === 'column' ? 'on' : ''} onClick={() => set({ layout: 'column' })}>Столбиком</button>
            <button className={c.layout === 'row' ? 'on' : ''} onClick={() => set({ layout: 'row' })}>В строку</button>
          </div>
        </div>
        <NumberField label="Размер шрифта" value={c.fontSize} min={12} max={96} suffix="px" onChange={(v) => set({ fontSize: v })} />
      </div>
    </>
  )
}

function AuctionOverlaySettings({ c, set }: { c: AppSettings['overlays']['auction']; set: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="field">
        <label>Что показывать у лота</label>
        <div className="seg">
          <button className={c.show === 'sum' ? 'on' : ''} onClick={() => set({ show: 'sum' })}>Сумму</button>
          <button className={c.show === 'pct' ? 'on' : ''} onClick={() => set({ show: 'pct' })}>Долю, %</button>
          <button className={c.show === 'both' ? 'on' : ''} onClick={() => set({ show: 'both' })}>Обе</button>
        </div>
      </div>
      <div className="grid g2" style={{ gap: 10 }}>
        <NumberField label="Сколько лотов" value={c.count} min={1} max={20} onChange={(v) => set({ count: v })} />
        <NumberField label="Размер шрифта" value={c.fontSize} min={12} max={72} suffix="px" onChange={(v) => set({ fontSize: v })} />
      </div>
      <Toggle on={c.showTimer} onChange={(v) => set({ showTimer: v })} label="Показывать таймер" />
    </>
  )
}

function VoteOverlaySettings({ c, set }: { c: AppSettings['overlays']['vote']; set: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="field">
        <label>Что показывать у варианта</label>
        <div className="seg">
          <button className={c.show === 'votes' ? 'on' : ''} onClick={() => set({ show: 'votes' })}>Голоса</button>
          <button className={c.show === 'pct' ? 'on' : ''} onClick={() => set({ show: 'pct' })}>Долю, %</button>
          <button className={c.show === 'both' ? 'on' : ''} onClick={() => set({ show: 'both' })}>Обе</button>
        </div>
      </div>
      <div className="grid g2" style={{ gap: 10 }}>
        <NumberField label="Сколько вариантов" value={c.count} min={1} max={20} onChange={(v) => set({ count: v })} />
        <NumberField label="Размер шрифта" value={c.fontSize} min={12} max={72} suffix="px" onChange={(v) => set({ fontSize: v })} />
      </div>
      <Toggle on={c.showHint} onChange={(v) => set({ showHint: v })} label="Подсказка «как голосовать» внизу" />
    </>
  )
}

function GoalOverlaySettings({ c, set }: { c: AppSettings['overlays']['goal']; set: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="grid g2" style={{ gap: 10 }}>
        <NumberField label="Размер шрифта" value={c.fontSize} min={12} max={72} suffix="px" onChange={(v) => set({ fontSize: v })} />
        <NumberField label="Сколько в топе" value={c.topCount} min={1} max={5} onChange={(v) => set({ topCount: v })} />
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Toggle on={c.showStages} onChange={(v) => set({ showStages: v })} label="Этапы на полоске" />
        <Toggle on={c.showLast} onChange={(v) => set({ showLast: v })} label="Последний донат" />
        <Toggle on={c.showTop} onChange={(v) => set({ showTop: v })} label="Топ сбора" />
        <Toggle on={c.showTimer} onChange={(v) => set({ showTimer: v })} label="Срок" />
        <Toggle on={c.celebrate} onChange={(v) => set({ celebrate: v })} label="Праздник при достижении" />
      </div>
    </>
  )
}

const PERIODS: [StatsPeriod, string][] = [['stream', 'Эфир'], ['today', 'Сегодня'], ['week', '7 дней'], ['month', '30 дней'], ['all', 'Всё время']]

function TopSettings({ c, set }: { c: AppSettings['overlays']['top']; set: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="field">
        <label>Период <Hint id="stats" /></label>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {PERIODS.map(([id, l]) => <button key={id} className={c.period === id ? 'on' : ''} onClick={() => set({ period: id })}>{l}</button>)}
        </div>
      </div>
      <div className="grid g2" style={{ gap: 10 }}>
        <NumberField label="Сколько человек" value={c.count} min={1} max={20} onChange={(v) => set({ count: v })} />
        <NumberField label="Размер шрифта" value={c.fontSize} min={12} max={72} suffix="px" onChange={(v) => set({ fontSize: v })} />
      </div>
    </>
  )
}

import { useMemo, useState } from 'react'
import { GUIDE, type GuideSection } from './guidetext'
import mark from './assets/mark.svg'

const GROUPS: GuideSection['group'][] = ['Начало', 'Эфир', 'Алерты и интерактив', 'Оверлеи', 'Настройка', 'Вопросы']

/** Окно «Справка → Руководство»: слева разделы, справа — что это, возможности и как настроить по шагам. */
export function Guide() {
  const [id, setId] = useState(GUIDE[0]?.id ?? '')
  const [q, setQ] = useState('')
  const found = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return GUIDE
    return GUIDE.filter((g) => [g.title, g.what, ...g.can, ...g.steps.flatMap((x) => [x.title, ...x.items]), ...(g.tips ?? [])].join(' ').toLowerCase().includes(s))
  }, [q])
  const cur = GUIDE.find((g) => g.id === id) ?? found[0]
  return (
    <div className="guide">
      <aside className="guide-side">
        <div className="brand" style={{ padding: '0 6px 14px' }}>
          <img src={mark} alt="" />
          <div><b>Руководство</b><small>как устроен Crossember</small></div>
        </div>
        <input className="input" placeholder="Поиск по руководству" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="guide-nav">
          {GROUPS.map((gr) => {
            const list = found.filter((g) => g.group === gr)
            return list.length > 0 && (
              <div key={gr}>
                <div className="side-sep">{gr}</div>
                {list.map((g) => <button key={g.id} className={`nav ${cur?.id === g.id ? 'on' : ''}`} onClick={() => setId(g.id)}>{g.title}</button>)}
              </div>
            )
          })}
          {!found.length && <p className="small muted" style={{ padding: 8 }}>Ничего не нашлось.</p>}
        </div>
      </aside>
      <main className="guide-main">
        {cur ? (
          <article key={cur.id}>
            <div className="small muted">{cur.group}</div>
            <h1>{cur.title}</h1>
            <p className="guide-what">{cur.what}</p>
            <h3>Что можно</h3>
            <ul>{cur.can.map((t, i) => <li key={i}>{t}</li>)}</ul>
            {cur.steps.map((s, i) => (
              <section key={i} className="card guide-steps">
                <h3>{s.title}</h3>
                <ol>{s.items.map((t, j) => <li key={j}>{t}</li>)}</ol>
              </section>
            ))}
            {cur.tips?.length ? <div className="note"><b>Советы.</b><ul>{cur.tips.map((t, i) => <li key={i}>{t}</li>)}</ul></div> : null}
          </article>
        ) : <p className="muted">Руководство пока пустое.</p>}
      </main>
    </div>
  )
}

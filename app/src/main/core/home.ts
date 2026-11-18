// Раскладка главной: какие блоки показаны и где они стоят на сетке. Модуль без node-импортов (ядро и интерфейс).
// Сетка — HOME_COLS × HOME_ROWS клеток на весь экран главной, без прокрутки: блоки масштабируются под свою клетку.

export const HOME_COLS = 12
export const HOME_ROWS = 12

export const HOME_BLOCKS = [
  'viewers', 'obs', 'alerts', 'streaminfo', 'connections', 'events', 'quick', 'chat', 'music', 'counters',
  'auction', 'vote', 'bets', 'rewards', 'subathon', 'wheel', 'goal', 'giveaway'
] as const
export type HomeBlock = (typeof HOME_BLOCKS)[number]

export const HOME_BLOCK_INFO: Record<HomeBlock, { name: string; desc: string; minW: number; minH: number }> = {
  viewers: { name: 'Зрители', desc: 'Сколько смотрят на каждой площадке', minW: 2, minH: 2 },
  obs: { name: 'OBS Studio', desc: 'Сцена, эфир, разрешение', minW: 2, minH: 2 },
  alerts: { name: 'Алерты', desc: 'Очередь и пауза', minW: 2, minH: 2 },
  streaminfo: { name: 'Название и категория', desc: 'Поменять сразу на всех площадках', minW: 5, minH: 4 },
  connections: { name: 'Подключения', desc: 'Что работает, а что отвалилось', minW: 3, minH: 2 },
  events: { name: 'Последние события', desc: 'Донаты, подписки, рейды', minW: 3, minH: 2 },
  quick: { name: 'Под рукой', desc: 'Быстрые переходы по разделам', minW: 2, minH: 2 },
  chat: { name: 'Чат', desc: 'Последние сообщения всех площадок', minW: 3, minH: 2 },
  music: { name: 'Музыка', desc: 'Что играет, пауза и следующий трек', minW: 2, minH: 2 },
  counters: { name: 'Счётчики', desc: 'Смерти, победы и свои счётчики с кнопками ±', minW: 2, minH: 2 },
  auction: { name: 'Аукцион', desc: 'Идёт ли приём, лоты и сумма', minW: 2, minH: 2 },
  vote: { name: 'Голосование', desc: 'Быстрое и долгое', minW: 2, minH: 2 },
  bets: { name: 'Ставки', desc: 'Приём, банк, итог', minW: 2, minH: 2 },
  rewards: { name: 'Награды за баллы', desc: 'Кто что выбрал и ждёт', minW: 2, minH: 2 },
  subathon: { name: 'Сабатон', desc: 'Сколько осталось', minW: 2, minH: 2 },
  wheel: { name: 'Колесо', desc: 'Варианты и что выпало', minW: 2, minH: 2 },
  goal: { name: 'Сбор средств', desc: 'Сколько собрано', minW: 2, minH: 2 },
  giveaway: { name: 'Розыгрыш', desc: 'Участники и победитель', minW: 2, minH: 2 }
}

export interface HomeItem { id: HomeBlock; x: number; y: number; w: number; h: number }

/** Вид по умолчанию: три блока сверху, название эфира, три блока снизу. */
export const DEFAULT_HOME: HomeItem[] = [
  { id: 'viewers', x: 0, y: 0, w: 4, h: 3 },
  { id: 'obs', x: 4, y: 0, w: 4, h: 3 },
  { id: 'alerts', x: 8, y: 0, w: 4, h: 3 },
  { id: 'streaminfo', x: 0, y: 3, w: 12, h: 4 },
  { id: 'connections', x: 0, y: 7, w: 4, h: 5 },
  { id: 'events', x: 4, y: 7, w: 4, h: 5 },
  { id: 'quick', x: 8, y: 7, w: 4, h: 5 }
]

export const overlaps = (a: HomeItem, b: HomeItem): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Проверка раскладки из настроек: блоки из списка, по одному, в пределах сетки, не крупнее/мельче допустимого, без наложений. */
export function sanitizeHome(v: unknown): HomeItem[] {
  if (!Array.isArray(v)) return DEFAULT_HOME.map((i) => ({ ...i }))
  const out: HomeItem[] = []
  for (const raw of v.slice(0, HOME_BLOCKS.length)) {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const id = o.id as HomeBlock
    if (!(HOME_BLOCKS as readonly string[]).includes(id) || out.some((i) => i.id === id)) continue
    const m = HOME_BLOCK_INFO[id]
    const n = (x: unknown, lo: number, hi: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : lo)
    const w = n(o.w, m.minW, HOME_COLS)
    const h = n(o.h, m.minH, HOME_ROWS)
    const item = { id, w, h, x: n(o.x, 0, HOME_COLS - w), y: n(o.y, 0, HOME_ROWS - h) }
    if (out.some((i) => overlaps(i, item))) continue
    out.push(item)
  }
  return out
}

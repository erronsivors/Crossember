import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs'
import type { HubEvent } from './types'

/** Что удалось спасти из повреждённой базы при запуске. */
export interface StoreRescue {
  /** Папка, куда перенесены повреждённые файлы. */
  folder: string
  settings: number
  secrets: number
  events: number
  /** Ключи настроек и входов, которые были в базе, но прочитать их не удалось. */
  lost: string[]
  /** Из какой ежедневной копии восстановлено (ГГГГ-ММ-ДД); null — копий не было, спасено только читаемое. */
  backup: string | null
}

/** Ежедневные копии: data/backups/hub-ГГГГ-ММ-ДД.sqlite3, хранятся последние KEEP_BACKUPS. */
const KEEP_BACKUPS = 7
const BACKUP_RE = /^hub-(\d{4}-\d{2}-\d{2})\.sqlite3$/

const BASE_TABLES = ['settings', 'secrets', 'events']

/** Локальное хранилище: один файл SQLite в папке данных пользователя. */
export class Store {
  private db!: DatabaseSync
  /** После close() чтение отдаёт «пусто», запись пропускается: при выходе таймеры модулей ещё срабатывают. */
  private closed = false
  /** Не null — база была повреждена и собрана заново из того, что читалось. */
  readonly rescued: StoreRescue | null = null

  private backups: string

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.backups = join(dir, 'backups')
    const file = join(dir, 'hub.sqlite3')
    let db: DatabaseSync | null = null
    try { db = this.open(file) } catch { db = null }
    if (db && healthy(db)) this.db = db
    else {
      try { db?.close() } catch { /* уже закрыта */ }
      this.rescued = this.rescue(dir, file)
    }
    this.backupDaily()
  }

  /**
   * Копия базы раз в сутки (VACUUM INTO даёт целую копию и на работающей базе). Повреждённую базу не копируем,
   * чтобы она не вытеснила хорошие копии.
   */
  backupDaily(): void {
    if (this.closed) return
    const day = new Date().toLocaleDateString('sv-SE') // ГГГГ-ММ-ДД по местному времени
    const target = join(this.backups, `hub-${day}.sqlite3`)
    try {
      if (existsSync(target) || !healthy(this.db)) return
      mkdirSync(this.backups, { recursive: true })
      const tmp = `${target}.part`
      if (existsSync(tmp)) unlinkSync(tmp)
      this.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`)
      renameSync(tmp, target)
      const old = readdirSync(this.backups).filter((f) => BACKUP_RE.test(f)).sort().reverse().slice(KEEP_BACKUPS)
      for (const f of old) unlinkSync(join(this.backups, f))
    } catch { /* копия не получилась — попробуем при следующей проверке */ }
  }

  /** Самая свежая целая копия: путь и дата. */
  private bestBackup(): { path: string; day: string } | null {
    let files: string[] = []
    try { files = readdirSync(this.backups).filter((f) => BACKUP_RE.test(f)).sort().reverse() } catch { return null }
    for (const f of files) {
      const path = join(this.backups, f)
      try {
        const db = new DatabaseSync(path, { readOnly: true })
        const ok = healthy(db)
        db.close()
        if (ok) return { path, day: BACKUP_RE.exec(f)![1] }
      } catch { /* битая копия — следующая */ }
    }
    return null
  }

  private open(file: string): DatabaseSync {
    const db = new DatabaseSync(file)
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS secrets  (key TEXT PRIMARY KEY, value BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, ts INTEGER NOT NULL, platform TEXT NOT NULL, type TEXT NOT NULL,
        user TEXT NOT NULL, text TEXT, amount REAL, currency TEXT, test INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
    `)
    // Миграция: сумма в рублях для статистики (этап 3).
    const cols = db.prepare('PRAGMA table_info(events)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'amount_rub')) db.exec('ALTER TABLE events ADD COLUMN amount_rub REAL')
    return db
  }

  /**
   * Повреждённая база: файлы — в папку broken-<время>, рядом новая база, в неё переносим всё, что читается.
   * Повреждение бывает незаметным: поиск по индексу отдаёт чужую строку, поэтому каждое значение,
   * найденное через индекс, принимаем только если ключ строки совпал с искомым.
   */
  private rescue(dir: string, file: string): StoreRescue {
    const folder = join(dir, `broken-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`)
    mkdirSync(folder, { recursive: true })
    for (const ext of ['', '-wal', '-shm']) if (existsSync(file + ext)) renameSync(file + ext, join(folder, `hub.sqlite3${ext}`))
    // Есть целая копия — она основа (настройки, правила, входы — согласованные); из повреждённой добавляем
    // только то, чего в копии нет: свежие события и новые ключи.
    const best = this.bestBackup()
    if (best) copyFileSync(best.path, file)
    this.db = this.open(file)
    const out: StoreRescue = { folder, settings: 0, secrets: 0, events: 0, lost: [], backup: best?.day ?? null }
    let old: DatabaseSync
    try { old = new DatabaseSync(join(folder, 'hub.sqlite3')) } catch { return out }
    try {
      for (const t of ['settings', 'secrets'] as const) {
        const got = new Map<string, unknown>()
        for (const r of scan(old, t, 'key, value')) if (typeof r.key === 'string') got.set(r.key, r.value)
        for (const r of scan(old, t, 'key', `INDEXED BY sqlite_autoindex_${t}_1`)) {
          const k = r.key
          if (typeof k !== 'string' || got.has(k)) continue
          try {
            const row = old.prepare(`SELECT key, value FROM ${t} WHERE key = ?`).get(k) as { key: unknown; value: unknown } | undefined
            if (row && row.key === k) got.set(k, row.value)
            else if (!this.has(t, k)) out.lost.push(k)
          } catch { if (!this.has(t, k)) out.lost.push(k) }
        }
        const put = this.db.prepare(`INSERT OR ${best ? 'IGNORE' : 'REPLACE'} INTO ${t}(key, value) VALUES(?, ?)`)
        for (const [k, v] of got) { try { put.run(k, v as string) } catch { if (!this.has(t, k)) out.lost.push(k) } }
        out[t] = (this.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
      }
      const ev = this.db.prepare('INSERT OR IGNORE INTO events(id, ts, platform, type, user, text, amount, currency, test, amount_rub) VALUES(?,?,?,?,?,?,?,?,?,?)')
      for (const r of scan(old, 'events', 'id, ts, platform, type, user, text, amount, currency, test, amount_rub')) {
        try { out.events += Number(ev.run(r.id as string, r.ts as number, r.platform as string, r.type as string, r.user as string, (r.text ?? null) as string | null, (r.amount ?? null) as number | null, (r.currency ?? null) as string | null, (r.test ?? 0) as number, (r.amount_rub ?? null) as number | null).changes) } catch { /* битая строка */ }
      }
      // Таблицы модулей (аналитика): схема и строки как были; что не читается — пропадает.
      let extra: { name: string; sql: string; type: string }[] = []
      try { extra = old.prepare("SELECT name, sql, type FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC").all() as typeof extra } catch { /* схема не читается */ }
      for (const x of extra) {
        if (BASE_TABLES.includes(x.name) || x.name === 'events_ts') continue
        try { this.db.exec(x.sql) } catch { /* уже есть (из копии) или не создаётся */ }
        if (x.type !== 'table') continue
        for (const r of scan(old, x.name, '*')) {
          const keys = Object.keys(r)
          try { this.db.prepare(`INSERT OR IGNORE INTO "${x.name}"(${keys.map((k) => `"${k}"`).join(', ')}) VALUES(${keys.map(() => '?').join(', ')})`).run(...(keys.map((k) => r[k]) as never[])) } catch { /* битая строка */ }
        }
      }
    } finally {
      try { old.close() } catch { /* ок */ }
    }
    return out
  }

  private has(table: 'settings' | 'secrets', key: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM ${table} WHERE key = ?`).get(key)
  }

  /** Прямой доступ к базе для модулей со своими таблицами (аналитика). */
  get sql(): DatabaseSync {
    return this.db
  }

  get<T>(key: string, fallback: T): T {
    if (this.closed) return fallback
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return fallback
    try {
      return JSON.parse(row.value) as T
    } catch {
      return fallback
    }
  }

  set(key: string, value: unknown): void {
    if (this.closed) return
    this.db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value))
  }

  getSecretBlob(key: string): Buffer | null {
    if (this.closed) return null
    const row = this.db.prepare('SELECT value FROM secrets WHERE key = ?').get(key) as { value: Uint8Array } | undefined
    return row ? Buffer.from(row.value) : null
  }

  setSecretBlob(key: string, value: Buffer | null): void {
    if (this.closed) return
    if (value === null) this.db.prepare('DELETE FROM secrets WHERE key = ?').run(key)
    else this.db.prepare('INSERT INTO secrets(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  addEvent(e: HubEvent): void {
    if (this.closed) return
    this.db.prepare('INSERT OR IGNORE INTO events(id, ts, platform, type, user, text, amount, currency, test, amount_rub) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(e.id, e.ts, e.platform, e.type, e.user, e.text ?? null, e.amount ?? null, e.currency ?? null, e.test ? 1 : 0, e.amountRub ?? null)
  }

  recentEvents(limit = 100): HubEvent[] {
    if (this.closed) return []
    const rows = this.db.prepare('SELECT * FROM events WHERE type != ? ORDER BY ts DESC LIMIT ?').all('message', limit) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: String(r.id), ts: Number(r.ts), platform: r.platform as HubEvent['platform'], type: r.type as HubEvent['type'],
      user: String(r.user), text: (r.text as string) ?? undefined, amount: (r.amount as number) ?? undefined,
      currency: (r.currency as string) ?? undefined, test: r.test === 1, amountRub: (r.amount_rub as number) ?? undefined
    }))
  }

  /** Есть ли уже событие с таким id (защита от повторов при переподключении). */
  hasEvent(id: string): boolean {
    if (this.closed) return false
    return !!this.db.prepare('SELECT 1 FROM events WHERE id = ?').get(id)
  }

  /** Итоги с момента since (тестовые не считаются). */
  totals(since: number): { type: string; platform: string; count: number; rub: number }[] {
    if (this.closed) return []
    return this.db.prepare(
      'SELECT type, platform, COUNT(*) AS count, COALESCE(SUM(amount_rub), 0) AS rub FROM events WHERE test = 0 AND ts >= ? AND type != ? GROUP BY type, platform'
    ).all(since, 'message') as { type: string; platform: string; count: number; rub: number }[]
  }

  /** Топ донатеров по сумме в рублях с момента since. Один ник с разных сервисов складывается. */
  topDonors(since: number, limit: number): { user: string; rub: number; count: number }[] {
    if (this.closed) return []
    return this.db.prepare(
      `SELECT MAX(user) AS user, SUM(amount_rub) AS rub, COUNT(*) AS count FROM events
       WHERE test = 0 AND type = 'donation' AND amount_rub IS NOT NULL AND ts >= ?
       GROUP BY LOWER(user) ORDER BY rub DESC LIMIT ?`
    ).all(since, limit) as { user: string; rub: number; count: number }[]
  }

  /** Последнее настоящее событие указанного типа. */
  lastEvent(type: string): HubEvent | null {
    if (this.closed) return null
    const r = this.db.prepare('SELECT * FROM events WHERE test = 0 AND type = ? ORDER BY ts DESC LIMIT 1').get(type) as Record<string, unknown> | undefined
    if (!r) return null
    return {
      id: String(r.id), ts: Number(r.ts), platform: r.platform as HubEvent['platform'], type: r.type as HubEvent['type'],
      user: String(r.user), text: (r.text as string) ?? undefined, amount: (r.amount as number) ?? undefined,
      currency: (r.currency as string) ?? undefined, amountRub: (r.amount_rub as number) ?? undefined
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    // Перенести всё из журнала WAL в основной файл и обнулить журнал: после выхода не остаётся «подвешенных» данных.
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* закроем как есть */ }
    this.db.close()
  }
}

/** Быстрая проверка целостности; ошибка при проверке — тоже «не цела». */
function healthy(db: DatabaseSync): boolean {
  try {
    const rows = db.prepare('PRAGMA quick_check').all() as Record<string, unknown>[]
    return rows.length === 1 && Object.values(rows[0])[0] === 'ok'
  } catch {
    return false
  }
}

/**
 * Прочитать строки таблицы, сколько получится. Сначала целиком; если чтение обрывается на битой странице —
 * кусками по rowid, перешагивая через ошибки (не дальше 2000 ошибок подряд).
 */
function scan(db: DatabaseSync, table: string, cols: string, how = 'NOT INDEXED'): Record<string, unknown>[] {
  try {
    return db.prepare(`SELECT ${cols} FROM "${table}" ${how}`).all() as Record<string, unknown>[]
  } catch { /* читаем по кускам */ }
  if (how !== 'NOT INDEXED') return []
  const out: Record<string, unknown>[] = []
  let after = 0
  let fails = 0
  while (fails < 2000) {
    try {
      const rows = db.prepare(`SELECT rowid AS _rid, ${cols} FROM "${table}" NOT INDEXED WHERE rowid > ? ORDER BY rowid LIMIT 100`).all(after) as Record<string, unknown>[]
      if (!rows.length) break
      for (const r of rows) { after = Number(r._rid); delete r._rid; out.push(r) }
      fails = 0
    } catch {
      after++
      fails++
    }
  }
  return out
}

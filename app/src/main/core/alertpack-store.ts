// Импорт основного набора алертов из папки Crossember-Alerts в данные приложения.
// Файлы берутся из archives/<набор>.zip: в папке assets часть файлов бывает закрыта на чтение.
// Если архива нет, но файл в assets читается — копируется он.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { PACK_FILES, PACK_SETS, packHas } from './alertpack'

export interface AlertPackState {
  installed: number
  total: number
  importing: { done: number; total: number } | null
  error: string
  missing: string[]
}

/** Минимальное чтение ZIP (без ZIP64): имя файла → содержимое. */
export function readZip(buf: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('файл не похож на ZIP-архив')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('повреждённый ZIP-архив')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (!want(name)) continue
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + csize)
    if (method === 0) out.set(name, Buffer.from(data))
    else if (method === 8) out.set(name, inflateRawSync(data))
    else throw new Error(`неподдерживаемое сжатие в архиве (${method})`)
  }
  return out
}

export class AlertPack {
  private importing: AlertPackState['importing'] = null
  private error = ''
  private missing: string[] = []
  onChange: () => void = () => undefined

  constructor(private readonly dir: string) {}

  private ready(id: string): boolean {
    return PACK_FILES.every((f) => existsSync(join(this.dir, id, f)))
  }

  state(): AlertPackState {
    return { installed: PACK_SETS.filter((s) => this.ready(s.id)).length, total: PACK_SETS.length, importing: this.importing, error: this.error, missing: this.missing }
  }

  /** Содержимое файла набора или null. */
  get(id: string, file: string): Buffer | null {
    if (!packHas(id) || !(PACK_FILES as readonly string[]).includes(file)) return null
    try { return readFileSync(join(this.dir, id, file)) } catch { return null }
  }

  /** Импорт из корня набора (с папками archives и assets) или из папки с архивами. Возвращает число импортированных наборов. */
  async importFrom(root: string): Promise<number> {
    if (this.importing) throw new Error('Импорт уже идёт')
    const archives = existsSync(join(root, 'archives')) ? join(root, 'archives') : root
    const zips = new Set(readdirSync(archives).filter((f) => f.endsWith('.zip')))
    if (!PACK_SETS.some((s) => zips.has(`${s.id}.zip`) || existsSync(join(root, 'assets', s.id)))) {
      throw new Error('В папке не найден набор Crossember-Alerts: нужна папка, где лежат archives и assets')
    }
    this.importing = { done: 0, total: PACK_SETS.length }
    this.error = ''
    this.missing = []
    this.onChange()
    let ok = 0
    try {
      for (const s of PACK_SETS) {
        // Отдать управление между наборами, чтобы окно не подвисало.
        await new Promise((r) => setImmediate(r))
        try {
          const files = new Map<string, Buffer>()
          if (zips.has(`${s.id}.zip`)) {
            const got = readZip(readFileSync(join(archives, `${s.id}.zip`)), (n) => (PACK_FILES as readonly string[]).includes(n.split('/').pop() ?? ''))
            for (const [n, b] of got) files.set(n.split('/').pop() ?? '', b)
          }
          for (const f of PACK_FILES) {
            if (files.has(f)) continue
            try { files.set(f, readFileSync(join(root, 'assets', s.id, f))) } catch { /* нет или закрыт на чтение */ }
          }
          const lack = PACK_FILES.filter((f) => !files.has(f))
          if (lack.length) { this.missing.push(`${s.name}: нет ${lack.join(', ')}`); continue }
          const dst = join(this.dir, s.id)
          mkdirSync(dst, { recursive: true })
          for (const [f, b] of files) { writeFileSync(join(dst, f + '.tmp'), b); renameSync(join(dst, f + '.tmp'), join(dst, f)) }
          ok++
        } catch (e) {
          this.missing.push(`${s.name}: ${(e as Error).message}`)
        }
        this.importing = { done: this.importing.done + 1, total: PACK_SETS.length }
        this.onChange()
      }
    } finally {
      this.importing = null
      if (this.missing.length) this.error = `Не удалось импортировать ${this.missing.length} из ${PACK_SETS.length}`
      this.onChange()
    }
    return ok
  }
}

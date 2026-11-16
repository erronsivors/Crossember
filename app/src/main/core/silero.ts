import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Hub } from './hub'

/**
 * Silero — нейросетевые русские голоса, которые ставятся по кнопке отдельным компонентом (как у Stream Tools):
 * свой Python (embeddable с python.org), PyTorch для процессора и модель Silero в папке данных.
 * В репозиторий и установщик Crossember ничего из этого не входит. Скачанное сверяется по SHA-256,
 * PyTorch ставит pip из официального индекса PyTorch с закреплённой версией.
 * Озвучка — фоновый процесс silero_worker.py: JSON-команды построчно в stdin, текст зрителя не попадает в командную строку.
 */

const PY = { url: 'https://www.python.org/ftp/python/3.13.17/python-3.13.17-embed-amd64.zip', sha: '9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38' }
const PIP = { url: 'https://bootstrap.pypa.io/pip/zipapp/pip-26.2.2.pyz', sha: 'e5ef64ef63ff89a746014ad81658b76c1940385fdcdbc4fcbfa6e3ef1887352d' }
const MODEL = { url: 'https://models.silero.ai/models/tts/ru/v5_6_ru.pt', sha: '04cc9b1d08ce38bcaa9d02c488d80d3e6806d17f7eaa7c95982f36a3cbf50b2e', file: 'v5_6_ru.pt' }
const TORCH = 'torch==2.14.1+cpu'
const TORCH_INDEX = 'https://download.pytorch.org/whl/cpu'
const VERSION = 'py3.13.17-torch2.14.1-v5_6_ru'
/** После стольких минут без озвучки процесс выгружается (модель занимает около 0,5 ГБ памяти). */
const IDLE_MS = 15 * 60 * 1000

export const SILERO_SPEAKERS: { id: string; label: string; gender: string }[] = [
  { id: 'aidar', label: 'Айдар', gender: 'Male' },
  { id: 'eugene', label: 'Евгений', gender: 'Male' },
  { id: 'baya', label: 'Бая', gender: 'Female' },
  { id: 'kseniya', label: 'Ксения', gender: 'Female' },
  { id: 'xenia', label: 'Ксения 2', gender: 'Female' }
]

export interface SileroStatus {
  state: 'none' | 'installing' | 'ready' | 'error'
  /** Что сейчас делается (по-русски). */
  step: string
  /** 0…1 для текущего шага, -1 — неизвестно. */
  progress: number
  error: string
}

export class Silero {
  private dir: string
  private status: SileroStatus = { state: 'none', step: '', progress: -1, error: '' }
  private proc: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private waiting: ((r: Record<string, unknown>) => void)[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private idle: NodeJS.Timeout | null = null

  constructor(root: string, private resourcesDir: string, private hub: Hub) {
    this.dir = join(root, 'silero')
    void readFile(join(this.dir, 'ready.json'), 'utf8')
      .then((t) => { if ((JSON.parse(t) as { version?: string }).version === VERSION) this.status = { state: 'ready', step: '', progress: -1, error: '' } })
      .catch(() => undefined)
  }

  get(): SileroStatus { return { ...this.status } }
  ready(): boolean { return this.status.state === 'ready' }

  private set(p: Partial<SileroStatus>): void { this.status = { ...this.status, ...p } }

  /** Скачать с проверкой SHA-256; уже скачанный файл с верной суммой не качается заново. */
  private async download(src: { url: string; sha: string }, path: string, step: string): Promise<void> {
    if (existsSync(path) && (await sha256(path)) === src.sha) return
    this.set({ step, progress: 0 })
    const r = await fetch(src.url, { signal: AbortSignal.timeout(30 * 60 * 1000) })
    if (!r.ok || !r.body) throw new Error(`${step}: сервер ответил ${r.status}`)
    const total = Number(r.headers.get('content-length')) || 0
    let got = 0
    const body = Readable.fromWeb(r.body as never)
    body.on('data', (c: Buffer) => { got += c.length; if (total) this.set({ progress: got / total }) })
    const tmp = `${path}.part`
    await pipeline(body, createWriteStream(tmp))
    if ((await sha256(tmp)) !== src.sha) { await unlink(tmp).catch(() => undefined); throw new Error(`${step}: файл повреждён или подменён (не сошлась контрольная сумма)`) }
    await rename(tmp, path)
  }

  private run(cmd: string, args: string[], step: string, onLine?: (l: string) => void): Promise<void> {
    this.set({ step, progress: -1 })
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { windowsHide: true, cwd: this.dir })
      let tail = ''
      const read = (d: Buffer): void => {
        const s = d.toString('utf8')
        tail = (tail + s).slice(-600)
        for (const l of s.split(/\r?\n/)) if (l.trim()) onLine?.(l.trim())
      }
      p.stdout.on('data', read)
      p.stderr.on('data', read)
      p.on('error', (e) => reject(new Error(`${step}: ${e.message}`)))
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${step}: ошибка ${code}. ${tail.split(/\r?\n/).filter(Boolean).slice(-2).join(' ')}`.slice(0, 400)))))
    })
  }

  /** Установка по кнопке. Можно повторить после ошибки — скачанное раньше не качается заново. */
  async install(): Promise<void> {
    if (this.status.state === 'installing') return
    this.set({ state: 'installing', error: '', step: 'Подготовка', progress: -1 })
    this.hub.log('hub', 'info', 'Silero: установка началась')
    try {
      const dl = join(this.dir, 'download')
      await mkdir(dl, { recursive: true })
      await this.download(PY, join(dl, 'python.zip'), 'Скачиваю Python (11 МБ)')
      const py = join(this.dir, 'python')
      await rm(py, { recursive: true, force: true })
      await mkdir(py, { recursive: true })
      await this.run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', join(dl, 'python.zip'), '-C', py], 'Распаковываю Python')
      // Embeddable Python видит только свои файлы и папку site рядом.
      await writeFile(join(py, 'python313._pth'), 'python313.zip\r\n.\r\n..\\site\r\n')
      await this.download(PIP, join(dl, 'pip.pyz'), 'Скачиваю установщик пакетов')
      const site = join(this.dir, 'site')
      if (!existsSync(join(site, 'torch'))) {
        await rm(site, { recursive: true, force: true })
        let n = 0
        await this.run(join(py, 'python.exe'), ['-I', join(dl, 'pip.pyz'), 'install', '--disable-pip-version-check', '--no-cache-dir', '--progress-bar', 'off',
          '--only-binary=:all:', '--target', site, '--index-url', TORCH_INDEX, TORCH], 'Скачиваю и ставлю PyTorch (около 250 МБ, несколько минут)',
        (l) => { if (/^(Downloading|Collecting)/.test(l)) this.set({ progress: Math.min(0.95, ++n / 22) }) })
      }
      await this.download(MODEL, join(this.dir, MODEL.file), 'Скачиваю модель Silero (148 МБ)')
      this.set({ step: 'Проверяю озвучку', progress: -1 })
      await rm(dl, { recursive: true, force: true })
      this.set({ state: 'ready' })
      const test = join(this.dir, 'test.wav')
      await this.speak('Проверка.', 'xenia', 2, test)
      await unlink(test).catch(() => undefined)
      await writeFile(join(this.dir, 'ready.json'), JSON.stringify({ version: VERSION, at: new Date().toISOString() }))
      this.set({ step: '', progress: -1 })
      this.hub.log('hub', 'info', 'Silero: установлен')
    } catch (e) {
      const msg = (e as Error).message
      this.set({ state: 'error', error: msg, step: '', progress: -1 })
      this.hub.log('hub', 'warn', `Silero: установка не удалась — ${msg}`)
    }
  }

  async remove(): Promise<void> {
    if (this.status.state === 'installing') throw new Error('Дождитесь конца установки')
    this.stop()
    await rm(this.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
    this.status = { state: 'none', step: '', progress: -1, error: '' }
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc
    const p = spawn(join(this.dir, 'python', 'python.exe'), ['-I', '-W', 'ignore', join(this.resourcesDir, 'tts', 'silero_worker.py')], { windowsHide: true, cwd: this.dir })
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (d: string) => {
      this.buf += d
      let i: number
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        if (!line.startsWith('{')) continue
        let r: Record<string, unknown>
        try { r = JSON.parse(line) } catch { r = { ok: false, error: 'bad reply' } }
        this.waiting.shift()?.(r)
      }
    })
    p.stderr.on('data', () => undefined)
    p.on('exit', () => {
      this.proc = null
      this.buf = ''
      for (const w of this.waiting.splice(0)) w({ ok: false, error: 'Процесс Silero завершился' })
    })
    p.on('error', (e) => this.hub.log('hub', 'error', `Silero не запустился: ${e.message}`))
    this.proc = p
    return p
  }

  private stop(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    this.proc?.kill()
    this.proc = null
  }

  private request(cmd: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const run = (): Promise<Record<string, unknown>> => new Promise((resolve) => {
      const p = this.start()
      const timer = setTimeout(() => {
        const i = this.waiting.indexOf(done)
        if (i >= 0) this.waiting.splice(i, 1)
        p.kill()
        resolve({ ok: false, error: 'Silero не ответил вовремя' })
      }, timeoutMs)
      const done = (r: Record<string, unknown>): void => { clearTimeout(timer); resolve(r) }
      this.waiting.push(done)
      p.stdin.write(JSON.stringify(cmd) + '\n')
    })
    const next = this.chain.then(run, run)
    this.chain = next
    void next.finally(() => {
      if (this.idle) clearTimeout(this.idle)
      this.idle = setTimeout(() => this.stop(), IDLE_MS)
    })
    return next
  }

  /** Загрузить модель заранее, чтобы первая озвучка на стриме не ждала (около 10 секунд). */
  warm(): void {
    if (this.ready() && !this.proc) void this.request({ cmd: 'load', model: join(this.dir, MODEL.file) }, 120_000)
  }

  /** rate5: 0 — очень медленно … 2 — обычно … 4 — очень быстро. */
  async speak(text: string, speaker: string, rate5: number, path: string): Promise<void> {
    if (!this.ready()) throw new Error('Silero не установлен (Настройки → Озвучка)')
    if (!SILERO_SPEAKERS.some((s) => s.id === speaker)) throw new Error('Неизвестный голос Silero')
    const r = await this.request({ cmd: 'speak', model: join(this.dir, MODEL.file), text, speaker, rate: rate5, path }, 120_000)
    if (!r.ok) throw new Error(String(r.error ?? 'Ошибка озвучки Silero'))
  }

  dispose(): void { this.stop() }
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

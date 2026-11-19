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
// Дополнительные голоса (Роман, Оксана, Дмитрий): модель v5_cis_base (MIT) ударения не ставит сама — их расставляет silero-stress (MIT).
const EXTRA_MODEL = { url: 'https://models.silero.ai/models/tts/ru/v5_cis_base.pt', sha: 'ba41b18f6a707ad93605a162998865e7c087153d2e010a26dd02229dab0e672a', file: 'v5_cis_base.pt' }
const STRESS = { url: 'https://files.pythonhosted.org/packages/d4/ca/e5af7cf4f85a1422824463ab885880f00ab39e0fe9589342eadfc98862de/silero_stress-1.5-py3-none-any.whl', sha: '408e333e67ebb407be656f32e8d5c46ad811c2598ebdbaed0e627ee980579e4a' }
const EXTRA_VERSION = 'v5_cis_base-silero_stress1.5'
const TORCH = 'torch==2.14.1+cpu'
const TORCH_INDEX = 'https://download.pytorch.org/whl/cpu'
const VERSION = 'py3.13.17-torch2.14.1-v5_6_ru'
/** После стольких минут без озвучки процесс выгружается (модель занимает около 0,5 ГБ памяти). */
const IDLE_MS = 15 * 60 * 1000

/** extra — голос из дополнительной модели (ставится отдельной кнопкой). */
export const SILERO_SPEAKERS: { id: string; label: string; gender: string; extra?: boolean }[] = [
  { id: 'aidar', label: 'Айдар', gender: 'Male' },
  { id: 'eugene', label: 'Евгений', gender: 'Male' },
  { id: 'baya', label: 'Бая', gender: 'Female' },
  { id: 'kseniya', label: 'Ксения', gender: 'Female' },
  { id: 'xenia', label: 'Ксения 2', gender: 'Female' },
  { id: 'ru_roman', label: 'Роман', gender: 'Male', extra: true },
  { id: 'ru_oksana', label: 'Оксана', gender: 'Female', extra: true },
  { id: 'ru_dmitriy', label: 'Дмитрий', gender: 'Male', extra: true }
]

export interface SileroStatus {
  state: 'none' | 'installing' | 'ready' | 'error'
  /** Что сейчас делается (по-русски). */
  step: string
  /** 0…1 для текущего шага, -1 — неизвестно. */
  progress: number
  error: string
  /** Дополнительные голоса установлены. */
  extra: boolean
  /** Ошибка установки дополнительных голосов (основные при этом работают). */
  extraError: string
}

export class Silero {
  private dir: string
  private status: SileroStatus = { state: 'none', step: '', progress: -1, error: '', extra: false, extraError: '' }
  private proc: ChildProcessWithoutNullStreams | null = null
  private waiting: ((r: Record<string, unknown>) => void)[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private idle: NodeJS.Timeout | null = null
  /** Растёт при cancel(): задания из очереди, поставленные раньше, не запускаются. */
  private gen = 0
  private closed = false

  constructor(root: string, private resourcesDir: string, private hub: Hub) {
    this.dir = join(root, 'silero')
    void readFile(join(this.dir, 'ready.json'), 'utf8')
      // Чтение может закончиться уже после нажатия «Установить» — тогда не перетирать статус установки.
      .then((t) => { if (this.status.state === 'none' && (JSON.parse(t) as { version?: string }).version === VERSION) this.set({ state: 'ready', step: '', progress: -1, error: '' }) })
      .catch(() => undefined)
    void readFile(join(this.dir, 'extra-ready.json'), 'utf8')
      .then((t) => { if ((JSON.parse(t) as { version?: string }).version === EXTRA_VERSION) this.set({ extra: true }) })
      .catch(() => undefined)
  }

  get(): SileroStatus { return { ...this.status } }
  ready(): boolean { return this.status.state === 'ready' }
  extraReady(): boolean { return this.ready() && this.status.extra }

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
      // Прежний процесс держит файлы Python, а старая метка готовности пережила бы прерванную переустановку.
      this.cancel()
      await unlink(join(this.dir, 'ready.json')).catch(() => undefined)
      const dl = join(this.dir, 'download')
      await mkdir(dl, { recursive: true })
      await this.download(PY, join(dl, 'python.zip'), 'Скачиваю Python (11 МБ)')
      const py = join(this.dir, 'python')
      await rm(py, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
      await mkdir(py, { recursive: true })
      await this.run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', join(dl, 'python.zip'), '-C', py], 'Распаковываю Python')
      // Embeddable Python видит только свои файлы и папку site рядом.
      await writeFile(join(py, 'python313._pth'), 'python313.zip\r\n.\r\n..\\site\r\n')
      await this.download(PIP, join(dl, 'pip.pyz'), 'Скачиваю установщик пакетов')
      const site = join(this.dir, 'site')
      // Метка пишется только после успешного pip: после прерванной установки папка torch может быть неполной.
      const torchOk = join(site, '.crossember-ok')
      if (!existsSync(torchOk) || (await readFile(torchOk, 'utf8')) !== TORCH) {
        await rm(site, { recursive: true, force: true })
        // silero-stress лежал в этой же папке — дополнительные голоса придётся добавить заново.
        await unlink(join(this.dir, 'extra-ready.json')).catch(() => undefined)
        this.set({ extra: false })
        let n = 0
        await this.run(join(py, 'python.exe'), ['-I', join(dl, 'pip.pyz'), 'install', '--disable-pip-version-check', '--no-cache-dir', '--progress-bar', 'off',
          '--only-binary=:all:', '--target', site, '--index-url', TORCH_INDEX, TORCH], 'Скачиваю и ставлю PyTorch (около 250 МБ, несколько минут)',
        (l) => { if (/^(Downloading|Collecting)/.test(l)) this.set({ progress: Math.min(0.95, ++n / 22) }) })
        await writeFile(torchOk, TORCH)
      }
      await this.download(MODEL, join(this.dir, MODEL.file), 'Скачиваю модель Silero (148 МБ)')
      this.set({ step: 'Проверяю озвучку', progress: -1 })
      await rm(dl, { recursive: true, force: true })
      const test = join(this.dir, 'test.wav')
      await this.synth('Проверка.', 'xenia', 2, test)
      await unlink(test).catch(() => undefined)
      await writeFile(join(this.dir, 'ready.json'), JSON.stringify({ version: VERSION, at: new Date().toISOString() }))
      this.set({ state: 'ready', step: '', progress: -1 })
      this.hub.log('hub', 'info', 'Silero: установлен')
    } catch (e) {
      const msg = (e as Error).message
      this.set({ state: 'error', error: msg, step: '', progress: -1 })
      this.hub.log('hub', 'warn', `Silero: установка не удалась — ${msg}`)
    }
  }

  /** Дополнительные голоса: модель v5_cis_base и silero-stress в ту же папку site, что и PyTorch. */
  async installExtra(): Promise<void> {
    if (this.status.state !== 'ready') return
    this.set({ state: 'installing', extraError: '', step: 'Подготовка', progress: -1 })
    this.hub.log('hub', 'info', 'Silero: установка дополнительных голосов')
    try {
      // Работающий процесс мог уже загрузить модуль ударений из старой папки.
      this.cancel()
      await unlink(join(this.dir, 'extra-ready.json')).catch(() => undefined)
      this.set({ extra: false })
      const dl = join(this.dir, 'download')
      await mkdir(dl, { recursive: true })
      await this.download(STRESS, join(dl, 'stress.whl'), 'Скачиваю расстановку ударений (39 МБ)')
      // Пакет .whl — это zip; tar.exe из Windows умеет его распаковать.
      await this.run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', join(dl, 'stress.whl'), '-C', join(this.dir, 'site')], 'Распаковываю')
      await this.download(EXTRA_MODEL, join(this.dir, EXTRA_MODEL.file), 'Скачиваю модель голосов (88 МБ)')
      await rm(dl, { recursive: true, force: true })
      this.set({ step: 'Проверяю озвучку', progress: -1 })
      const test = join(this.dir, 'test.wav')
      await this.synth('Проверка.', 'ru_roman', 2, test, true)
      await unlink(test).catch(() => undefined)
      await writeFile(join(this.dir, 'extra-ready.json'), JSON.stringify({ version: EXTRA_VERSION, at: new Date().toISOString() }))
      this.set({ state: 'ready', extra: true, step: '', progress: -1 })
      this.hub.log('hub', 'info', 'Silero: дополнительные голоса установлены')
    } catch (e) {
      const msg = (e as Error).message
      this.set({ state: 'ready', extraError: msg, step: '', progress: -1 })
      this.hub.log('hub', 'warn', `Silero: дополнительные голоса не установились — ${msg}`)
    }
  }

  async remove(): Promise<void> {
    if (this.status.state === 'installing') throw new Error('Дождитесь конца установки')
    this.cancel()
    await rm(this.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
    this.status = { state: 'none', step: '', progress: -1, error: '', extra: false, extraError: '' }
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc
    const p = spawn(join(this.dir, 'python', 'python.exe'), ['-I', '-W', 'ignore', join(this.resourcesDir, 'tts', 'silero_worker.py')], { windowsHide: true, cwd: this.dir })
    // Ответы и завершение старого процесса (после stop() или тайм-аута) не должны трогать очередь нового.
    let buf = ''
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (d: string) => {
      if (this.proc !== p) return
      buf += d
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line.startsWith('{')) continue
        let r: Record<string, unknown>
        try { r = JSON.parse(line) } catch { r = { ok: false, error: 'bad reply' } }
        this.waiting.shift()?.(r)
      }
    })
    p.stderr.on('data', () => undefined)
    // Запись в уже завершившийся процесс даёт ошибку потока; ответ ожидающим придёт из gone().
    p.stdin.on('error', () => undefined)
    const gone = (error: string): void => {
      if (this.proc !== p) return
      this.proc = null
      for (const w of this.waiting.splice(0)) w({ ok: false, error })
    }
    p.on('exit', () => gone('Процесс Silero завершился'))
    // При неудачном запуске exit может не прийти, и запросы висели бы до тайм-аута.
    p.on('error', (e) => { this.hub.log('hub', 'error', `Silero не запустился: ${e.message}`); gone(`Silero не запустился: ${e.message}`) })
    this.proc = p
    return p
  }

  private stop(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    const p = this.proc
    this.proc = null
    for (const w of this.waiting.splice(0)) w({ ok: false, error: 'Процесс Silero остановлен' })
    p?.kill()
  }

  /** Остановить процесс и отменить всю очередь (удаление, переустановка, выход). После тайм-аута — только stop(). */
  private cancel(): void {
    this.gen++
    this.stop()
  }

  private request(cmd: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const g = this.gen
    const run = (): Promise<Record<string, unknown>> => new Promise((resolve) => {
      if (g !== this.gen || this.closed) { resolve({ ok: false, error: 'Silero остановлен' }); return }
      // Старый таймер простоя не должен выгрузить модель посреди этой озвучки.
      if (this.idle) clearTimeout(this.idle)
      this.idle = null
      const p = this.start()
      const timer = setTimeout(() => {
        const i = this.waiting.indexOf(done)
        if (i >= 0) this.waiting.splice(i, 1)
        // stop(), а не просто kill: следующий запрос должен запустить новый процесс, а не писать в умирающий.
        if (this.proc === p) this.stop()
        else p.kill()
        resolve({ ok: false, error: 'Silero не ответил вовремя' })
      }, timeoutMs)
      const done = (r: Record<string, unknown>): void => { clearTimeout(timer); resolve(r) }
      this.waiting.push(done)
      p.stdin.write(JSON.stringify(cmd) + '\n')
    })
    const next = this.chain.then(run, run)
    this.chain = next
    void next.finally(() => {
      if (this.chain !== next || this.closed) return // в очереди есть ещё задания — таймер поставит последнее
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
    await this.synth(text, speaker, rate5, path)
  }

  /** Без проверки готовности: install() вызывает её до того, как установка признана готовой. */
  private async synth(text: string, speaker: string, rate5: number, path: string, installingExtra = false): Promise<void> {
    const sp = SILERO_SPEAKERS.find((s) => s.id === speaker)
    if (!sp) throw new Error('Неизвестный голос Silero')
    if (sp.extra && !installingExtra && !this.status.extra) throw new Error('Голос не добавлен (Настройки → Озвучка → Silero → «Добавить голоса»)')
    const r = await this.request({ cmd: 'speak', model: join(this.dir, MODEL.file), extra: join(this.dir, EXTRA_MODEL.file), text, speaker, rate: rate5, path }, 120_000)
    if (!r.ok) throw new Error(String(r.error ?? 'Ошибка озвучки Silero'))
  }

  dispose(): void {
    this.closed = true
    this.cancel()
  }
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

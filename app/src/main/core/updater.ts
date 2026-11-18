import { app, net } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateDownloadedEvent, type UpdateInfo } from 'electron-updater'
import type { Hub } from './hub'
import { checkSignature, sha512File, sha512FileSync } from './updatekey'

/** Откуда брать подпись: тот же репозиторий, что в electron-builder.yml (publish). */
const RELEASES = 'https://github.com/erronsivors/Crossember/releases/download'

/**
 * Обновления из GitHub Releases публичного репозитория (настройки — publish в electron-builder.yml).
 * Ничего не скачивается и не ставится без кнопки: «Скачать» → процент → «Что нового» → «Установить и перезапустить».
 * Подлинность: electron-updater сверяет SHA-512 из latest.yml, а мы — подпись своим ключом (updatekey.ts):
 * пока подпись не проверена, установка невозможна ни по кнопке, ни при выходе из программы.
 * В GitHub уходит только запрос «какая последняя версия» (и сам файл, если пользователь нажал «Скачать»).
 */

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  /** Текущая версия программы. */
  current: string
  /** Новая версия (если есть). */
  version: string
  /** Что изменилось — пункты из описания релиза. */
  notes: string[]
  /** 0…100 во время скачивания. */
  percent: number
  error: string
  /** Пользователь нажал «Позже» в окне — окно больше не показывать, только строку в меню. */
  later: boolean
  /** Проверка прошла, новее нет. */
  latest: boolean
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/**
 * Пункты из описания релиза: строки «- …», «* …», «1. …» или <li>…</li>; HTML-теги убираются.
 * Заголовки разделов («Исправления:», «Нововведения:») возвращаются как «# Исправления».
 */
export function releaseNotes(raw: UpdateInfo['releaseNotes']): string[] {
  const text = Array.isArray(raw) ? raw.map((n) => n.note ?? '').join('\n') : (raw ?? '')
  const lines = text
    .replace(/<\/(li|p|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const isItem = (l: string): boolean => /^([-*•]|\d+[.)])\s+/.test(l)
  const isHead = (l: string): boolean => !isItem(l) && /^[\p{L} ]{3,40}:$/u.test(l)
  const items = lines.filter((l) => isItem(l) || isHead(l)).map((l) => (isHead(l) ? `# ${l.slice(0, -1)}` : l.replace(/^([-*•]|\d+[.)])\s+/, '')))
  return (items.some((l) => !l.startsWith('# ')) ? items : lines).slice(0, 24).map((l) => l.slice(0, 300))
}

export class Updater {
  private s: UpdateState = { status: 'idle', current: app.getVersion(), version: '', notes: [], percent: 0, error: '', later: false, latest: false }
  private timer: NodeJS.Timeout | null = null
  /** Последняя успешная проверка нашла новую версию. */
  private offered = false
  /** Скачанный установщик подписан нашим ключом: путь и SHA-512 на момент проверки. */
  private verified: { file: string; sha512: string } | null = null
  private installing = false
  onChange: () => void = () => undefined

  constructor(private hub: Hub, private enabled: () => boolean) {
    autoUpdater.autoDownload = false
    // Встроенную установку при выходе не используем: она регистрируется до нашей проверки подписи.
    // Своя — в onQuit(): только проверенный файл и только если он не изменился с момента проверки.
    autoUpdater.autoInstallOnAppQuit = false
    app.once('quit', (_e, code) => this.onQuit(code))
    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-not-available', () => {
      this.offered = false
      this.set({ status: 'idle', error: '', latest: true, version: '', notes: [], percent: 0 })
    })
    autoUpdater.on('update-available', (i: UpdateInfo) => {
      const fresh = i.version !== this.s.version
      this.offered = true
      this.set({ status: 'available', version: i.version, notes: releaseNotes(i.releaseNotes), percent: 0, error: '', later: fresh ? false : this.s.later })
      if (fresh) this.hub.log('hub', 'info', `Обновление: доступна версия ${i.version}`)
    })
    autoUpdater.on('download-progress', (p: ProgressInfo) => this.set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.floor(p.percent))) }))
    autoUpdater.on('update-downloaded', (i: UpdateDownloadedEvent) => void this.verify(i))
    autoUpdater.on('error', (e: Error) => {
      const msg = e.message.slice(0, 200)
      this.hub.log('hub', 'warn', `Обновление: ${e.message.slice(0, 300)}`)
      // Скачанное не теряем: ошибка запуска установки — показать и дать повторить установку.
      if (this.s.status === 'ready') { this.installing = false; return this.set({ error: `Не удалось запустить установку: ${msg}`, later: false }) }
      if (this.s.status === 'downloading') return this.set({ status: 'error', error: `Не удалось скачать: ${msg}` })
      // Ошибка проверки (нет сети, нет релизов): предложение остаётся, только если оно было действительным до проверки.
      this.set({ status: this.offered ? 'available' : 'idle', error: '' })
    })
  }

  get(): UpdateState { return { ...this.s, notes: [...this.s.notes] } }

  private set(p: Partial<UpdateState>): void {
    this.s = { ...this.s, ...p }
    this.onChange()
  }

  /** Проверять при запуске и раз в 6 часов. В режиме разработки (не установленная программа) — никогда. */
  start(): void {
    if (!app.isPackaged) return
    setTimeout(() => void this.check(), 8000)
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  async check(): Promise<void> {
    if (!app.isPackaged || !this.enabled()) return
    if (this.s.status === 'downloading' || this.s.status === 'ready' || this.s.status === 'checking') return
    try { await autoUpdater.checkForUpdates() } catch { /* обработано в on('error') */ }
  }

  async download(): Promise<void> {
    if (this.s.status !== 'available' && this.s.status !== 'error') return
    this.set({ status: 'downloading', percent: 0, error: '', later: false })
    try { await autoUpdater.downloadUpdate() } catch { /* обработано в on('error') */ }
  }

  later(): void { this.set({ later: true }) }

  /** Скачано — проверить подпись своим ключом; только после этого «Установить» и установка при выходе. */
  private async verify(i: UpdateDownloadedEvent): Promise<void> {
    this.verified = null
    const fail = (why: string): void => {
      this.hub.log('hub', 'error', `Обновление ${i.version} не установлено: ${why}`)
      this.set({ status: 'error', percent: 0, error: `Обновление не прошло проверку подлинности и не будет установлено (${why}). Напишите автору Crossember.` })
    }
    if (!/^\d+\.\d+\.\d+$/.test(i.version) || !i.downloadedFile) return fail('нет данных о файле')
    try {
      // Имя подписи — по нашему правилу имени установщика, а не по имени файла в кэше electron-updater.
      const file = `Crossember-Setup-${i.version}.exe`
      const sig = await fetchSmall(`${RELEASES}/v${i.version}/${file}.sig`)
      const sha512 = await sha512File(i.downloadedFile)
      if (!checkSignature(i.version, sha512, sig)) return fail('подпись не совпала')
      this.verified = { file: i.downloadedFile, sha512 }
    } catch (e) {
      return fail((e as Error).message.slice(0, 120))
    }
    this.set({ status: 'ready', percent: 100, version: i.version, notes: releaseNotes(i.releaseNotes).length ? releaseNotes(i.releaseNotes) : this.s.notes, later: false })
    this.hub.log('hub', 'info', `Обновление ${i.version} скачано, подпись верна`)
  }

  /** Файл тот же, что проверяли (не подменён, пока ждал «Позже»). */
  private async intact(): Promise<boolean> {
    const v = this.verified
    if (!v) return false
    try { return (await sha512File(v.file)) === v.sha512 } catch { return false }
  }

  /** «Позже» после скачивания: поставить при обычном выходе из программы. */
  private onQuit(code: number): void {
    if (code !== 0 || this.installing || this.s.status !== 'ready' || !this.verified) return
    try {
      if (sha512FileSync(this.verified.file) !== this.verified.sha512) return
    } catch {
      return
    }
    this.installing = true
    // install() есть у NsisUpdater (BaseUpdater), в типе AppUpdater его не видно.
    ;(autoUpdater as unknown as { install(silent: boolean, runAfter: boolean): boolean }).install(true, false)
  }

  async install(): Promise<void> {
    if (this.s.status !== 'ready' || !this.verified || this.installing) return
    if (!(await this.intact())) {
      this.verified = null
      this.set({ status: 'error', error: 'Скачанный файл изменился после проверки — скачайте обновление заново.' })
      return
    }
    this.installing = true
    this.set({ error: '' })
    // Тихо, без мастера: установщик берёт прежнюю папку из реестра, после установки программа откроется сама.
    autoUpdater.quitAndInstall(true, true)
  }

  dispose(): void { if (this.timer) clearInterval(this.timer) }
}

/** Скачать маленький текстовый файл (подпись): не дольше 20 с и не больше 1 КБ. */
async function fetchSmall(url: string): Promise<string> {
  const res = await net.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) }).catch((e: Error) => {
    throw new Error(e.name === 'TimeoutError' ? 'подпись не скачалась за 20 с' : 'подпись не скачалась (нет сети?)')
  })
  if (!res.ok) throw new Error(res.status === 404 ? 'нет подписи в релизе' : `подпись не скачалась (${res.status})`)
  const reader = res.body?.getReader()
  if (!reader) throw new Error('пустая подпись')
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 1024) { void reader.cancel(); throw new Error('подпись слишком большая') }
    parts.push(value)
  }
  return Buffer.concat(parts).toString('utf8')
}

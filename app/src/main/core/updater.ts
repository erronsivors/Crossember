import { app } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { Hub } from './hub'

/**
 * Обновления из GitHub Releases публичного репозитория (настройки — publish в electron-builder.yml).
 * Ничего не скачивается и не ставится без кнопки: «Скачать» → процент → «Что нового» → «Установить и перезапустить».
 * Подлинность файла проверяет electron-updater по SHA-512 из latest.yml релиза.
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

/** Пункты из описания релиза: строки «- …», «* …», «1. …» или <li>…</li>; HTML-теги убираются. */
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
  const items = lines.filter((l) => /^([-*•]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, ''))
  return (items.length ? items : lines).slice(0, 20).map((l) => l.slice(0, 300))
}

export class Updater {
  private s: UpdateState = { status: 'idle', current: app.getVersion(), version: '', notes: [], percent: 0, error: '', later: false, latest: false }
  private timer: NodeJS.Timeout | null = null
  /** Последняя успешная проверка нашла новую версию. */
  private offered = false
  onChange: () => void = () => undefined

  constructor(private hub: Hub, private enabled: () => boolean) {
    autoUpdater.autoDownload = false
    // «Позже» после скачивания: поставится при выходе из программы.
    autoUpdater.autoInstallOnAppQuit = true
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
    autoUpdater.on('update-downloaded', (i: UpdateInfo) => {
      this.set({ status: 'ready', percent: 100, version: i.version, notes: releaseNotes(i.releaseNotes).length ? releaseNotes(i.releaseNotes) : this.s.notes, later: false })
      this.hub.log('hub', 'info', `Обновление ${i.version} скачано`)
    })
    autoUpdater.on('error', (e: Error) => {
      const msg = e.message.slice(0, 200)
      this.hub.log('hub', 'warn', `Обновление: ${e.message.slice(0, 300)}`)
      // Скачанное не теряем: ошибка запуска установки — показать и дать повторить установку.
      if (this.s.status === 'ready') return this.set({ error: `Не удалось запустить установку: ${msg}`, later: false })
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

  install(): void {
    if (this.s.status !== 'ready') return
    this.set({ error: '' })
    // isSilent = false: окно установщика видно; isForceRunAfter = true: программа откроется после установки.
    autoUpdater.quitAndInstall(false, true)
  }

  dispose(): void { if (this.timer) clearInterval(this.timer) }
}

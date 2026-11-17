import { EventEmitter } from 'node:events'
import type { Hub } from './hub'
import { KEY_DEFS } from './keyslayout'

/**
 * Нажатия клавиш и кнопок мыши для оверлея «Клавиатура» (uiohook-napi, системный перехват Windows).
 * Перехват работает, только пока он разрешён в настройках и оверлей открыт (в OBS или браузере).
 * Наружу уходят только клавиши из разрешённого списка — те, что нарисованы на оверлее; остальное
 * отбрасывается сразу, нигде не копится и не пишется в журнал. Движение мыши не передаётся.
 */

type Hook = {
  on(ev: string, fn: (e: { keycode?: number; button?: unknown; rotation?: number; direction?: number }) => void): unknown
  removeAllListeners(): unknown
  start(): void
  stop(): void
}

const CODE_TO_ID = new Map<number, string>(Object.entries(KEY_DEFS).map(([id, d]) => [d.code, id]))
// Правые Shift/Ctrl/Alt считаем теми же клавишами, что и левые.
CODE_TO_ID.set(54, 'Shift').set(3613, 'Ctrl').set(3640, 'Alt')
// Стрелки с цифрового блока (NumLock выключен) — те же стрелки.
CODE_TO_ID.set(0xee00 | 72, 'Up').set(0xee00 | 80, 'Down').set(0xee00 | 75, 'Left').set(0xee00 | 77, 'Right')

export class KeyCapture extends EventEmitter {
  private hook: Hook | null = null
  private running = false
  private allowed = new Set<string>()
  private down = new Set<string>()
  /** Какие физические клавиши держат id зажатым (левый и правый Shift — один id). */
  private held = new Map<string, Set<number>>()
  private wheelTimers = new Map<string, NodeJS.Timeout>()
  private failed = false

  constructor(private hub: Hub) {
    super()
  }

  /** Включить/выключить перехват и обновить список разрешённых клавиш. */
  apply(on: boolean, allowed: Set<string>): void {
    this.allowed = allowed
    for (const id of [...this.down]) if (!allowed.has(id)) { this.held.delete(id); this.set(id, false) }
    if (on && allowed.size) this.start()
    else this.stop()
  }

  private load(): Hook | null {
    if (this.hook || this.failed) return this.hook
    try {
      // Загружаем только при первом включении: нет оверлея — нет системного перехвата.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.hook = (require('uiohook-napi') as { uIOhook: Hook }).uIOhook
    } catch (e) {
      this.failed = true
      this.hub.log('hub', 'error', `Оверлей клавиатуры: перехват недоступен (${(e as Error).message})`)
    }
    return this.hook
  }

  private start(): void {
    if (this.running) return
    const h = this.load()
    if (!h) return
    h.on('keydown', (e) => this.key(e.keycode, true))
    h.on('keyup', (e) => this.key(e.keycode, false))
    h.on('mousedown', (e) => this.mouse(e.button, true))
    h.on('mouseup', (e) => this.mouse(e.button, false))
    h.on('wheel', (e) => this.wheel(e))
    try {
      h.start()
      this.running = true
      this.hub.log('hub', 'info', 'Оверлей клавиатуры: показ нажатий включён')
    } catch (e) {
      h.removeAllListeners()
      this.hub.log('hub', 'error', `Оверлей клавиатуры: не удалось включить перехват (${(e as Error).message})`)
    }
  }

  stop(): void {
    for (const t of this.wheelTimers.values()) clearTimeout(t)
    this.wheelTimers.clear()
    this.held.clear()
    for (const id of [...this.down]) this.set(id, false)
    if (!this.running || !this.hook) return
    // Слушатели снимаем в любом случае: даже если системный перехват не остановился, наружу ничего не уйдёт.
    this.hook.removeAllListeners()
    try {
      this.hook.stop()
      this.running = false
      this.hub.log('hub', 'info', 'Оверлей клавиатуры: показ нажатий выключен')
    } catch (e) {
      this.hub.log('hub', 'error', `Оверлей клавиатуры: системный перехват не остановился (${(e as Error).message}), нажатия никуда не передаются`)
    }
  }

  /** Какие разрешённые клавиши сейчас зажаты (для только что открытого оверлея). */
  pressed(): string[] {
    return [...this.down]
  }

  private set(id: string, down: boolean): void {
    if (down === this.down.has(id)) return // автоповтор зажатой клавиши не шлём
    if (down) this.down.add(id)
    else this.down.delete(id)
    this.emit('key', id, down)
  }

  private key(code: number | undefined, down: boolean): void {
    const id = typeof code === 'number' ? CODE_TO_ID.get(code) : undefined
    if (!id || !this.allowed.has(id)) return
    const set = this.held.get(id) ?? new Set<number>()
    if (down) set.add(code!)
    else set.delete(code!)
    if (set.size) this.held.set(id, set)
    else this.held.delete(id)
    this.set(id, set.size > 0)
  }

  private mouse(button: unknown, down: boolean): void {
    const id = typeof button === 'number' && button >= 1 && button <= 5 ? `M${button}` : ''
    if (id && this.allowed.has(id)) this.set(id, down)
  }

  /** Прокрутка — короткая вспышка WU/WD. */
  private wheel(e: { rotation?: number; direction?: number }): void {
    if (e.direction !== undefined && e.direction !== 3) return // только вертикальное колесо
    const id = (e.rotation ?? 0) < 0 ? 'WU' : 'WD'
    if (!this.allowed.has(id)) return
    this.set(id, true)
    clearTimeout(this.wheelTimers.get(id))
    this.wheelTimers.set(id, setTimeout(() => { this.wheelTimers.delete(id); this.set(id, false) }, 160))
  }
}

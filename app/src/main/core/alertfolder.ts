// Алерт в папке: alert.json (шаблон) + свои картинки, видео и звуки, на которые он ссылается.
// Встроенные картинки (b:, p:) не копируются — они есть в каждой копии Crossember.
// Имена файлов берутся только из id слоёв (<md5>.<ext>), путям из alert.json не доверяем.
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sanitizeTemplate, type AlertTemplate } from './templates'

export const ALERT_FILE = 'alert.json'
const FORMAT = 'crossember-alert'
const MEDIA_RE = /^m:([0-9a-f]{32}\.(png|jpg|gif|webp|webm|mp4))$/
const SOUND_RE = /^custom:([0-9a-f]{32}\.(mp3|wav|ogg))$/

export interface FolderLibs {
  mediaFile: (file: string) => string
  soundFile: (file: string) => string
  addMedia: (path: string) => string
  addSound: (path: string) => string
}

const safeName = (s: string): string => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Алерт'

/** Сохранить шаблон в новую папку внутри dir. Возвращает путь к папке. */
export function exportAlert(t: AlertTemplate, dir: string, libs: FolderLibs): string {
  let out = join(dir, safeName(t.name))
  for (let n = 2; existsSync(out); n++) out = join(dir, `${safeName(t.name)} (${n})`)
  mkdirSync(out, { recursive: true })
  const missing: string[] = []
  for (const l of t.layers) {
    const m = MEDIA_RE.exec(l.media)
    if (m) { const src = libs.mediaFile(m[1]); if (existsSync(src)) copyFileSync(src, join(out, m[1])); else missing.push(l.name) }
    const s = SOUND_RE.exec(l.sound)
    if (s) { const src = libs.soundFile(s[1]); if (existsSync(src)) copyFileSync(src, join(out, s[1])); else missing.push(l.name) }
  }
  writeFileSync(join(out, ALERT_FILE), JSON.stringify({ format: FORMAT, version: 1, template: t }, null, 2), 'utf8')
  if (missing.length) throw new Error(`Сохранено, но нет файлов у слоёв: ${missing.join(', ')}`)
  return out
}

/** Папки с alert.json: сама папка или её подпапки (на один уровень). */
export function findAlerts(root: string): string[] {
  if (existsSync(join(root, ALERT_FILE))) return [root]
  return readdirSync(root)
    .map((n) => join(root, n))
    .filter((p) => { try { return statSync(p).isDirectory() && existsSync(join(p, ALERT_FILE)) } catch { return false } })
    .slice(0, 300)
}

/** Прочитать алерт из папки: свои файлы добавляются в библиотеки, шаблон получает новый id. */
export function importAlert(folder: string, libs: FolderLibs): AlertTemplate {
  const raw = readFileSync(join(folder, ALERT_FILE), 'utf8')
  if (raw.length > 2_000_000) throw new Error('alert.json слишком большой')
  const data = JSON.parse(raw) as { format?: unknown; template?: unknown }
  if (data.format !== FORMAT || !data.template) throw new Error('это не алерт Crossember')
  const t = sanitizeTemplate(data.template)
  for (const l of t.layers) {
    const m = MEDIA_RE.exec(l.media)
    if (m) {
      const p = join(folder, m[1])
      l.media = existsSync(p) ? libs.addMedia(p) : ''
    }
    const s = SOUND_RE.exec(l.sound)
    if (s) {
      const p = join(folder, s[1])
      l.sound = existsSync(p) ? libs.addSound(p) : 'none'
    }
  }
  return { ...t, id: randomUUID() }
}

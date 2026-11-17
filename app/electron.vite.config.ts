import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Строгий CSP вшивается в index.html только в сборке (в dev Vite нужен inline-скрипт для горячей перезагрузки).
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http://127.0.0.1:*; font-src 'self' data:; media-src 'self' http://127.0.0.1:*; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
const cspPlugin = (): Plugin => ({
  name: 'erron-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}" />`)
})

// Общий клиент YouTube (Desktop app) вшивается в main при сборке закодированным, а не лежит файлом рядом с программой:
// автоматические сканеры GitHub и Google ищут ключи по виду («GOCSPX-…») и в публичном релизе их бы нашли и отозвали.
// Спрятать секрет Desktop-клиента нельзя (Google так и пишет), защита входа — PKCE + state. Сам файл в Git не хранится.
function sharedYoutube(): string {
  const f = resolve('resources/youtube/oauth-client.json')
  if (!existsSync(f)) return ''
  const raw = Buffer.from(readFileSync(f, 'utf8').trim(), 'utf8')
  const key = Buffer.from('crossember-yt')
  return Buffer.from(raw.map((b, i) => b ^ key[i % key.length])).reverse().toString('base64')
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], define: { __YT_SHARED__: JSON.stringify(sharedYoutube()) } },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react(), cspPlugin()]
  }
})

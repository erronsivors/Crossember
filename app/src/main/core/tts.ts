import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Hub } from './hub'
import { SILERO_SPEAKERS, type Silero } from './silero'

/**
 * Озвучка. Движок задаётся приставкой в имени голоса:
 * - без приставки — голоса Windows SAPI (System.Speech);
 * - onecore:<токен> — голоса Windows OneCore (Windows.Media.SpeechSynthesis), среди них русский мужской Pavel;
 * - cb:ref:<файл> / cb:voice:<файл> — локальный Chatterbox-TTS-Server (клон по образцу / встроенный голос);
 * - silero:<голос> — Silero, ставится по кнопке (см. core/silero.ts).
 * Windows-голоса — один фоновый процесс PowerShell: команды идут построчно в base64 (текст зрителя никогда
 * не попадает в командную строку), ответ — JSON-строкой. Chatterbox — HTTP только на 127.0.0.1.
 * Готовый звук — wav-файл в папке данных, его играет оверлей (поэтому озвучка слышна в OBS).
 */

export type TtsEngine = 'windows' | 'onecore' | 'silero' | 'chatterbox' | 'chatterbox-builtin'

export interface TtsVoice {
  /** Значение для настроек: имя с приставкой движка. */
  name: string
  /** Как показывать в списке. */
  label: string
  engine: TtsEngine
  culture: string
  gender: string
}

export interface TtsConfig {
  chatterboxPort: number
  /** Эмоциональность Chatterbox, 0.25–1.5. */
  chatterboxEmotion: number
}

const CB_FILE_RE = /^[\p{L}\p{N} _.()'-]{1,80}\.(wav|mp3)$/u

const WORKER = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$oc = $null
$asTask = $null
function OneCore {
  if ($script:oc) { return $script:oc }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
  [void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
  $script:oc = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  return $script:oc
}
function Await($op, [Type]$type) {
  $t = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$t.Wait(60000)
  return $t.Result
}
function TokenOf($v) { return ($v.Id -split '\\\\')[-1] }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $out = $null
  try {
    $j = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) | ConvertFrom-Json
    if ($j.cmd -eq 'voices') {
      $v = @($s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { @{ name = $_.VoiceInfo.Name; label = $_.VoiceInfo.Name; engine = 'windows'; culture = $_.VoiceInfo.Culture.Name; gender = [string]$_.VoiceInfo.Gender } })
      try {
        $o = OneCore
        $v += @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object { @{ name = 'onecore:' + (TokenOf $_); label = $_.DisplayName; engine = 'onecore'; culture = $_.Language; gender = [string]$_.Gender } })
      } catch { }
      $out = @{ ok = $true; voices = $v }
    } elseif ($j.cmd -eq 'onecore') {
      $o = OneCore
      $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { (TokenOf $_) -eq [string]$j.voice } | Select-Object -First 1
      if (-not $voice) { throw 'Голос OneCore не найден' }
      $o.Voice = $voice
      $o.Options.SpeakingRate = [double]$j.rate
      $st = Await ($o.SynthesizeTextToStreamAsync([string]$j.text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
      try {
        $r = New-Object Windows.Storage.Streams.DataReader ($st.GetInputStreamAt(0))
        [void](Await ($r.LoadAsync([uint32]$st.Size)) ([uint32]))
        $bytes = New-Object byte[] ([int]$st.Size)
        $r.ReadBytes($bytes)
        [IO.File]::WriteAllBytes([string]$j.path, $bytes)
      } finally { $st.Dispose() }
      $out = @{ ok = $true }
    } else {
      if ($j.voice) { $s.SelectVoice([string]$j.voice) }
      $s.Rate = [int]$j.rate
      $s.Volume = 100
      $s.SetOutputToWaveFile([string]$j.path)
      try { $s.Speak([string]$j.text) } finally { $s.SetOutputToNull() }
      $out = @{ ok = $true }
    }
  } catch {
    $out = @{ ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 4))
}
`

/** Длительность wav-файла, мс (по заголовку). */
export function wavDurationMs(buf: Buffer): number {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return 0
  let byteRate = 0
  let pos = 12
  while (pos + 8 <= buf.length) {
    const tag = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (tag === 'fmt ') byteRate = buf.readUInt32LE(pos + 16)
    if (tag === 'data') return byteRate ? Math.round((Math.min(size, buf.length - pos - 8) / byteRate) * 1000) : 0
    pos += 8 + size + (size % 2)
  }
  return 0
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:ru|com|net|org|gg|tv|io|me|рф|su|xyz|info|link|ly)(?:\/\S*)?/gi

/** Подготовить текст к озвучке: без ссылок, мата из списка, повторов и мусора; не длиннее maxChars. */
export function cleanForSpeech(text: string, opts: { stripLinks: boolean; badWords: string; maxChars: number }): string {
  let t = text
  if (opts.stripLinks) t = t.replace(URL_RE, ' ')
  for (const w of opts.badWords.split(',').map((x) => x.trim()).filter(Boolean)) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    t = t.replace(new RegExp(`[\\p{L}\\d]*${esc}[\\p{L}\\d]*`, 'giu'), ' ')
  }
  t = t
    .replace(/[^\p{L}\p{N}\s.,!?:;()'"«»—–-]/gu, ' ') // смайлы и символы
    .replace(/(\p{L})\1{3,}/gu, '$1$1$1') // «ааааааа» → «ааа»
    .replace(/([!?.,])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length > opts.maxChars) t = `${t.slice(0, opts.maxChars).replace(/\s+\S*$/, '')}…`
  return t
}

export class WindowsTts {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private waiting: ((r: Record<string, unknown>) => void)[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private voicesCache: TtsVoice[] | null = null
  /** Модель Chatterbox грузится на первой фразе (до полутора минут) — прогреваем, как только увидели сервер. */
  private cbWarm = false
  private dir: string
  private cleanTimer: NodeJS.Timeout

  constructor(root: string, private hub: Hub, private cfg: () => TtsConfig, private silero: Silero) {
    this.dir = join(root, 'tts')
    mkdirSync(this.dir, { recursive: true })
    this.cleanup()
    this.cleanTimer = setInterval(() => this.cleanup(), 30 * 60 * 1000)
  }

  /** Удалить озвучки старше 2 часов. */
  private cleanup(): void {
    const old = Date.now() - 2 * 3600 * 1000
    try {
      for (const f of readdirSync(this.dir)) {
        const p = join(this.dir, f)
        if (statSync(p).mtimeMs < old) unlinkSync(p)
      }
    } catch {
      /* не страшно */
    }
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc
    const encoded = Buffer.from(WORKER, 'utf16le').toString('base64')
    const p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true })
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
      for (const w of this.waiting.splice(0)) w({ ok: false, error: 'Процесс озвучки завершился' })
    })
    p.on('error', (e) => this.hub.log('hub', 'error', `Озвучка Windows не запустилась: ${e.message}`))
    this.proc = p
    return p
  }

  /** Отправить команду фоновому процессу (по одной за раз), ждать ответ не дольше timeoutMs. */
  private request(cmd: Record<string, unknown>, timeoutMs = 30_000): Promise<Record<string, unknown>> {
    const run = (): Promise<Record<string, unknown>> => new Promise((resolve) => {
      const p = this.start()
      const timer = setTimeout(() => {
        const i = this.waiting.indexOf(done)
        if (i >= 0) this.waiting.splice(i, 1)
        p.kill()
        resolve({ ok: false, error: 'Озвучка не ответила вовремя' })
      }, timeoutMs)
      const done = (r: Record<string, unknown>): void => { clearTimeout(timer); resolve(r) }
      this.waiting.push(done)
      p.stdin.write(Buffer.from(JSON.stringify(cmd), 'utf8').toString('base64') + '\n')
    })
    const next = this.chain.then(run, run)
    this.chain = next
    return next
  }

  /** Голоса Windows (SAPI и OneCore) — список не меняется, пока программа запущена. */
  private async windowsVoices(): Promise<TtsVoice[]> {
    if (this.voicesCache) return this.voicesCache
    const r = await this.request({ cmd: 'voices' }, 20_000)
    if (!r.ok) throw new Error(String(r.error ?? 'Не удалось получить список голосов'))
    const list = (Array.isArray(r.voices) ? r.voices : [r.voices]).filter(Boolean) as TtsVoice[]
    this.voicesCache = list.map((v) => ({
      name: String(v.name), label: String(v.label || v.name), engine: v.engine === 'onecore' ? 'onecore' : 'windows',
      culture: String(v.culture), gender: String(v.gender)
    }))
    return this.voicesCache
  }

  private cbUrl(path: string): string {
    const port = Math.max(1024, Math.min(65535, Math.round(this.cfg().chatterboxPort || 8004)))
    return `http://127.0.0.1:${port}${path}`
  }

  /** Голоса Chatterbox, если сервер запущен; иначе пустой список. Спрашиваем каждый раз — образцы могут добавиться. */
  private async chatterboxVoices(): Promise<TtsVoice[]> {
    const get = async (path: string): Promise<unknown> => {
      const r = await fetch(this.cbUrl(path), { signal: AbortSignal.timeout(2500) })
      if (!r.ok) throw new Error(String(r.status))
      return r.json()
    }
    try {
      const [refs, builtin] = await Promise.all([get('/get_reference_files'), get('/get_predefined_voices').catch(() => [])])
      const out: TtsVoice[] = []
      for (const f of Array.isArray(refs) ? refs : []) {
        if (typeof f === 'string' && CB_FILE_RE.test(f)) out.push({ name: `cb:ref:${f}`, label: f.replace(/\.(wav|mp3)$/i, ''), engine: 'chatterbox', culture: 'ru-RU', gender: '' })
      }
      for (const v of Array.isArray(builtin) ? builtin : []) {
        const f = (v as { filename?: unknown })?.filename
        const n = (v as { display_name?: unknown })?.display_name
        if (typeof f === 'string' && CB_FILE_RE.test(f)) out.push({ name: `cb:voice:${f}`, label: typeof n === 'string' ? n.slice(0, 60) : f, engine: 'chatterbox-builtin', culture: '', gender: '' })
      }
      if (out.length && !this.cbWarm) {
        this.cbWarm = true
        const v = out[0].name
        void this.synth('Проверка связи.', v, 0, 180_000).catch(() => { this.cbWarm = false })
      }
      return out
    } catch {
      this.cbWarm = false
      return []
    }
  }

  async voices(): Promise<TtsVoice[]> {
    const [win, cb] = await Promise.all([this.windowsVoices(), this.chatterboxVoices()])
    const sil: TtsVoice[] = this.silero.ready() ? SILERO_SPEAKERS.map((s) => ({ name: `silero:${s.id}`, label: s.label, engine: 'silero', culture: 'ru-RU', gender: s.gender })) : []
    return [...win, ...sil, ...cb]
  }

  /** Голос по умолчанию: заданный, иначе первый русский SAPI, иначе любой русский. Chatterbox не проверяем заранее. */
  private async pickVoice(want: string): Promise<string> {
    if (want.startsWith('cb:') || want.startsWith('silero:')) return want
    const list = await this.windowsVoices().catch(() => [] as TtsVoice[])
    if (want && list.some((v) => v.name === want)) return want
    const ru = (v: TtsVoice): boolean => v.culture.toLowerCase().startsWith('ru')
    return (list.find((v) => v.engine === 'windows' && ru(v)) ?? list.find(ru) ?? list[0])?.name ?? ''
  }

  private async chatterbox(voice: string, text: string, rate: number, path: string, timeoutMs: number): Promise<void> {
    const m = /^cb:(ref|voice):(.+)$/.exec(voice)
    if (!m || !CB_FILE_RE.test(m[2])) throw new Error('Неверный голос Chatterbox')
    const emotion = Math.max(0.25, Math.min(1.5, this.cfg().chatterboxEmotion || 0.5))
    const body = {
      text, language: 'ru', output_format: 'wav', split_text: true, chunk_size: 240, seed: 0,
      exaggeration: emotion, speed_factor: Math.round((1 + rate * 0.04) * 100) / 100,
      ...(m[1] === 'ref' ? { voice_mode: 'clone', reference_audio_filename: m[2] } : { voice_mode: 'predefined', predefined_voice_id: m[2] })
    }
    let r: Response
    try {
      r = await fetch(this.cbUrl('/tts'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    } catch (e) {
      throw new Error((e as Error).name === 'TimeoutError' ? `Chatterbox не успел озвучить за ${Math.round(timeoutMs / 1000)} с` : 'Chatterbox не запущен (сервер на этом ПК не отвечает)')
    }
    if (!r.ok) throw new Error(`Chatterbox ответил ошибкой ${r.status}`)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Chatterbox вернул не wav')
    await writeFile(path, buf)
  }

  /** Озвучить текст в wav. Возвращает имя файла (для /t/<файл>) и длительность. */
  /** timeoutMs — сколько ждать Chatterbox (алерты ждут недолго, чтобы не держать очередь). */
  async synth(text: string, voice: string, rate: number, timeoutMs = 120_000): Promise<{ file: string; durationMs: number }> {
    if (!text.trim()) throw new Error('Пустой текст')
    const v = await this.pickVoice(voice)
    const r10 = Math.max(-10, Math.min(10, Math.round(rate)))
    const extra = v.startsWith('cb:') ? `|${this.cfg().chatterboxEmotion}` : ''
    const file = `${createHash('sha1').update(`${v}|${r10}${extra}|${text}`).digest('hex')}.wav`
    const path = join(this.dir, file)
    if (!existsSync(path)) {
      if (v.startsWith('cb:')) await this.chatterbox(v, text, r10, path, timeoutMs)
      // Silero: пять ступеней скорости вместо −10…10.
      else if (v.startsWith('silero:')) await this.silero.speak(text, v.slice(7), Math.round((r10 + 10) / 5), path)
      else {
        // OneCore: скорость 0.5…2 вместо −10…10.
        const r = v.startsWith('onecore:')
          ? await this.request({ cmd: 'onecore', text, voice: v.slice(8), rate: Math.round(Math.pow(2, r10 / 10) * 100) / 100, path }, 60_000)
          : await this.request({ cmd: 'speak', text, voice: v, rate: r10, path })
        if (!r.ok) throw new Error(String(r.error ?? 'Ошибка озвучки'))
      }
    }
    const body = await readFile(path)
    return { file, durationMs: wavDurationMs(body) }
  }

  async get(file: string): Promise<Buffer | null> {
    if (!/^[0-9a-f]{40}\.wav$/.test(file)) return null
    try {
      return await readFile(join(this.dir, file))
    } catch {
      return null
    }
  }

  dispose(): void {
    clearInterval(this.cleanTimer)
    this.proc?.kill()
  }
}

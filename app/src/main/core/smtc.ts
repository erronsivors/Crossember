import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/**
 * Что играет в любом плеере Windows (Яндекс Музыка, Spotify, браузер, AIMP…) через системные медиа-кнопки (SMTC).
 * Один процесс PowerShell отвечает на команды poll / toggle / next / prev строками JSON.
 */

const WORKER = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $null = $t.Wait(5000); $t.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
function Reply($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $s = $mgr.GetCurrentSession()
    if ($line -eq 'poll') {
      if (-not $s) { Reply @{ ok = $true; app = '' }; continue }
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $info = $s.GetPlaybackInfo()
      $tl = $s.GetTimelineProperties()
      $o = @{ ok = $true; app = [string]$s.SourceAppUserModelId; title = [string]$p.Title; artist = [string]$p.Artist; album = [string]$p.AlbumTitle; status = [string]$info.PlaybackStatus; pos = [double]$tl.Position.TotalSeconds; end = [double]$tl.EndTime.TotalSeconds; upd = [int64]$tl.LastUpdatedTime.ToUnixTimeMilliseconds() }
      Reply $o
    } elseif ($s -and ($line -eq 'toggle' -or $line -eq 'next' -or $line -eq 'prev')) {
      $op = if ($line -eq 'toggle') { $s.TryTogglePlayPauseAsync() } elseif ($line -eq 'next') { $s.TrySkipNextAsync() } else { $s.TrySkipPreviousAsync() }
      $r = Await $op ([bool])
      Reply @{ ok = [bool]$r }
    } else {
      Reply @{ ok = $false; error = 'no session' }
    }
  } catch {
    Reply @{ ok = $false; error = [string]$_.Exception.Message }
  }
}
`

export interface SmtcNow {
  app: string
  title: string
  artist: string
  album: string
  playing: boolean
  /** Позиция и длительность, секунды (0 — плеер не сообщает). */
  pos: number
  end: number
  /** Когда плеер обновил позицию (мс). */
  upd: number
}

type Reply = Record<string, unknown>

export class Smtc {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private waiting: ((r: Reply) => void)[] = []
  private failures = 0

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
        let r: Reply
        try { r = JSON.parse(line) as Reply } catch { r = { ok: false, error: 'bad reply' } }
        this.waiting.shift()?.(r)
      }
    })
    p.stderr.on('data', () => undefined)
    p.on('exit', () => {
      this.proc = null
      this.buf = ''
      for (const w of this.waiting.splice(0)) w({ ok: false, error: 'exit' })
    })
    p.on('error', () => undefined)
    this.proc = p
    return p
  }

  private ask(cmd: 'poll' | 'toggle' | 'next' | 'prev'): Promise<Reply> {
    // После нескольких сбоев подряд (нет SMTC в системе) — не запускаем PowerShell снова и снова.
    if (this.failures >= 5) return Promise.resolve({ ok: false, error: 'unavailable' })
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.waiting.indexOf(done)
        if (i >= 0) this.waiting.splice(i, 1)
        this.failures++
        this.proc?.kill()
        resolve({ ok: false, error: 'timeout' })
      }, 15_000)
      const done = (r: Reply): void => { clearTimeout(timer); if (r.ok) this.failures = 0; resolve(r) }
      this.waiting.push(done)
      this.start().stdin.write(`${cmd}\n`)
    })
  }

  async poll(): Promise<SmtcNow | null> {
    const r = await this.ask('poll')
    if (!r.ok || !r.app) return null
    const str = (v: unknown): string => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200)
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    return {
      app: str(r.app).replace(/\.exe$/i, '').replace(/^.*!/, ''), title: str(r.title), artist: str(r.artist), album: str(r.album),
      playing: r.status === 'Playing', pos: n(r.pos), end: n(r.end), upd: n(r.upd)
    }
  }

  async control(op: 'toggle' | 'next' | 'prev'): Promise<boolean> {
    const r = await this.ask(op)
    return r.ok === true
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
  }
}

import type { VizRun } from '../../main/core/viz'

/**
 * Визуализатор звука: слушает звук системы или устройство записи и 30 раз в секунду отдаёт уровни полос (0–100).
 * Сам звук никуда не уходит и не записывается — только числа для оверлея.
 */

let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let timer: number | null = null
let cur = ''
/** Номер текущего запуска: устаревший запуск (выключили, пока открывался звук) освобождает всё сам. */
let runId = 0

function stop(): void {
  runId++
  if (timer !== null) clearInterval(timer)
  timer = null
  for (const t of stream?.getTracks() ?? []) t.stop()
  stream = null
  void ctx?.close().catch(() => undefined)
  ctx = null
}

async function open(run: VizRun): Promise<MediaStream> {
  if (run.source === 'system') {
    // Windows отдаёт звук системы только вместе с картинкой экрана — её сразу выключаем.
    const s = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
    for (const t of s.getVideoTracks()) { t.stop(); s.removeTrack(t) }
    if (!s.getAudioTracks().length) throw new Error('Windows не отдал звук системы')
    return s
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { deviceId: run.deviceId ? { exact: run.deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  })
}

/** Полосы на логарифмической шкале 40 Гц – 16 кГц: низы не сливаются в одну полосу. */
function bands(n: number, rate: number, bins: number): [number, number][] {
  const lo = 40
  const hi = Math.min(16000, rate / 2)
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const f1 = lo * Math.pow(hi / lo, i / n)
    const f2 = lo * Math.pow(hi / lo, (i + 1) / n)
    const b1 = Math.max(1, Math.floor((f1 / (rate / 2)) * bins))
    const b2 = Math.max(b1 + 1, Math.ceil((f2 / (rate / 2)) * bins))
    out.push([b1, Math.min(bins, b2)])
  }
  return out
}

async function start(run: VizRun): Promise<void> {
  stop()
  const key = JSON.stringify(run)
  cur = key
  const my = runId
  try {
    const s = await open(run)
    if (my !== runId) { for (const t of s.getTracks()) t.stop(); return }
    stream = s
    ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 4096
    an.smoothingTimeConstant = 0.5
    an.minDecibels = -85
    an.maxDecibels = -20
    ctx.createMediaStreamSource(s).connect(an)
    const data = new Uint8Array(an.frequencyBinCount)
    const ranges = bands(run.bars, ctx.sampleRate, an.frequencyBinCount)
    const gain = run.gain / 100
    timer = window.setInterval(() => {
      an.getByteFrequencyData(data)
      const v = ranges.map(([a, b]) => {
        let m = 0
        for (let i = a; i < b; i++) if (data[i] > m) m = data[i]
        return Math.min(100, Math.round((m / 255) * 100 * gain))
      })
      window.hub.vizFrame(v)
    }, 33)
    for (const t of s.getAudioTracks()) t.addEventListener('ended', () => { if (my === runId) void window.hub.vizStatus('error', 'Источник звука пропал (устройство отключили?)') })
    void window.hub.vizStatus('on')
  } catch (e) {
    if (my !== runId) return
    stop()
    const msg = (e as Error).name === 'NotFoundError' || (e as Error).name === 'OverconstrainedError' ? 'Устройство записи не найдено — выберите другое' : (e as Error).name === 'NotAllowedError' ? 'Нет доступа к звуку' : (e as Error).message
    void window.hub.vizStatus('error', msg)
  }
}

function apply(run: VizRun | null): void {
  if (!run) {
    cur = ''
    stop()
    return
  }
  if (JSON.stringify(run) !== cur) void start(run)
}

/** Подключить визуализатор к ядру (один раз при запуске интерфейса). */
export function initAudioViz(): void {
  window.hub.onViz(apply)
  void window.hub.vizGet().then(apply).catch(() => undefined)
}

/** Устройства записи для выбора в настройках. */
export async function audioInputs(): Promise<{ id: string; label: string }[]> {
  const list = await navigator.mediaDevices.enumerateDevices()
  return list.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications').map((d, i) => ({ id: d.deviceId, label: d.label || `Устройство ${i + 1}` }))
}

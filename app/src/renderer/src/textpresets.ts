// Текстовые шаблоны с анимацией по буквам (раздел «Текстовые» в выборе шаблона).
import { makeLayer } from './pages/AlertEditor'
import type { AlertPreset } from './presets'

const uid = (): string => crypto.randomUUID()

// Вход букв рассчитан с запасом на ник из 25 знаков и сумму из 16 знаков.
// duration: 0 сохраняет сообщение до конца алерта, включая extendByMessage.
export const KINETIC_PRESETS: AlertPreset[] = [
  {
    id: 'kin-teletype', name: 'Набор строки',
    desc: 'В верхнем левом углу последовательно печатаются ник и сумма, затем появляется сообщение.',
    make: () => ({
      id: uid(), name: 'Набор строки', theme: 'auto', durationMs: 7200, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Площадка', text: '{platform}', font: 'mono', size: 26, color: '#c9d6ce', align: 'left', x: 100, y: 90, w: 1400, h: 44, shadow: true, stroke: 1, textFx: 'none', animIn: 'fade', animInMs: 200 }),
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'mono', size: 54, color: '#f3f7f4', align: 'left', x: 100, y: 146, w: 1500, h: 88, shadow: true, stroke: 1, textFx: 'type', fxStep: 30, animIn: 'none' }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'mono', size: 44, color: '#b5d5bd', accent: '#b5d5bd', align: 'left', x: 100, y: 240, w: 1500, h: 72, start: 850, shadow: true, stroke: 1, textFx: 'type', fxStep: 25, animIn: 'none' }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 32, bold: false, color: '#f3f7f4', align: 'left', x: 100, y: 330, w: 1450, h: 300, start: 1500, duration: 0, shadow: true, stroke: 1, textFx: 'none', animIn: 'fade', animInMs: 300 }),
        makeLayer('sound', { sound: 'pop', volume: 50 })
      ]
    })
  },
  {
    id: 'kin-rain', name: 'Ливень букв',
    desc: 'Буквы ника и суммы падают в широкую строку над нижним краем экрана.',
    make: () => ({
      id: uid(), name: 'Ливень букв', theme: 'auto', durationMs: 7500, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'manrope', size: 58, color: '#f4f7fb', align: 'left', x: 110, y: 620, w: 1660, h: 90, shadow: true, stroke: 2, textFx: 'drop', fxStep: 28, animIn: 'none' }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'mono', size: 46, color: '#b9cfe5', accent: '#b9cfe5', align: 'left', x: 110, y: 714, w: 1660, h: 76, start: 400, shadow: true, stroke: 1, textFx: 'drop', fxStep: 24, animIn: 'none' }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 32, bold: false, color: '#f4f7fb', align: 'left', x: 110, y: 810, w: 1660, h: 220, start: 1800, duration: 0, shadow: true, stroke: 1, textFx: 'none', animIn: 'fade', animInMs: 320 }),
        makeLayer('sound', { sound: 'coin', volume: 60 })
      ]
    })
  },
  {
    id: 'kin-thermal', name: 'Тёплый воздух',
    desc: 'В правой колонке буквы мягко всплывают на свои места, оставляя центр игры свободным.',
    make: () => ({
      id: uid(), name: 'Тёплый воздух', theme: 'auto', durationMs: 8000, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Площадка', text: '{platform}', font: 'mono', size: 24, color: '#dbcbb9', align: 'right', x: 1040, y: 210, w: 780, h: 44, shadow: true, stroke: 1, textFx: 'none', animIn: 'fade', animInMs: 250 }),
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'manrope', size: 38, color: '#fff5e9', align: 'right', x: 1040, y: 272, w: 780, h: 120, shadow: true, stroke: 1, textFx: 'rise', fxStep: 26, animIn: 'none' }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'mono', size: 46, color: '#e7b87e', accent: '#e7b87e', align: 'right', x: 1040, y: 412, w: 780, h: 80, start: 350, shadow: true, stroke: 1, textFx: 'rise', fxStep: 24, animIn: 'none' }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 30, bold: false, color: '#fff5e9', align: 'right', x: 1040, y: 520, w: 780, h: 450, start: 1800, duration: 0, shadow: true, stroke: 1, textFx: 'none', animIn: 'fade', animInMs: 400 }),
        makeLayer('sound', { sound: 'fire', volume: 45 })
      ]
    })
  },
  {
    id: 'kin-growth', name: 'На вырост',
    desc: 'Крупная сумма вырастает по цифрам в центре, следом собираются буквы ника.',
    make: () => ({
      id: uid(), name: 'На вырост', theme: 'auto', durationMs: 7500, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'unbounded', size: 98, color: '#ebc683', accent: '#ebc683', x: 160, y: 240, w: 1600, h: 170, shadow: true, stroke: 2, textFx: 'zoom', fxStep: 30, animIn: 'none' }),
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'manrope', size: 56, color: '#fff9ed', x: 160, y: 438, w: 1600, h: 100, start: 450, shadow: true, stroke: 2, textFx: 'zoom', fxStep: 26, animIn: 'none' }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 36, bold: false, color: '#fff9ed', x: 260, y: 580, w: 1400, h: 340, start: 1900, duration: 0, shadow: true, stroke: 1, textFx: 'none', animIn: 'fade', animInMs: 350 }),
        makeLayer('sound', { sound: 'fanfare', volume: 60 })
      ]
    })
  },
  {
    id: 'kin-turn', name: 'Переворот',
    desc: 'В левой колонке ник и сумма раскрываются переворотом каждой буквы, как механические створки.',
    make: () => ({
      id: uid(), name: 'Переворот', theme: 'auto', durationMs: 7800, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Площадка', text: '{platform}', font: 'mono', size: 24, color: '#c6d4dc', align: 'left', x: 100, y: 180, w: 800, h: 44, shadow: true, stroke: 1, textFx: 'none', animIn: 'fade', animInMs: 200 }),
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'mono', size: 40, color: '#f6f9fb', align: 'left', x: 100, y: 246, w: 800, h: 110, shadow: true, stroke: 1, textFx: 'flip', fxStep: 30, animIn: 'none' }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'mono', size: 54, color: '#9fbdd0', accent: '#9fbdd0', align: 'left', x: 100, y: 386, w: 800, h: 90, start: 450, shadow: true, stroke: 1, textFx: 'flip', fxStep: 28, animIn: 'none' }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 30, bold: false, color: '#f6f9fb', align: 'left', x: 100, y: 510, w: 800, h: 450, start: 2000, duration: 0, shadow: true, stroke: 1, textFx: 'none', animIn: 'fade', animInMs: 300 }),
        makeLayer('sound', { sound: 'coin', volume: 55 })
      ]
    })
  },
  {
    id: 'kin-assemble', name: 'Сборка слова',
    desc: 'Разлетевшиеся буквы сходятся в ник в верхней части экрана, под ним собирается сумма.',
    make: () => ({
      id: uid(), name: 'Сборка слова', theme: 'auto', durationMs: 7600, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'unbounded', size: 54, color: '#f7f1e9', x: 160, y: 180, w: 1600, h: 100, shadow: true, stroke: 2, textFx: 'scatter', fxStep: 32, animIn: 'none' }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'mono', size: 62, color: '#dba48c', accent: '#dba48c', x: 260, y: 308, w: 1400, h: 100, start: 400, shadow: true, stroke: 2, textFx: 'scatter', fxStep: 28, animIn: 'none' }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 34, bold: false, color: '#f7f1e9', x: 260, y: 460, w: 1400, h: 380, start: 1800, duration: 0, shadow: true, stroke: 1, textFx: 'none', animIn: 'fade', animInMs: 400 }),
        makeLayer('sound', { sound: 'pop', volume: 60 })
      ]
    })
  },
  {
    id: 'kin-lamplight', name: 'Ламповый свет',
    desc: 'Справа внизу тёплые буквы загораются с короткими перебоями, а сообщение спокойно проявляется ниже.',
    make: () => ({
      id: uid(), name: 'Ламповый свет', theme: 'auto', durationMs: 8000, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'manrope', size: 48, color: '#f0d6a6', align: 'right', x: 700, y: 540, w: 1120, h: 130, shadow: true, stroke: 2, textFx: 'flicker', fxStep: 35, animIn: 'none' }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'mono', size: 48, color: '#fff6e5', accent: '#fff6e5', align: 'right', x: 700, y: 690, w: 1120, h: 80, start: 300, shadow: true, stroke: 1, textFx: 'flicker', fxStep: 30, animIn: 'none' }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 32, bold: false, color: '#fff6e5', align: 'right', x: 700, y: 810, w: 1120, h: 220, start: 1800, duration: 0, shadow: true, stroke: 1, textFx: 'none', animIn: 'fade', animInMs: 400 }),
        makeLayer('sound', { sound: 'chime', volume: 50 })
      ]
    })
  },
  {
    id: 'kin-tide', name: 'Морской ритм',
    desc: 'Буквы ника и суммы покачиваются волной внизу по центру, над неподвижным сообщением.',
    make: () => ({
      id: uid(), name: 'Морской ритм', theme: 'auto', durationMs: 7800, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'manrope', size: 56, color: '#e8f4f1', x: 160, y: 540, w: 1600, h: 100, shadow: true, stroke: 2, textFx: 'wave', fxStep: 28, animIn: 'fade', animInMs: 300 }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'mono', size: 52, color: '#9ec9c3', accent: '#9ec9c3', x: 260, y: 666, w: 1400, h: 90, start: 300, shadow: true, stroke: 1, textFx: 'wave', fxStep: 32, animIn: 'fade', animInMs: 300 }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 34, bold: false, color: '#e8f4f1', x: 220, y: 804, w: 1480, h: 230, start: 2100, duration: 0, shadow: true, stroke: 1, textFx: 'none', animIn: 'fade', animInMs: 450 }),
        makeLayer('sound', { sound: 'chime', volume: 55 })
      ]
    })
  },
  {
    id: 'kin-signal', name: 'Сбой сигнала',
    desc: 'Ник и сумма проявляются рывками с цветным сдвигом, потом изредка снова сбоят, как помехи в эфире.',
    make: () => ({
      id: uid(), name: 'Сбой сигнала', theme: 'auto', durationMs: 7000, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Подпись', text: 'входящий сигнал · {platform}', font: 'mono', size: 26, color: '#d7dde3', x: 360, y: 190, w: 1200, h: 44, shadow: true, stroke: 1, textFx: 'glitch', fxStep: 20, animIn: 'none' }),
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'unbounded', size: 80, color: '#ffffff', x: 160, y: 240, w: 1600, h: 120, start: 150, shadow: true, stroke: 2, textFx: 'glitch', fxStep: 30, animIn: 'none' }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'mono', size: 56, color: '#ffd166', accent: '#ffd166', x: 360, y: 368, w: 1200, h: 84, start: 450, shadow: true, stroke: 2, textFx: 'glitch', fxStep: 30, animIn: 'none' }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 32, bold: false, color: '#eef1f4', x: 310, y: 465, w: 1300, h: 220, start: 1100, shadow: true, stroke: 1, animIn: 'fade', animInMs: 300 }),
        makeLayer('sound', { sound: 'pop', volume: 65 })
      ]
    })
  }
]

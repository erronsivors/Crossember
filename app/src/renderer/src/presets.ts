// Готовые наборы шаблонов алертов: выбираются при создании шаблона и дальше правятся в конструкторе.
import type { AlertTemplate, Keyframe, Layer } from '../../main/core/templates'
import { makeLayer } from './pages/AlertEditor'
import { ART_SETS, type ArtSet } from '../../main/core/art'
import { PACK_MODES, type PackMode, type PackSet } from '../../main/core/alertpack'

export interface AlertPreset {
  id: string
  name: string
  desc: string
  /** Подгруппа векторных наборов; без группы — раздел «Текстовые». */
  group?: string
  make(): AlertTemplate
}

const uid = (): string => crypto.randomUUID()
const kf = (t: number, x: number, y: number, ease: Keyframe['ease'] = 'inout'): Keyframe => ({ t, x, y, scale: 1, rotate: 0, opacity: 1, ease })

/** Ключевой кадр с масштабом, поворотом и прозрачностью. */
const kfx = (t: number, x: number, y: number, o: Partial<Keyframe> = {}): Keyframe => ({ t, x, y, scale: 1, rotate: 0, opacity: 1, ease: 'inout', ...o })
/** Искра или конфетти: маленький текстовый слой, который вспыхивает с задержкой. */
const spark = (ch: string, x: number, y: number, start: number, color: string, size = 46) =>
  makeLayer('text', { name: 'Искра', text: ch, font: 'manrope', size, color, x, y, w: 90, h: 90, start, duration: 2400, animIn: 'pop', animInMs: 380, animOut: 'fade', animOutMs: 600, shadow: false })

export const PRESETS: AlertPreset[] = [
  {
    id: 'general',
    name: 'Общий',
    desc: 'Аккуратная карточка с иконкой — подходит любому каналу.',
    make: () => ({
      id: uid(), name: 'Общий', theme: 'general', durationMs: 6000, extendByMessage: true,
      layers: [makeLayer('card'), makeLayer('sound', { sound: 'coin', volume: 75 })]
    })
  },
  {
    id: 'campfire',
    name: 'У костра',
    desc: 'Тёплая карточка с мягким свечением, медленно поднимается, звук костра.',
    make: () => ({
      id: uid(), name: 'У костра', theme: 'campfire', durationMs: 7000, extendByMessage: true,
      layers: [
        makeLayer('card', { animIn: 'up', animInMs: 650, animOutMs: 600, keyframes: [kf(0, 260, 212), kf(7000, 260, 196)] }),
        makeLayer('sound', { sound: 'fire', volume: 70 })
      ]
    })
  },
  {
    id: 'minimal',
    name: 'Минимал',
    desc: 'Две строки текста в углу экрана, без подложки — не мешает игре.',
    make: () => ({
      id: uid(), name: 'Минимал', theme: 'auto', durationMs: 5500, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Ник и сумма', text: '{user}   {amount}', font: 'manrope', size: 48, align: 'left', x: 96, y: 860, w: 1500, h: 72, animIn: 'right', animInMs: 500 }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 30, bold: false, color: '#dcdce4', align: 'left', x: 96, y: 936, w: 1500, h: 96, start: 150, animIn: 'right', animInMs: 500 }),
        makeLayer('sound', { sound: 'pop', volume: 60 })
      ]
    })
  },
  {
    id: 'big',
    name: 'Крупный текст',
    desc: 'Большой ник и сумма по центру экрана — для заметных донатов.',
    make: () => ({
      id: uid(), name: 'Крупный текст', theme: 'auto', durationMs: 6500, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'unbounded', size: 104, x: 120, y: 300, w: 1680, h: 150, animIn: 'zoom', animInMs: 550 }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'unbounded', size: 84, x: 120, y: 455, w: 1680, h: 120, start: 250, animIn: 'up', animInMs: 500 }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 36, bold: false, color: '#e6e6ec', x: 260, y: 600, w: 1400, h: 150, start: 450, animIn: 'fade', animInMs: 500 }),
        makeLayer('sound', { sound: 'fanfare', volume: 70 })
      ]
    })
  },
  {
    id: 'neon',
    name: 'Неон',
    desc: 'Светящиеся буквы с обводкой, площадка сверху — как вывеска ночью.',
    make: () => ({
      id: uid(), name: 'Неон', theme: 'auto', durationMs: 6000, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Подпись', text: '★ {platform} ★', font: 'mono', size: 30, color: '#ff5ec8', x: 360, y: 300, w: 1200, h: 50, animIn: 'fade', animInMs: 300 }),
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'unbounded', size: 92, color: '#7cf3ff', stroke: 3, x: 160, y: 352, w: 1600, h: 130, start: 120, animIn: 'pop', animInMs: 420 }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'mono', size: 64, color: '#ffffff', accent: '#ff5ec8', x: 360, y: 488, w: 1200, h: 90, start: 300, animIn: 'zoom', animInMs: 380 }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 32, bold: false, color: '#d6f8ff', x: 300, y: 590, w: 1320, h: 140, start: 500, animIn: 'fade' }),
        makeLayer('sound', { sound: 'chime', volume: 70 })
      ]
    })
  },
  {
    id: 'comic',
    name: 'Комикс',
    desc: 'Жирный жёлтый текст с чёрной обводкой, наклонён и влетает с поворотом.',
    make: () => ({
      id: uid(), name: 'Комикс', theme: 'auto', durationMs: 5500, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Возглас', text: 'БАМ!', font: 'unbounded', size: 120, color: '#ff4f4f', stroke: 8, rotate: -8, x: 240, y: 230, w: 700, h: 170, animIn: 'spin', animInMs: 450 }),
        makeLayer('text', { name: 'Ник и сумма', text: '{user} — {amount}', font: 'unbounded', size: 76, color: '#ffe14d', accent: '#ffffff', stroke: 7, rotate: -4, x: 200, y: 420, w: 1520, h: 120, start: 200, animIn: 'zoom', animInMs: 380 }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 38, color: '#ffffff', stroke: 4, rotate: -2, x: 300, y: 560, w: 1320, h: 150, start: 380, animIn: 'up' }),
        makeLayer('sound', { sound: 'pop', volume: 80 })
      ]
    })
  },
  {
    id: 'credits',
    name: 'Титры',
    desc: 'Карточка внизу слева, как подпись в новостях: выезжает и уезжает.',
    make: () => ({
      id: uid(), name: 'Титры', theme: 'auto', durationMs: 6500, extendByMessage: true,
      layers: [
        makeLayer('card', { kicker: 'Спасибо', text: '{user} · {amount}', x: 70, y: 820, w: 1000, h: 190, animIn: 'left', animInMs: 550, animOut: 'left', animOutMs: 500 }),
        makeLayer('sound', { sound: 'chime', volume: 55 })
      ]
    })
  },
  {
    id: 'scoreboard',
    name: 'Табло',
    desc: 'Сумма огромными цифрами вверху по центру, ник под ней — как табло на стадионе.',
    make: () => ({
      id: uid(), name: 'Табло', theme: 'auto', durationMs: 6000, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'mono', size: 128, color: '#ffc04d', accent: '#ffc04d', stroke: 4, x: 360, y: 40, w: 1200, h: 170, animIn: 'down', animInMs: 500 }),
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'unbounded', size: 54, x: 360, y: 210, w: 1200, h: 80, start: 250, animIn: 'fade' }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 30, bold: false, color: '#f0e6d8', x: 360, y: 290, w: 1200, h: 120, start: 420, animIn: 'fade' }),
        makeLayer('sound', { sound: 'coin', volume: 75 })
      ]
    })
  },
  {
    id: 'sparks',
    name: 'Искры',
    desc: 'Тёплая карточка, вокруг вспыхивают искры одна за другой.',
    make: () => ({
      id: uid(), name: 'Искры', theme: 'campfire', durationMs: 7000, extendByMessage: true,
      layers: [
        makeLayer('card', { animIn: 'up', animInMs: 600, keyframes: [kfx(0, 260, 220), kfx(3500, 260, 208, { scale: 1.02 }), kfx(7000, 260, 214)] }),
        spark('✦', 240, 170, 300, '#ffb27a'), spark('✧', 1620, 190, 520, '#ff7a3c'), spark('✦', 1560, 470, 760, '#ffd27a', 38),
        spark('✧', 300, 500, 980, '#ff9a5c', 38), spark('✦', 940, 120, 1200, '#ffe0a8', 34),
        makeLayer('sound', { sound: 'fire', volume: 65 })
      ]
    })
  },
  {
    id: 'arcade',
    name: 'Аркада',
    desc: 'Зелёные строки моноширинным шрифтом, «+сумма» подпрыгивает — как в старой игре.',
    make: () => ({
      id: uid(), name: 'Аркада', theme: 'auto', durationMs: 5500, extendByMessage: true,
      layers: [
        makeLayer('text', {
          name: 'Сумма', text: '+{amount}', font: 'mono', size: 96, color: '#7cff6b', accent: '#7cff6b', x: 460, y: 300, w: 1000, h: 130, animIn: 'pop', animInMs: 300,
          keyframes: [kfx(0, 460, 300), kfx(300, 460, 270, { ease: 'out' }), kfx(600, 460, 300, { ease: 'in' }), kfx(5500, 460, 300)]
        }),
        makeLayer('text', { name: 'Игрок', text: 'ИГРОК {user}', font: 'mono', size: 44, color: '#d8ffd2', x: 360, y: 440, w: 1200, h: 70, start: 350, animIn: 'fade', animInMs: 200 }),
        makeLayer('text', { name: 'Сообщение', text: '> {message}', font: 'mono', size: 30, bold: false, color: '#9bd99a', align: 'left', x: 460, y: 520, w: 1000, h: 150, start: 550, animIn: 'fade', animInMs: 200 }),
        makeLayer('sound', { sound: 'coin', volume: 70 })
      ]
    })
  },
  {
    id: 'breaking',
    name: 'Срочно',
    desc: 'Плашка «Срочно» и заголовок новости во всю ширину внизу экрана.',
    make: () => ({
      id: uid(), name: 'Срочно', theme: 'auto', durationMs: 6500, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Срочно', text: 'СРОЧНО', font: 'unbounded', size: 40, color: '#ff4f4f', align: 'left', x: 120, y: 760, w: 420, h: 64, animIn: 'left', animInMs: 350 }),
        makeLayer('text', { name: 'Заголовок', text: '{user} поддерживает стрим: {amount}', font: 'unbounded', size: 54, align: 'left', x: 120, y: 830, w: 1680, h: 84, start: 200, animIn: 'right', animInMs: 450 }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 30, bold: false, color: '#ffd6d6', align: 'left', x: 120, y: 920, w: 1680, h: 110, start: 380, animIn: 'fade' }),
        makeLayer('sound', { sound: 'chime', volume: 70 })
      ]
    })
  },
  {
    id: 'stamp',
    name: 'Печать',
    desc: 'Красная печать «Принято» с размаху опускается на экран, ник рядом.',
    make: () => ({
      id: uid(), name: 'Печать', theme: 'auto', durationMs: 5500, extendByMessage: true,
      layers: [
        makeLayer('text', {
          name: 'Печать', text: 'ПРИНЯТО', font: 'unbounded', size: 110, color: '#ff3b3b', stroke: 6, rotate: -12, x: 560, y: 260, w: 800, h: 160, animIn: 'none',
          keyframes: [kfx(0, 560, 260, { scale: 2.4, opacity: 0, rotate: -20 }), kfx(260, 560, 260, { scale: 0.92, rotate: -12, ease: 'in' }), kfx(380, 560, 260, { rotate: -12 }), kfx(5500, 560, 260, { rotate: -12 })]
        }),
        makeLayer('text', { name: 'Ник и сумма', text: '{user} · {amount}', font: 'unbounded', size: 60, x: 260, y: 460, w: 1400, h: 100, start: 420, animIn: 'up' }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 32, bold: false, color: '#f1e9e9', x: 300, y: 570, w: 1320, h: 140, start: 600, animIn: 'fade' }),
        makeLayer('sound', { sound: 'pop', volume: 85 })
      ]
    })
  },
  {
    id: 'cascade',
    name: 'Лесенка',
    desc: 'Три строки появляются по очереди со сдвигом и мягко покачиваются.',
    make: () => ({
      id: uid(), name: 'Лесенка', theme: 'auto', durationMs: 6500, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'unbounded', size: 70, align: 'left', x: 420, y: 330, w: 1200, h: 100, animIn: 'up', animInMs: 450, keyframes: [kfx(0, 420, 330), kfx(3200, 430, 324), kfx(6500, 420, 330)] }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'unbounded', size: 60, align: 'left', x: 500, y: 430, w: 1100, h: 90, start: 300, animIn: 'up', animInMs: 450, keyframes: [kfx(0, 500, 430), kfx(3400, 488, 436), kfx(6500, 500, 430)] }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 32, bold: false, color: '#e2e2ea', align: 'left', x: 580, y: 525, w: 1000, h: 150, start: 600, animIn: 'up', animInMs: 450 }),
        makeLayer('sound', { sound: 'chime', volume: 60 })
      ]
    })
  },
  {
    id: 'corner',
    name: 'Тихий угол',
    desc: 'Маленькая карточка в правом верхнем углу и тихий звук — когда важен центр экрана.',
    make: () => ({
      id: uid(), name: 'Тихий угол', theme: 'auto', durationMs: 5000, extendByMessage: true,
      layers: [
        makeLayer('card', { x: 1220, y: 40, w: 660, h: 170, size: 34, animIn: 'right', animInMs: 450, animOut: 'right', animOutMs: 400 }),
        makeLayer('sound', { sound: 'pop', volume: 40 })
      ]
    })
  },
  {
    id: 'party',
    name: 'Праздник',
    desc: 'Конфетти по экрану, большой ник и сумма в центре — для крупных донатов.',
    make: () => ({
      id: uid(), name: 'Праздник', theme: 'auto', durationMs: 7500, extendByMessage: true,
      layers: [
        spark('🎉', 300, 200, 0, '#ffffff', 70), spark('🎊', 1520, 220, 150, '#ffffff', 70), spark('✨', 520, 640, 300, '#ffffff', 56),
        spark('🎉', 1340, 660, 450, '#ffffff', 64), spark('✨', 940, 110, 600, '#ffffff', 52),
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'unbounded', size: 100, x: 160, y: 300, w: 1600, h: 140, start: 200, animIn: 'zoom', animInMs: 500 }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'unbounded', size: 80, x: 360, y: 445, w: 1200, h: 110, start: 420, animIn: 'pop', animInMs: 450 }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 36, bold: false, color: '#fff3e6', x: 260, y: 570, w: 1400, h: 150, start: 650, animIn: 'fade' }),
        makeLayer('sound', { sound: 'fanfare', volume: 75 })
      ]
    })
  },
  {
    id: 'side',
    name: 'Боковая лента',
    desc: 'Узкая колонка справа: ник, сумма и сообщение выезжают сбоку и не закрывают игру.',
    make: () => ({
      id: uid(), name: 'Боковая лента', theme: 'auto', durationMs: 6000, extendByMessage: true,
      layers: [
        makeLayer('text', { name: 'Подпись', text: 'новая поддержка', font: 'mono', size: 24, color: '#c8c8d0', align: 'right', x: 1300, y: 380, w: 560, h: 40, animIn: 'right', animInMs: 400 }),
        makeLayer('text', { name: 'Ник', text: '{user}', font: 'unbounded', size: 50, align: 'right', x: 1160, y: 420, w: 700, h: 76, start: 120, animIn: 'right', animInMs: 450 }),
        makeLayer('text', { name: 'Сумма', text: '{amount}', font: 'unbounded', size: 46, align: 'right', x: 1160, y: 496, w: 700, h: 70, start: 240, animIn: 'right', animInMs: 450 }),
        makeLayer('text', { name: 'Сообщение', text: '{message}', font: 'manrope', size: 28, bold: false, color: '#e6e6ec', align: 'right', x: 1160, y: 570, w: 700, h: 160, start: 380, animIn: 'right', animInMs: 450 }),
        makeLayer('sound', { sound: 'pop', volume: 60 })
      ]
    })
  }
]

// ---------- наборы с встроенными картинками (resources/overlays/art) ----------

/** Шаблон из векторного набора: рамка под текст, персонаж с лёгким покачиванием, ник, сумма и сообщение. */
function artPreset(a: ArtSet): AlertPreset {
  return {
    id: `art-${a.id}`,
    name: a.name,
    desc: a.desc,
    group: a.group,
    make: () => {
      const dur = 7000
      const dark = parseInt(a.color.slice(1, 3), 16) + parseInt(a.color.slice(3, 5), 16) + parseInt(a.color.slice(5, 7), 16) < 380
      const txt = { font: a.font, color: a.color, accent: a.accent, shadow: !dark, bold: true }
      const side = a.layout === 'side'
      const fr = side ? { x: 420, y: 140 } : { x: 360, y: 330 }
      const hero = side ? { x: 250, y: 100, s: 440 } : { x: 750, y: 10, s: 420 }
      const tx = side ? { x: fr.x + 300, y: fr.y + 70, w: 820, align: 'left' as const } : { x: fr.x + 150, y: fr.y + 120, w: 900, align: 'center' as const }
      const bob = (t: number, dy: number): Keyframe => kfx(t, hero.x, hero.y + dy)
      return {
        id: uid(), name: a.name, theme: 'general', durationMs: dur, extendByMessage: true,
        layers: [
          makeLayer('image', { name: 'Рамка', media: `b:${a.id}-frame`, x: fr.x, y: fr.y, w: 1200, h: 400, animIn: side ? 'right' : 'up', animInMs: 550, animOutMs: 500, start: 120 }),
          makeLayer('image', { name: 'Персонаж', media: `b:${a.id}-hero`, x: hero.x, y: hero.y, w: hero.s, h: hero.s, animIn: a.heroIn, animInMs: 650, animOutMs: 450,
            keyframes: [bob(0, 0), bob(dur * 0.25, -14), bob(dur * 0.5, 0), bob(dur * 0.75, -14), bob(dur, 0)] }),
          makeLayer('text', { name: 'Ник', text: '{user}', size: 54, x: tx.x, y: tx.y, w: tx.w, h: 76, align: tx.align, start: 380, animIn: 'up', animInMs: 420, ...txt }),
          makeLayer('text', { name: 'Сумма', text: '{amount}', size: 46, x: tx.x, y: tx.y + 74, w: tx.w, h: 64, align: tx.align, start: 520, animIn: 'pop', animInMs: 420, ...txt, color: a.accent }),
          makeLayer('text', { name: 'Сообщение', text: '{message}', size: 28, bold: false, x: tx.x, y: tx.y + 140, w: tx.w, h: 96, align: tx.align, start: 700, animIn: 'fade', animInMs: 500, font: 'manrope', color: a.color, shadow: !dark }),
          makeLayer('sound', { sound: a.sound, volume: 70 })
        ]
      }
    }
  }
}

PRESETS.push(...ART_SETS.map(artPreset))

// ---------- основной набор (Crossember-Alerts): готовая анимация WebP + текст по ключам набора ----------

/** Шаблон основного набора: анимация 1400×620 по центру 1920×1080, ник, сумма и сообщение двигаются по ключам набора. */
export function packTemplate(s: PackSet, mode: PackMode): AlertTemplate {
  const m = s.modes[mode]
  const file = PACK_MODES.find((x) => x.id === mode)?.file ?? 'anim-classic.webp'
  const ox = 260
  const oy = 230
  const [sx, sy, sw, sh] = s.safe
  const dark = parseInt(s.color.slice(1, 3), 16) + parseInt(s.color.slice(3, 5), 16) + parseInt(s.color.slice(5, 7), 16) < 380
  const keys = (x: number, y: number): Keyframe[] => m.keys.map(([t, dx, dy, scale, opacity, ease]) => ({ t, x: x + dx, y: y + dy, scale, rotate: 0, opacity, ease }))
  const lineH = [Math.round(sh * 0.36), Math.round(sh * 0.3), Math.round(sh * 0.34)]
  const ys = [oy + sy, oy + sy + lineH[0], oy + sy + lineH[0] + lineH[1]]
  const txt = (name: string, text: string, i: number, size: number, bold: boolean): Layer =>
    makeLayer('text', { name, text, font: i === 2 ? 'manrope' : s.font, size, bold, color: s.color, shadow: !dark, x: ox + sx, y: ys[i], w: sw, h: lineH[i], animIn: 'none', animOut: 'none', keyframes: keys(ox + sx, ys[i]) })
  return {
    id: uid(), name: `${s.name} · ${PACK_MODES.find((x) => x.id === mode)?.name ?? ''}`, theme: 'general', durationMs: m.ms, extendByMessage: false,
    layers: [
      makeLayer('image', { name: 'Анимация', media: `p:${s.id}/${file}`, x: ox, y: oy, w: 1400, h: 620, animIn: 'none', animOut: 'none' }),
      txt('Ник', '{user}', 0, Math.min(48, Math.round(lineH[0] * 0.78)), true),
      txt('Сумма', '{amount}', 1, Math.min(40, Math.round(lineH[1] * 0.78)), true),
      txt('Сообщение', '{message}', 2, Math.min(26, Math.round(lineH[2] * 0.42)), false),
      makeLayer('sound', { sound: 'chime', volume: 60 })
    ]
  }
}

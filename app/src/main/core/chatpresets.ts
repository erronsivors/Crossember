// Готовые стили чата для OBS: применяются одной кнопкой на странице «Оформление чата».
// Стиль задаёт только внешний вид; фильтры, площадки, события и роли зрителя остаются как были.
import { lookDefaults, textDefaults, type ChatLook } from './chatstyle'
import type { Theme } from './settings'

type Visual = Omit<ChatLook, 'filter' | 'platforms' | 'events' | 'roles'>

export interface ChatPreset {
  id: string
  label: string
  /** Одна строка: для какого стрима или фона подходит. */
  note: string
  theme: Theme
  look: Partial<Visual>
}

export const CHAT_PRESETS: ChatPreset[] = [
  { id: 'base', label: 'Базовый', note: 'Настройки по умолчанию', theme: 'general', look: {} },
  {
    id: 'paper', label: 'Бумага', note: 'Для светлых сцен и разговорных эфиров', theme: 'general',
    look: {
      bg: 'card', bgColor: '#f5f2e9', opacity: 100, radius: 3, gap: 12,
      layout: 'stacked', align: 'left', plat: 'dot', sep: '',
      animIn: 'fade', animOut: 'fade', animMs: 400, highlight: 'bar',
      textMode: 'split',
      name: textDefaults({ font: 'georgia', weight: 800, color: '#654537' }),
      msg: textDefaults({ font: 'georgia', weight: 400, color: '#292a26', line: 155 }),
      event: textDefaults({ font: 'georgia', weight: 800, color: '#654537', italic: true }),
      colors: {
        twitch: '#70543e', youtube: '#934c40', vk: '#3c637c', kick: '#42664c', goodgame: '#536578',
        donationalerts: '#89591f', donatepay: '#42664c', donatex: '#855059', boosty: '#985239', hub: '#70543e'
      }
    }
  },
  {
    id: 'porcelain', label: 'Фарфор', note: 'Для светлого фона и аккуратного чата справа', theme: 'general',
    look: {
      bg: 'card', bgColor: '#edf5f7', opacity: 100, radius: 24, gap: 10,
      layout: 'inline', align: 'right', plat: 'dot', sep: ' ·',
      animIn: 'pop', animOut: 'shrink', animMs: 260, highlight: 'frame',
      // Свой цвет ника: цвета зрителей из Twitch (жёлтые, голубые) на светлой подложке не читаются.
      textMode: 'split',
      name: textDefaults({ font: 'arial', weight: 800, color: '#2c5866' }),
      msg: textDefaults({ font: 'arial', color: '#203e48', line: 145 }),
      event: textDefaults({ font: 'arial', weight: 800, color: '#2c5866' }),
      colors: {
        twitch: '#426978', youtube: '#98514e', vk: '#365b85', kick: '#3b6c58', goodgame: '#526778',
        donationalerts: '#865d28', donatepay: '#3b6c58', donatex: '#8c5268', boosty: '#925235', hub: '#426978'
      }
    }
  },
  {
    id: 'contour', label: 'Контур', note: 'Крупный чат поверх яркой динамичной игры', theme: 'general',
    look: {
      bg: 'plain', opacity: 0, radius: 0, gap: 10,
      layout: 'stacked', align: 'left', plat: 'dot', sep: '',
      animIn: 'pop', animOut: 'shrink', animMs: 220, highlight: 'none',
      textMode: 'all', bigEmoteScale: 350,
      text: textDefaults({ font: 'impact', color: '#ffffff', weight: 400, letter: 1, line: 140, stroke: 2, strokeColor: '#15191e', shadow: 5, shadowColor: '#15191e' }),
      colors: {
        twitch: '#d9e1ea', youtube: '#efb7ad', vk: '#b6d8ec', kick: '#bdd8bb', goodgame: '#c8d7e5',
        donationalerts: '#efce9a', donatepay: '#bdd8bb', donatex: '#e6b8c3', boosty: '#edc0a2', hub: '#efce9a'
      }
    }
  },
  {
    id: 'orbit', label: 'Орбита', note: 'Воздушный чат справа поверх игрового видео', theme: 'general',
    look: {
      bg: 'plain', opacity: 0, radius: 0, gap: 16,
      layout: 'inline', align: 'right', plat: 'dot', sep: ' /',
      animIn: 'blur', animOut: 'fade', animMs: 450, highlight: 'bar',
      textMode: 'all', emoteScale: 140,
      text: textDefaults({ font: 'unbounded', color: '#f0f5ff', weight: 600, line: 160, stroke: 1, strokeColor: '#101923', shadow: 9, shadowColor: '#101923' }),
      colors: {
        twitch: '#b9cedd', youtube: '#e5b5a8', vk: '#a9d3e8', kick: '#b5d5c6', goodgame: '#c2d5e8',
        donationalerts: '#e8d1a3', donatepay: '#b5d5c6', donatex: '#dfbecd', boosty: '#e4bfa7', hub: '#b9cedd'
      }
    }
  },
  {
    id: 'field-log', label: 'Бортжурнал', note: 'Для симуляторов, стратегий и технических эфиров', theme: 'general',
    look: {
      bg: 'strip', bgColor: '#18251f', opacity: 94, radius: 0, gap: 2,
      layout: 'inline', align: 'stretch', plat: 'tag', sep: ' /', newestTop: true, time: true,
      animIn: 'none', animOut: 'none', animMs: 100, highlight: 'frame',
      textMode: 'all', bigEmotes: false,
      text: textDefaults({ font: 'consolas', color: '#dae7d5', weight: 400, line: 140 }),
      colors: {
        twitch: '#a6b995', youtube: '#cb9d86', vk: '#98b6bc', kick: '#a1bca0', goodgame: '#a1b0be',
        donationalerts: '#d4bb83', donatepay: '#a1bca0', donatex: '#c6a4a4', boosty: '#c8aa81', hub: '#b9c798'
      }
    }
  },
  {
    id: 'embers', label: 'Угли', note: 'Для вечерних бесед и неспешных приключений', theme: 'campfire',
    look: {
      bg: 'strip', bgColor: '#30231d', opacity: 90, radius: 4, gap: 7,
      layout: 'stacked', align: 'stretch', plat: 'dot', sep: '',
      animIn: 'fade', animOut: 'fade', animMs: 650, highlight: 'fill',
      textMode: 'split',
      name: textDefaults({ font: 'segoe', weight: 800, color: '#efc79a', letter: 1 }),
      msg: textDefaults({ font: 'segoe', color: '#f3e4d3', weight: 400, line: 155 }),
      event: textDefaults({ font: 'segoe', color: '#f3d3ab', weight: 800 }),
      colors: {
        twitch: '#c5a885', youtube: '#d69a81', vk: '#acb9b5', kick: '#b4bd98', goodgame: '#b4b4c1',
        donationalerts: '#e3b273', donatepay: '#b4bd98', donatex: '#cba39e', boosty: '#d8a279', hub: '#e3b273'
      }
    }
  },
  {
    id: 'slate', label: 'Сланец', note: 'Сдержанные карточки для соревновательных игр', theme: 'general',
    look: {
      bg: 'card', bgColor: '#202b36', opacity: 92, radius: 7, gap: 5,
      layout: 'inline', align: 'stretch', plat: 'tag', sep: ':',
      animIn: 'slide', animOut: 'slide', animMs: 180, highlight: 'bar',
      textMode: 'all', emoteScale: 140, bigEmoteScale: 250,
      text: textDefaults({ font: 'verdana', color: '#e4ebf0', line: 145 }),
      colors: {
        twitch: '#9fb7ca', youtube: '#d6a59c', vk: '#92bad8', kick: '#a8c6b0', goodgame: '#a5b4cf',
        donationalerts: '#d8bd8c', donatepay: '#a8c6b0', donatex: '#c9a7b7', boosty: '#cdaa8e', hub: '#9fb7ca'
      }
    }
  },
  {
    id: 'parcel', label: 'Открытка', note: 'Мягкие пузырьки для уютных игр и общения', theme: 'campfire',
    look: {
      bg: 'card', bgColor: '#48332f', opacity: 96, radius: 30, gap: 14,
      layout: 'stacked', align: 'right', plat: 'dot', sep: '',
      animIn: 'bounce', animOut: 'shrink', animMs: 420, highlight: 'both',
      textMode: 'all', emoteScale: 180, bigEmoteScale: 400,
      text: textDefaults({ font: 'comic', color: '#fff0df', weight: 600, line: 150 }),
      colors: {
        twitch: '#d7bca8', youtube: '#e8b7ab', vk: '#b6ccd0', kick: '#c1cba7', goodgame: '#c1c5d3',
        donationalerts: '#edcd9e', donatepay: '#c1cba7', donatex: '#dfb9c0', boosty: '#e6bb9d', hub: '#edcd9e'
      }
    }
  },
  {
    id: 'ticker', label: 'Телетайп', note: 'Плотная лента для активного многолюдного чата', theme: 'general',
    look: {
      bg: 'strip', bgColor: '#262626', opacity: 98, radius: 0, gap: 0,
      layout: 'inline', align: 'left', plat: 'tag', sep: ' —',
      animIn: 'slide', animOut: 'fade', animMs: 140, highlight: 'none',
      textMode: 'split', bigEmotes: false, emoteScale: 120,
      name: textDefaults({ font: 'tahoma', color: '#d7c59a', weight: 800 }),
      msg: textDefaults({ font: 'tahoma', color: '#f0efeb', weight: 400, line: 125 }),
      event: textDefaults({ font: 'tahoma', color: '#eddbb3', weight: 800, upper: true, letter: 1 }),
      colors: {
        twitch: '#c8c3b9', youtube: '#d5b0a7', vk: '#b0bdc8', kick: '#bac5b0', goodgame: '#bcbfca',
        donationalerts: '#d9c397', donatepay: '#bac5b0', donatex: '#cab4bc', boosty: '#d0b69c', hub: '#d9c397'
      }
    }
  }
]

/** Новый вид: значения по умолчанию + стиль, поведение (фильтры, площадки, события, роли) — от текущего. */
export function applyPreset(cur: ChatLook, p: ChatPreset): ChatLook {
  return { ...lookDefaults(), ...p.look, filter: cur.filter, platforms: cur.platforms, events: cur.events, roles: cur.roles }
}

// textDefaults экспортируется для удобства стилей: textDefaults({ font: 'unbounded', weight: 800 }).
export { textDefaults }

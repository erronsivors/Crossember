// Цветовые схемы интерфейса Crossember. CSS — в themes.css (блоки :root[data-palette="<id>"] и :root[data-look="campfire"]).
export interface Palette {
  id: string
  name: string
  /** Три цвета для образца на кнопке выбора: фон, карточка, акцент. */
  swatch: [string, string, string]
}

export const PALETTES: Palette[] = [
  { id: 'classic', name: 'Классическая', swatch: ['#0f0b0a', '#1a1311', '#ffb27a'] },
  { id: 'graphite', name: 'Графит', swatch: ['#101113', '#191b1e', '#d6b793'] },
  { id: 'midnight', name: 'Глубокая ночь', swatch: ['#090f1b', '#111b2b', '#abc5ed'] },
  { id: 'steel', name: 'Сталь', swatch: ['#0c1419', '#141f26', '#a4cbd6'] },
  { id: 'forest', name: 'Хвоя', swatch: ['#0b1412', '#131f1b', '#bad0ae'] },
  { id: 'wine', name: 'Вино', swatch: ['#170e12', '#23171d', '#e7b3a8'] }
]

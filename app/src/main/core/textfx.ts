// Эффекты текста по буквам для текстового слоя алерта (рисует overlays/alertkit.js).
// Модуль без node-импортов: его используют и ядро, и редактор.
export const TEXT_FX = ['none', 'type', 'drop', 'rise', 'zoom', 'flip', 'scatter', 'flicker', 'wave', 'glitch'] as const
export type TextFx = (typeof TEXT_FX)[number]
export const TEXT_FX_LABEL: Record<TextFx, string> = {
  none: 'Нет', type: 'Печатная машинка', drop: 'Буквы падают', rise: 'Буквы всплывают', zoom: 'Буквы вырастают', flip: 'Табло (переворот)',
  scatter: 'Сборка из разлёта', flicker: 'Неоновое мерцание', wave: 'Волна', glitch: 'Глитч'
}

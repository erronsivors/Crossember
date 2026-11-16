// Встроенные векторные картинки для алертов (resources/overlays/art/*.svg).
// Модуль без node-импортов: его используют и ядро, и рендерер.
// У каждого набора два файла: <id>-hero.svg (персонаж или предмет, 600×600)
// и <id>-frame.svg (рамка под текст, 1200×400). Расклад «side»: персонаж слева, текст справа;
// «top»: персонаж над рамкой, текст по центру.

export type ArtLayout = 'side' | 'top'
export type ArtSound = 'chime' | 'coin' | 'fire' | 'pop' | 'fanfare'
export type ArtAnim = 'fade' | 'up' | 'down' | 'left' | 'right' | 'zoom' | 'pop' | 'spin'

export interface ArtSet {
  id: string
  name: string
  group: string
  desc: string
  layout: ArtLayout
  font: 'manrope' | 'unbounded' | 'mono'
  /** Цвет ника и сообщения. */
  color: string
  /** Цвет суммы. */
  accent: string
  sound: ArtSound
  heroIn: ArtAnim
}

const s = (id: string, name: string, group: string, desc: string, layout: ArtLayout, font: ArtSet['font'], color: string, accent: string, sound: ArtSound, heroIn: ArtAnim): ArtSet =>
  ({ id, name, group, desc, layout, font, color, accent, sound, heroIn })

const C = 'Уютные'
const G = 'Игровые'
const F = 'Фэнтези'
const S = 'Космос'
const E = 'Еда'
const H = 'Праздники'
const T = 'Стили'
const M = 'Музыка'

export const ART_SETS: ArtSet[] = [
  s('cat-cocoa', 'Котик с какао', C, 'Пушистый кот греет лапки о кружку, над какао идёт пар.', 'side', 'manrope', '#4a2f22', '#c4622d', 'chime', 'pop'),
  s('fox-scarf', 'Лиса в шарфе', C, 'Рыжая лиса в полосатом шарфе машет хвостом.', 'side', 'manrope', '#3b2416', '#e0621f', 'chime', 'left'),
  s('raccoon-coin', 'Енот-воришка', C, 'Енот в маске прижимает к себе золотую монету.', 'side', 'unbounded', '#ffffff', '#ffcf3f', 'coin', 'pop'),
  s('penguin-ice', 'Пингвин на льдине', C, 'Пингвин покачивается на льдине среди снежинок.', 'top', 'manrope', '#16324f', '#1f8fd6', 'chime', 'up'),
  s('capybara-onsen', 'Капибара в онсэне', C, 'Капибара с апельсином на голове отдыхает в горячем источнике.', 'side', 'manrope', '#3d2c1e', '#e8892a', 'pop', 'up'),
  s('owl-book', 'Совёнок с книгой', C, 'Совёнок в очках читает толстую книгу при свече.', 'side', 'manrope', '#2b2140', '#e3a33b', 'chime', 'fade'),
  s('hamster-seed', 'Хомяк с семечкой', C, 'Щекастый хомяк держит семечку размером с монету.', 'top', 'unbounded', '#4a2a12', '#d9821e', 'coin', 'pop'),
  s('corgi-mail', 'Корги-почтальон', C, 'Корги в кепке почтальона приносит письмо.', 'side', 'manrope', '#2f2a26', '#d8562a', 'pop', 'right'),
  s('frog-leaf', 'Лягушка под листом', C, 'Лягушка прячется под листом-зонтиком от дождика.', 'side', 'manrope', '#1f3b1c', '#4caf3b', 'pop', 'up'),
  s('bunny-cup', 'Кролик в чашке', C, 'Маленький кролик сидит в чайной чашке с блюдцем.', 'top', 'manrope', '#4a2b3a', '#e2668f', 'chime', 'pop'),

  s('pixel-chest', 'Пиксельный сундук', G, 'Сундук в стиле 8-бит открывается и сияет золотом.', 'side', 'mono', '#ffffff', '#ffd23f', 'coin', 'pop'),
  s('arcade-cabinet', 'Игровой автомат', G, 'Ретро-автомат с мигающим экраном и джойстиком.', 'side', 'mono', '#ffffff', '#ff3fa4', 'coin', 'up'),
  s('achievement', 'Достижение получено', G, 'Кубок с лавровым венком, как в плашке достижения.', 'side', 'unbounded', '#ffffff', '#ffc531', 'fanfare', 'zoom'),
  s('rpg-scroll', 'Свиток RPG', G, 'Пергаментный свиток с сургучной печатью.', 'top', 'manrope', '#3a2412', '#9b2b1e', 'chime', 'down'),
  s('potion', 'Зелье в колбе', G, 'Бурлящее зелье в круглой колбе с пузырями.', 'side', 'unbounded', '#ffffff', '#7dff6a', 'pop', 'pop'),
  s('sword-stone', 'Меч в камне', G, 'Легендарный меч в камне под лучом света.', 'side', 'unbounded', '#ffffff', '#ffd76a', 'fanfare', 'down'),
  s('d20', 'Кубик D20', G, 'Двадцатигранник выпадает на критический успех.', 'side', 'unbounded', '#ffffff', '#ff4d5e', 'pop', 'spin'),
  s('lootbox', 'Лутбокс', G, 'Ящик с добычей открывается, из него бьют лучи.', 'top', 'unbounded', '#ffffff', '#b06bff', 'fanfare', 'zoom'),
  s('level-up', 'Новый уровень', G, 'Стрелка вверх и звёзды: уровень повышен.', 'side', 'mono', '#ffffff', '#3ff2ff', 'fanfare', 'up'),
  s('slime-boss', 'Слизень-босс', G, 'Пузатый слизень с короной подпрыгивает на месте.', 'side', 'unbounded', '#ffffff', '#6dff8e', 'pop', 'pop'),

  s('spellbook', 'Книга заклинаний', F, 'Раскрытая книга с парящими светящимися рунами.', 'side', 'manrope', '#ffffff', '#7fd8ff', 'chime', 'fade'),
  s('dragon-gold', 'Дракончик на золоте', F, 'Маленький дракон спит на горе монет.', 'side', 'unbounded', '#ffffff', '#ffc93c', 'coin', 'up'),
  s('star-portal', 'Звёздный портал', F, 'Кольцо портала закручивает звёзды внутрь.', 'top', 'unbounded', '#ffffff', '#c38bff', 'chime', 'spin'),
  s('crystal-ball', 'Хрустальный шар', F, 'Шар гадалки с туманом и искрами внутри.', 'side', 'manrope', '#ffffff', '#ff9ef0', 'chime', 'zoom'),
  s('witch-cauldron', 'Ведьмин котёл', F, 'Котёл с зелёным варевом и шляпа ведьмы рядом.', 'side', 'unbounded', '#ffffff', '#a6ff4d', 'pop', 'up'),
  s('fairy-mushroom', 'Гриб-домик феи', F, 'Красный гриб с окошком и светлячками.', 'side', 'manrope', '#2d2414', '#e2452f', 'chime', 'up'),
  s('phoenix', 'Феникс', F, 'Огненная птица расправляет крылья.', 'top', 'unbounded', '#ffffff', '#ffb02e', 'fire', 'zoom'),

  s('rocket', 'Ракета на старте', S, 'Ракета взлетает в клубах дыма.', 'side', 'unbounded', '#ffffff', '#ff6a3d', 'fanfare', 'up'),
  s('ufo', 'НЛО с лучом', S, 'Летающая тарелка утягивает лучом монетку.', 'top', 'mono', '#ffffff', '#7dff9b', 'pop', 'down'),
  s('astronaut', 'Астронавт', S, 'Космонавт на страховочном тросе машет рукой.', 'side', 'manrope', '#ffffff', '#6ec8ff', 'chime', 'left'),
  s('robot', 'Робот-помощник', S, 'Дружелюбный робот с экраном-лицом и антенной.', 'side', 'mono', '#ffffff', '#3ef0c8', 'pop', 'pop'),
  s('ringed-planet', 'Планета с кольцами', S, 'Планета с кольцами и спутником на орбите.', 'side', 'unbounded', '#ffffff', '#ffb36b', 'chime', 'spin'),
  s('cyber-city', 'Кибергород', S, 'Неоновые небоскрёбы ночного города.', 'top', 'mono', '#ffffff', '#ff2fd0', 'pop', 'up'),
  s('satellite', 'Спутник', S, 'Спутник с солнечными панелями ловит сигнал.', 'side', 'mono', '#ffffff', '#5fd4ff', 'chime', 'right'),

  s('pizza', 'Пицца', E, 'Кусок пиццы с тянущимся сыром.', 'side', 'unbounded', '#3a1a0e', '#d8371f', 'pop', 'pop'),
  s('ramen', 'Рамен', E, 'Миска рамена с яйцом и палочками, идёт пар.', 'side', 'manrope', '#3a1c12', '#e2462c', 'pop', 'up'),
  s('donut', 'Пончик', E, 'Пончик с розовой глазурью и посыпкой.', 'side', 'unbounded', '#4a2033', '#ff5fa2', 'pop', 'spin'),
  s('burger', 'Бургер-башня', E, 'Высокий бургер с котлетами и сыром.', 'top', 'unbounded', '#3d220e', '#f2a516', 'pop', 'down'),
  s('ice-cream', 'Мороженое', E, 'Рожок с тремя шариками и вишенкой.', 'side', 'manrope', '#3a2440', '#ff7fb6', 'chime', 'up'),

  s('xmas-gift', 'Новогодний подарок', H, 'Ёлка с гирляндой и подарок с бантом.', 'side', 'unbounded', '#ffffff', '#ffd54a', 'chime', 'pop'),
  s('snowman', 'Снеговик', H, 'Снеговик в шарфе и ведре под снегопадом.', 'side', 'manrope', '#14304d', '#e23b3b', 'chime', 'up'),
  s('pumpkin', 'Тыква Хэллоуина', H, 'Светящаяся тыква с летучими мышами.', 'side', 'unbounded', '#ffffff', '#ff8a1f', 'fire', 'zoom'),
  s('love-letter', 'Валентинка', H, 'Конверт с сердцем, вокруг летают сердечки.', 'top', 'manrope', '#5a1630', '#e8315f', 'chime', 'pop'),
  s('sakura', 'Сакура', H, 'Ветка цветущей сакуры, падают лепестки.', 'side', 'manrope', '#4a2034', '#e2558a', 'chime', 'fade'),
  s('beach-melon', 'Пляж и арбуз', H, 'Долька арбуза, солнце и пляжный зонт.', 'side', 'unbounded', '#1d3a44', '#ff5a5f', 'pop', 'up'),
  s('autumn-leaves', 'Осенний зонт', H, 'Зонтик под дождём из кленовых листьев.', 'side', 'manrope', '#3b2412', '#d9631c', 'chime', 'down'),
  s('birthday-cake', 'Торт со свечами', H, 'Праздничный торт со свечами и конфетти.', 'top', 'unbounded', '#4a2238', '#ff6fa8', 'fanfare', 'pop'),

  s('comic-bam', 'Комикс «БАХ!»', T, 'Взрыв из комикса с полутоновыми точками.', 'side', 'unbounded', '#1a1a1a', '#e8262b', 'pop', 'zoom'),
  s('graffiti', 'Граффити', T, 'Баллончик краски и потёки на кирпичной стене.', 'side', 'unbounded', '#ffffff', '#3fff8a', 'pop', 'right'),
  s('newspaper', 'Газета', T, 'Свежий выпуск газеты со штампом «Срочно».', 'top', 'manrope', '#1e1e1e', '#b3261e', 'pop', 'spin'),
  s('wanted', 'Разыскивается', T, 'Плакат с Дикого Запада, шериф и звезда.', 'side', 'unbounded', '#3a2010', '#8c2a12', 'coin', 'down'),
  s('noir', 'Нуар', T, 'Шляпа детектива, лупа и дым сигары в свете лампы.', 'side', 'mono', '#f2f2f2', '#e8c05a', 'chime', 'fade'),
  s('great-wave', 'Большая волна', T, 'Волна в духе японской гравюры и красное солнце.', 'side', 'manrope', '#1b2a44', '#c8352b', 'chime', 'left'),
  s('synthwave', 'Синтвейв', T, 'Закатное солнце в полоску и сетка горизонта.', 'top', 'unbounded', '#ffffff', '#ff4fd8', 'fanfare', 'up'),

  s('vinyl', 'Пластинка', M, 'Виниловая пластинка крутится на проигрывателе.', 'side', 'unbounded', '#ffffff', '#ff5a7a', 'chime', 'spin'),
  s('cassette', 'Кассета', M, 'Аудиокассета с вытянутой плёнкой.', 'side', 'mono', '#2a2a2a', '#ff6a2a', 'pop', 'left'),
  s('guitar', 'Гитара', M, 'Электрогитара с искрами и молнией.', 'side', 'unbounded', '#ffffff', '#ffcc33', 'fanfare', 'zoom'),
  s('boombox', 'Бумбокс', M, 'Магнитофон с колонками и нотами.', 'top', 'mono', '#ffffff', '#ffd23a', 'pop', 'up'),
  s('on-air', 'В эфире', M, 'Неоновая табличка ON AIR и микрофон.', 'side', 'unbounded', '#ffffff', '#ff3b3b', 'chime', 'fade')
]

export const ART_GROUPS = [C, G, F, S, E, H, T, M]

/** Все id картинок: <набор>-hero и <набор>-frame. */
export const ART_FILES: ReadonlySet<string> = new Set(ART_SETS.flatMap((a) => [`${a.id}-hero`, `${a.id}-frame`]))

/** Id слоя для встроенной картинки: «b:<файл>». */
export const artMedia = (file: string): string => `b:${file}`

/** Путь на сервере оверлеев для встроенной картинки или '' если id чужой. */
export function artPath(media: string): string {
  if (!media.startsWith('b:')) return ''
  const f = media.slice(2)
  return ART_FILES.has(f) ? `/b/${f}.svg` : ''
}

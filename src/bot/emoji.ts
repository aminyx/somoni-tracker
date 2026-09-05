/**
 * Премиум-эмодзи Telegram: один каталог на весь бот.
 *
 * Bot API разрешает их, если Telegram Premium есть у ВЛАДЕЛЬЦА бота,
 * а не у получателя. Внутри тега всегда стоит обычная эмодзи — её видят
 * без Premium, поэтому хуже никому не становится.
 *
 * Идентификаторы взяты из набора RestrictedEmoji (997 штук) и сверены
 * с ним построчно: см. `assets/premium-emoji.txt` и tests/emoji.test.ts.
 * Выдуманный идентификатор не даёт ошибки — он рисуется пустым квадратом
 * уже на экране у человека, поэтому проверка машинная, а не на глаз.
 *
 * Здесь же аварийный выключатель. Если Premium у владельца кончится,
 * Telegram начнёт отклонять сообщения целиком, а не убирать из них
 * эмодзи: человек не получит ни карточки, ни отчёта, ни клавиатуры.
 * Поэтому первая же такая ошибка гасит премиум-эмодзи насовсем, а
 * сообщение уходит повторно обычным (см. `stripPremium`).
 */

/** Идентификатор и его обычная пара. Пара обязательна: её видят без Premium. */
interface Glyph {
  id: string
  fallback: string
}

function g(id: string, fallback: string): Glyph {
  return { id, fallback }
}

/**
 * Кнопки. Иконка ставится полем `icon_custom_emoji_id` и рисуется ПЕРЕД
 * текстом — подпись остаётся чистым текстом, поэтому обработчики
 * `bot.hears` и сверки по подписи продолжают работать.
 */
export const BUTTON_ICON = {
  // Периоды: три разных по виду знака. Одинаковые превратили бы ряд
  // в три неразличимые кнопки, а это ровно та панель, которую видит
  // человек первой.
  today: g('5469947168523558652', '☀️'),
  week: g('5431897022456145283', '📆'),
  month: g('5188608638628929611', '🌕'),
  panel: g('5431577498364158238', '📊'),
  last: g('5433811242135331842', '📥'),
  help: g('5334882760735598374', '📝'),

  openPanel: g('5375129357373165375', '🔗'),
  category: g('5431736674147114227', '🗂'),
  delete: g('5465665476971471368', '❌'),
  restore: g('5264727218734524899', '🔄'),
  back: g('5469735272017043817', '👈'),
  changeTimezone: g('5413704112220949842', '⏰'),
  changeCurrency: g('5471899089425667918', '💱'),
  changeLanguage: g('5465300082628763143', '💬'),
  skip: g('5471978009449731768', '👉'),
  coin: g('5379600444098093058', '🪙'),
} as const

/** Знаки внутри текста сообщений. Работают только при parse_mode: 'HTML'. */
export const MARK = {
  saved: g('5427009714745517609', '✅'),
  report: g('5431577498364158238', '📊'),
  up: g('5373001317042101552', '📈'),
  down: g('5361748661640372834', '📉'),
  money: g('5375296873982604963', '💰'),
  spent: g('5472030678633684592', '💸'),
  globe: g('5399898266265475100', '🌍'),
  lang: g('5370765563226236970', '🗣'),
  hello: g('5472055112702629499', '👋'),
  done: g('5436040291507247633', '🎉'),
  warn: g('5467928559664242360', '❗️'),
  limit: g('5350460637182993292', '🎯'),
  bell: g('5242628160297641831', '🔔'),
  wait: g('5451732530048802485', '⏳'),
  search: g('5188217332748527444', '🔍'),
  edit: g('5334673106202010226', '✏️'),
  export: g('5433614747381538714', '📤'),
  hint: g('5472146462362048818', '💡'),
  question: g('5467666648263564704', '❓'),
} as const

/**
 * Категории. Обычная пара обязана совпадать с `emoji` в src/lib/categories.ts:
 * иначе получатель с Premium и получатель без него видят разные значки
 * в одном и том же месте. Это проверяется тестом.
 */
export const CATEGORY_ICON: Record<string, Glyph> = {
  groceries: g('5431499171045581032', '🛒'),
  eating_out: g('5359678839591018693', '🍽'),
  transport: g('5445015510435502457', '🚕'),
  housing: g('5465226866321268133', '🏠'),
  connectivity: g('5407025283456835913', '📱'),
  health: g('5433635625217563352', '💊'),
  clothing: g('5373052667671093676', '🛍'),
  household: g('5188365693803830912', '🧽'),
  education: g('5375163339154399459', '🎓'),
  entertainment: g('5375464961822695044', '🎬'),
  gifts_events: g('5199749070830197566', '🎁'),
  finance: g('5264895611517300926', '🏦'),
  other: g('5433653135799228968', '📁'),
}

export type ButtonIconKey = keyof typeof BUTTON_ICON
export type MarkKey = keyof typeof MARK

// ---------------------------------------------------------------------------

let enabled = true

/** Выключает премиум-эмодзи до перезапуска. Обратно не включаем. */
export function disablePremium(reason: string): void {
  if (!enabled) return
  enabled = false
  console.warn(`[бот] премиум-эмодзи выключены: ${reason}`)
}

export function premiumEnabled(): boolean {
  return enabled
}

/** Только для тестов: вернуть исходное состояние. */
export function resetPremium(): void {
  enabled = true
}

/** Знак в тексте: премиум-тег либо обычная эмодзи. */
export function mark(key: MarkKey): string {
  const glyph = MARK[key]
  return enabled ? tag(glyph.id, glyph.fallback) : glyph.fallback
}

/** Эмодзи категории для текста сообщения. */
export function categoryMark(slug: string, fallback: string): string {
  const glyph = CATEGORY_ICON[slug]
  if (!glyph || !enabled) return fallback
  return tag(glyph.id, fallback)
}

/** Идентификатор иконки кнопки. undefined — значит иконку не ставим. */
export function buttonIcon(key: ButtonIconKey): string | undefined {
  return enabled ? BUTTON_ICON[key].id : undefined
}

/** Идентификатор иконки категории — для кнопок выбора категории. */
export function categoryIcon(slug: string): string | undefined {
  return enabled ? CATEGORY_ICON[slug]?.id : undefined
}

/**
 * Тег премиум-эмодзи. Формат зафиксирован: одинарный пробел, двойные
 * кавычки, ничего лишнего между тегами — на него смотрит тест.
 */
function tag(id: string, fallback: string): string {
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`
}

// ---------------------------------------------------------------------------

const TAG_RE = /<tg-emoji emoji-id="\d+">([^<]*)<\/tg-emoji>/g

/** Превращает премиум-теги обратно в обычные эмодзи. */
export function stripTags(text: string): string {
  return text.replace(TAG_RE, '$1')
}

/**
 * Готовит уже собранный запрос к повторной отправке без премиум-эмодзи.
 *
 * Чистая функция: принимает тело запроса к Bot API и возвращает новое.
 * Так повтор не зависит от того, где именно собиралось сообщение, —
 * а собирается оно в двух десятках мест.
 */
export function stripPremium(payload: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload }

  for (const field of ['text', 'caption', 'question', 'explanation']) {
    const value = next[field]
    if (typeof value === 'string') next[field] = stripTags(value)
  }

  const markup = next.reply_markup
  if (markup && typeof markup === 'object') {
    next.reply_markup = stripMarkup(markup as Record<string, unknown>)
  }
  return next
}

function stripMarkup(markup: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...markup }
  for (const field of ['keyboard', 'inline_keyboard']) {
    const rows = next[field]
    if (!Array.isArray(rows)) continue
    next[field] = rows.map((row) =>
      Array.isArray(row)
        ? row.map((button) => {
            if (!button || typeof button !== 'object') return button
            const { icon_custom_emoji_id: _drop, ...rest } = button as Record<string, unknown>
            return rest
          })
        : row,
    )
  }
  return next
}

/**
 * Отличает отказ из-за премиум-эмодзи от любого другого.
 *
 * Telegram отвечает по-разному в зависимости от того, что именно не
 * понравилось — тег в тексте или иконка кнопки, — поэтому смотрим на
 * набор признаков, а не на одну строку.
 */
export function isPremiumEmojiError(description: string): boolean {
  const text = description.toLowerCase()
  if (!text.includes('emoji')) return false
  return (
    text.includes('custom emoji') ||
    text.includes('custom_emoji') ||
    text.includes('premium') ||
    text.includes('emoji_invalid') ||
    text.includes('not enough rights') ||
    text.includes('unallowed')
  )
}

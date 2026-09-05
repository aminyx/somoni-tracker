/**
 * Нижняя панель бота: подписи, раскладка и иконки кнопок.
 *
 * Отдельный модуль, а не часть src/bot/index.ts, по одной причине: index.ts
 * запускает бота прямо при загрузке, и тест, который захотел бы построить
 * клавиатуру по-настоящему, вместо этого пошёл бы в Telegram. Раньше из-за
 * этого клавиатуру проверяли грепом по исходнику — проверка ломалась от
 * любого переноса строк и при этом не видела ни цвета кнопки, ни иконки.
 */
import { Keyboard } from 'grammy'
import { LOCALES, t, type Locale } from '../lib/i18n'
import { buttonIcon } from './emoji'

export const BUTTON_KEYS = ['today', 'week', 'month', 'panel', 'last', 'help'] as const
export type ButtonKey = (typeof BUTTON_KEYS)[number]

/** Подпись кнопки на языке пользователя. */
export function buttonLabel(locale: Locale, key: ButtonKey): string {
  return t(locale, `btn.${key}`)
}

/**
 * Все варианты подписи на всех языках.
 *
 * Нажатие приходит боту обычным текстом, а язык человек может сменить —
 * значит слушать надо все три подписи сразу. Иначе после смены языка
 * кнопки молча перестают работать: текст уходит в разбор траты.
 */
/**
 * Подписи, которые кнопки носили раньше.
 *
 * Нижняя панель persistent: она висит в чате до тех пор, пока бот не
 * пришлёт новую. У человека, который после обновления не получит нового
 * сообщения с клавиатурой, на экране остаются СТАРЫЕ подписи. Нажатие
 * уходит обычным текстом, и без этого списка оно не совпало бы ни с одним
 * обработчиком, провалилось в разбор траты и вернуло «не нашёл сумму»
 * вместо отчёта. Ровно так уже ломались «Последние».
 *
 * Список одноразовый: через пару обновлений старых клавиатур не останется.
 */
export const LEGACY_LABELS: Partial<Record<ButtonKey, string[]>> = {
  last: ['Последние', 'Охиринҳо'],
  help: ['Как писать', 'Тарзи навиштан', 'How to write'],
  panel: ['Dashboard'],
}

export function allButtonLabels(key: ButtonKey): string[] {
  return [...LOCALES.map((locale) => buttonLabel(locale, key)), ...(LEGACY_LABELS[key] ?? [])]
}

/**
 * Раскладка нижней панели: сверху периоды, снизу действия.
 *
 * Ряды заданы явно, а не циклом по BUTTON_KEYS: порядок кнопок — решение
 * об интерфейсе, и оно должно быть видно в одном месте, а не собираться
 * из порядка объявления ключей где-то выше.
 */
const KEYBOARD_ROWS: ButtonKey[][] = [
  ['today', 'week', 'month'],
  ['panel', 'last', 'help'],
]

export function mainKeyboard(locale: Locale) {
  const keyboard = new Keyboard()
  for (const row of KEYBOARD_ROWS) {
    for (const key of row) {
      keyboard.text(buttonLabel(locale, key))
      // Иконка ставится полем icon_custom_emoji_id и рисуется ПЕРЕД
      // текстом. Подпись при этом остаётся чистым текстом — иначе
      // сломались бы и bot.hears, и сверка кнопки по подписи.
      const icon = buttonIcon(key)
      if (icon) keyboard.icon(icon)
      // Цвет кнопок появился в Bot API 10.3 (24 августа 2026). Синим
      // выделена «Панель» — главное действие после ввода траты; остальные
      // обычные, иначе выделенным оказывается всё и не выделено ничего.
      if (key === 'panel') keyboard.primary()
    }
    keyboard.row()
  }
  return keyboard.resized().persistent().placeholder(t(locale, 'placeholder.input'))
}

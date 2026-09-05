/**
 * Тексты и клавиатуры бота.
 *
 * Правило первое: цифры в боте и цифры в панели считаются одним и тем же
 * кодом (src/lib/stats.ts). Если бот и панель разойдутся хоть на сомони,
 * доверия к продукту не останется.
 *
 * Правило второе: ни одной строки для человека прямо здесь — всё через
 * словарь из src/lib/i18n.ts. Иначе таджикский появлялся бы кусками:
 * часть переведена, часть нет, и это заметнее, чем полное отсутствие языка.
 */
import { InlineKeyboard } from 'grammy'
import { CATEGORIES, categoryBySlug, categoryName } from '../lib/categories'
import type { Expense } from '../lib/db/schema'
import type { LimitWarning } from '../lib/expenses'
import { MONTHS_GENITIVE, MONTHS_NOMINATIVE, t, tPlural, type Locale } from '../lib/i18n'
import { formatMoney } from '../lib/money'
import type { PeriodSummary } from '../lib/stats'
import { dayKey, partsInZone, type Period } from '../lib/time'

/**
 * Премиум-эмодзи.
 *
 * Bot API разрешает их в личных чатах, если Telegram Premium есть
 * у ВЛАДЕЛЬЦА бота, а не у получателя. Проверено живым запросом.
 * Внутри тега всегда стоит обычная эмодзи — её видят без Premium,
 * поэтому хуже никому не становится.
 *
 * Идентификаторы получены через getStickerSet набора RestrictedEmoji,
 * а не подобраны наугад: несуществующий отрисовался бы пустым квадратом.
 */
const PREMIUM_CHECK = '5427009714745517609'

/**
 * Премиум-эмодзи категорий. Для одежды подходящей в наборе не нашлось —
 * она остаётся обычной. Подставлять туда чужой символ ради единообразия
 * не стоит: рядом это заметно и читается как ошибка.
 */
const PREMIUM_CATEGORY: Record<string, string> = {
  groceries: '5431499171045581032',
  eating_out: '5359678839591018693',
  transport: '5445015510435502457',
  housing: '5465226866321268133',
  connectivity: '5407025283456835913',
  health: '5433635625217563352',
  household: '5188365693803830912',
  education: '5375163339154399459',
  entertainment: '5375464961822695044',
  gifts_events: '5199749070830197566',
  finance: '5264895611517300926',
  other: '5433653135799228968',
}

function tgEmoji(id: string, fallback: string): string {
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`
}

/** Эмодзи категории: премиум там, где нашлась, иначе обычная. */
function categoryEmoji(slug: string, fallback: string): string {
  const id = PREMIUM_CATEGORY[slug]
  return id ? tgEmoji(id, fallback) : fallback
}

/** Полоса доли: та же картина, что на графике в панели, только текстом. */
export function shareBar(percent: number, width = 10): string {
  const safe = Number.isFinite(percent) ? percent : 0
  const filled = Math.max(0, Math.min(width, Math.round((safe / 100) * width)))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

/**
 * Проставляет цвет кнопке по её подписи.
 * Поле style появилось в Bot API 10.3 (24 августа 2026).
 */
export function applyStyle(
  keyboard: InlineKeyboard,
  label: string,
  style: 'danger' | 'success' | 'primary',
): void {
  for (const row of keyboard.inline_keyboard) {
    for (const button of row) {
      if (button.text === label) {
        ;(button as { style?: string }).style = style
      }
    }
  }
}

/** Экранирование под parse_mode: HTML. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** «сегодня 14:05», «вчера 09:30», «2 сентября, 18:40». */
export function humanTime(
  instant: number,
  timezone: string,
  locale: Locale = 'ru',
  now = Date.now(),
): string {
  const p = partsInZone(instant, timezone)
  const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
  const key = dayKey(instant, timezone)

  if (key === dayKey(now, timezone)) return t(locale, 'time.today', { time })
  if (key === dayKey(now - 86_400_000, timezone)) return t(locale, 'time.yesterday', { time })
  return t(locale, 'time.date', {
    day: p.day,
    month: MONTHS_GENITIVE[locale][p.month - 1]!,
    time,
  })
}

/** «1–3 сентября», «Сентябрь 2026» — подпись периода датами, а не словом. */
export function periodLabel(
  period: Period,
  summary: PeriodSummary,
  timezone: string,
  locale: Locale = 'ru',
): string {
  const from = partsInZone(summary.range.start, timezone)
  const to = partsInZone(summary.range.end - 1000, timezone)
  const gen = MONTHS_GENITIVE[locale]

  if (period === 'day') return `${from.day} ${gen[from.month - 1]}`
  if (period === 'month') return `${MONTHS_NOMINATIVE[locale][from.month - 1]} ${from.year}`
  if (from.month === to.month) return `${from.day}–${to.day} ${gen[from.month - 1]}`
  return `${from.day} ${gen[from.month - 1]} — ${to.day} ${gen[to.month - 1]}`
}

/** Склонение по словарю: формы лежат в ключах plural.* */
export function plural(locale: Locale, key: string, count: number): string {
  return tPlural(locale, key, count)
}

/** Карточка сохранённой траты. */
export function expenseCard(
  expense: Expense,
  timezone: string,
  todayTotalMinor: number,
  todayCount: number,
  baseCurrency: string,
  locale: Locale = 'ru',
  note?: string,
): string {
  const category = categoryBySlug(expense.category)
  const name = categoryName(expense.category, locale)
  const amount = formatMoney(expense.amountMinor, expense.currency)
  const title = expense.description ? esc(expense.description) : t(locale, 'card.noDescription')

  const lines = [
    `${tgEmoji(PREMIUM_CHECK, '✅')} <b>${title}</b> · ${amount}`,
    `<blockquote>${categoryEmoji(expense.category, category.emoji)} ${name}`,
    `${humanTime(expense.spentAt, timezone, locale)}</blockquote>`,
  ]

  // Трата в другой валюте: показываем и пересчёт, иначе итог месяца
  // выглядит «неправильным».
  if (expense.currency !== baseCurrency) {
    lines.push(
      t(locale, 'card.converted', {
        amount: formatMoney(expense.baseMinor, baseCurrency),
        rate: expense.rate.toFixed(4),
      }),
    )
  }

  lines.push('')
  lines.push(
    t(locale, 'card.today', {
      total: formatMoney(todayTotalMinor, baseCurrency),
      count: todayCount,
      plural: plural(locale, 'plural.expense', todayCount),
    }),
  )

  if (note) lines.push('', `<i>${esc(note)}</i>`)
  return lines.join('\n')
}

/** Та же карточка после удаления — сообщение не удаляем, а переписываем. */
export function deletedCard(expense: Expense, locale: Locale = 'ru'): string {
  const amount = formatMoney(expense.amountMinor, expense.currency)
  const title = expense.description ? esc(expense.description) : t(locale, 'card.noDescription')
  return `🗑 <s>${title} — ${amount}</s>\n${t(locale, 'card.deleted')}`
}

/** Кнопки под карточкой траты. */
export function expenseKeyboard(
  expense: Expense,
  suggestions: string[] = [],
  locale: Locale = 'ru',
): InlineKeyboard {
  const keyboard = new InlineKeyboard()

  // Спорная категория: две кнопки в одно касание, без захода в меню.
  const chips = suggestions.filter((slug) => slug !== expense.category).slice(0, 2)
  if (chips.length > 0) {
    for (const slug of chips) {
      keyboard.text(
        `${categoryBySlug(slug).emoji} ${categoryName(slug, locale)}`,
        `cat:${expense.id}:${slug}`,
      )
    }
    keyboard.row()
  }

  const deleteLabel = t(locale, 'btn.delete')
  keyboard
    .text(t(locale, 'btn.category'), `catmenu:${expense.id}:0`)
    .text(deleteLabel, `del:${expense.id}`)
  // Удаление красным: единственное необратимое действие на карточке.
  applyStyle(keyboard, deleteLabel, 'danger')
  return keyboard
}

/** Меню выбора категории, две колонки, с постраничностью. */
export function categoryKeyboard(expenseId: string, page = 0, locale: Locale = 'ru'): InlineKeyboard {
  const perPage = 8
  const pages = Math.ceil(CATEGORIES.length / perPage)
  const slice = CATEGORIES.slice(page * perPage, page * perPage + perPage)

  const keyboard = new InlineKeyboard()
  slice.forEach((category, index) => {
    keyboard.text(
      `${category.emoji} ${categoryName(category.slug, locale)}`,
      `cat:${expenseId}:${category.slug}`,
    )
    if (index % 2 === 1) keyboard.row()
  })
  if (slice.length % 2 === 1) keyboard.row()

  if (pages > 1) {
    const prev = (page - 1 + pages) % pages
    const next = (page + 1) % pages
    keyboard
      .text('‹', `catmenu:${expenseId}:${prev}`)
      .text(`${page + 1}/${pages}`, 'noop')
      .text('›', `catmenu:${expenseId}:${next}`)
      .row()
  }
  keyboard.text(t(locale, 'btn.back'), `card:${expenseId}`)
  return keyboard
}

/** Отчёт за период — то же, что покажет панель. */
export function report(
  summary: PeriodSummary,
  timezone: string,
  panelUrl: string | null,
  locale: Locale = 'ru',
  example = 'кофе 350',
): string {
  const label = periodLabel(summary.period, summary, timezone, locale)
  const total = formatMoney(summary.totalMinor, summary.currency)

  if (summary.count === 0) {
    return [
      `<b>${label}</b>`,
      '',
      t(locale, 'report.empty'),
      t(locale, 'report.emptyHint', { example }),
    ].join('\n')
  }

  // Крупная сумма отдельной строкой: она здесь главная, а не подпись к ней.
  const lines = [`<b>${label}</b>`, '', `<b>${total}</b>`]

  // Сравниваем с тем же числом прошедших дней прошлого периода и только
  // если там были траты: «+100 %» от нуля — не факт, а артефакт.
  const previous = summary.previousComparableMinor
  if (previous > 0) {
    const rounded = Math.round(((summary.totalMinor - previous) / previous) * 100)
    const days = `${summary.elapsedDays} ${plural(locale, 'plural.day', summary.elapsedDays)}`
    const tail = t(locale, 'report.tail', {
      days,
      amount: formatMoney(previous, summary.currency),
    })
    lines.push(
      Math.abs(rounded) < 3
        ? t(locale, 'report.same', { tail })
        : t(locale, 'report.delta', {
            arrow: rounded > 0 ? '↑' : '↓',
            percent: Math.abs(rounded),
            tail,
          }),
    )
  }

  if (summary.byCategory.length > 0) {
    // Категории — в раскрывающейся цитате: отчёт не занимает пол-экрана,
    // но всё остаётся на месте по одному нажатию.
    const rows: string[] = []
    for (const row of summary.byCategory.slice(0, 10)) {
      const category = categoryBySlug(row.category)
      const amount = formatMoney(row.totalMinor, summary.currency)
      if (rows.length > 0) rows.push('')
      rows.push(
        `${categoryEmoji(row.category, category.emoji)} ${categoryName(row.category, locale)}`,
      )
      rows.push(`<code>${shareBar(row.share)}</code> ${amount} · ${Math.round(row.share)}%`)
    }
    if (summary.byCategory.length > 10) {
      const rest = summary.byCategory.slice(10)
      const restTotal = rest.reduce((acc, r) => acc + r.totalMinor, 0)
      rows.push(
        '',
        t(locale, 'report.more', {
          count: rest.length,
          amount: formatMoney(restTotal, summary.currency),
        }),
      )
    }
    lines.push('', `<blockquote expandable>${rows.join('\n')}</blockquote>`)
  }

  const footer = [`${summary.count} ${plural(locale, 'plural.expense', summary.count)}`]
  if (summary.period === 'month' && summary.averagePerDayMinor > 0) {
    footer.push(
      t(locale, 'report.average', {
        amount: formatMoney(summary.averagePerDayMinor, summary.currency),
      }),
    )
  }
  lines.push(footer.join(' · '))

  if (panelUrl) lines.push('', t(locale, 'report.charts'))
  return lines.join('\n')
}

/** Предупреждение о лимите. */
export function limitMessage(warning: LimitWarning, locale: Locale = 'ru'): string {
  const category = categoryBySlug(warning.category)
  const name = categoryName(warning.category, locale)
  const spent = formatMoney(warning.spentMinor, warning.currency)
  const limit = formatMoney(warning.limitMinor, warning.currency)

  if (warning.level === 100) {
    return t(locale, 'limit.warn100', { emoji: category.emoji, name, spent, limit })
  }
  return t(locale, 'limit.warn80', {
    emoji: category.emoji,
    name,
    spent,
    limit,
    left: formatMoney(warning.limitMinor - warning.spentMinor, warning.currency),
  })
}

/** Справка «как писать» — собирается из словаря, живёт на трёх языках. */
export function helpText(
  locale: Locale,
  examples: { one: string; two: string; three: string },
): string {
  return [
    t(locale, 'help.title'),
    '',
    t(locale, 'help.intro'),
    `• <code>${examples.one}</code>`,
    `• <code>${examples.two}</code>`,
    `• <code>${examples.three}</code>`,
    `• <code>${t(locale, 'help.exampleCurrency')}</code>`,
    '',
    t(locale, 'help.category'),
    '',
    t(locale, 'help.commands'),
    t(locale, 'help.list'),
  ].join('\n')
}

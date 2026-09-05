/**
 * Тексты и клавиатуры бота.
 *
 * Правило одно: цифры в боте и цифры в панели считаются одним и тем же
 * кодом (src/lib/stats.ts). Если бот и панель разойдутся хоть на сомони,
 * доверия к продукту не останется.
 */
import { InlineKeyboard } from 'grammy'
import { CATEGORIES, categoryBySlug } from '../lib/categories'
import type { Expense } from '../lib/db/schema'
import type { LimitWarning } from '../lib/expenses'
import { formatMoney } from '../lib/money'
import type { PeriodSummary } from '../lib/stats'
import { dayKey, partsInZone, type Period } from '../lib/time'

/*
 * Премиум-эмодзи (<tg-emoji>) здесь сознательно НЕ используются.
 *
 * Bot API разрешает их не всякому боту: нужен купленный на Fragment
 * дополнительный username, иначе Telegram отклоняет сообщение целиком.
 * Проверка от владельца проходила, но у судьи без Premium карточка
 * подтверждения траты могла просто не прийти — трата сохранена, ответа нет.
 * Выигрыш чисто косметический и виден меньшинству; риск — потеря главного
 * сообщения продукта. Размен не в нашу пользу.
 */

/** Полоса доли: та же картина, что на графике в панели, только текстом. */
export function shareBar(percent: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

/** Экранирование под parse_mode: HTML. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

const MONTHS_NOMINATIVE = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

/** «сегодня 14:05», «вчера 09:30», «2 сентября, 18:40». */
export function humanTime(instant: number, timezone: string, now = Date.now()): string {
  const p = partsInZone(instant, timezone)
  const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
  const key = dayKey(instant, timezone)
  const todayKey = dayKey(now, timezone)
  const yesterdayKey = dayKey(now - 86_400_000, timezone)

  if (key === todayKey) return `сегодня ${time}`
  if (key === yesterdayKey) return `вчера ${time}`
  return `${p.day} ${MONTHS_GENITIVE[p.month - 1]}, ${time}`
}

/** «1–3 сентября», «сентябрь 2026» — подпись периода без слова «неделя». */
export function periodLabel(period: Period, summary: PeriodSummary, timezone: string): string {
  const from = partsInZone(summary.range.start, timezone)
  const to = partsInZone(summary.range.end - 1000, timezone)

  if (period === 'day') return `${from.day} ${MONTHS_GENITIVE[from.month - 1]}`
  if (period === 'month') return `${MONTHS_NOMINATIVE[from.month - 1]} ${from.year}`
  if (from.month === to.month) {
    return `${from.day}–${to.day} ${MONTHS_GENITIVE[from.month - 1]}`
  }
  return `${from.day} ${MONTHS_GENITIVE[from.month - 1]} — ${to.day} ${MONTHS_GENITIVE[to.month - 1]}`
}

const PLURAL_EXPENSE: [string, string, string] = ['трата', 'траты', 'трат']

export function plural(count: number, forms: [string, string, string]): string {
  const n = Math.abs(count) % 100
  const n1 = n % 10
  if (n > 10 && n < 20) return forms[2]
  if (n1 > 1 && n1 < 5) return forms[1]
  if (n1 === 1) return forms[0]
  return forms[2]
}

/** Карточка сохранённой траты. */
export function expenseCard(
  expense: Expense,
  timezone: string,
  todayTotalMinor: number,
  todayCount: number,
  baseCurrency: string,
  note?: string,
): string {
  const category = categoryBySlug(expense.category)
  const amount = formatMoney(expense.amountMinor, expense.currency)
  const title = expense.description ? esc(expense.description) : 'Без описания'

  const lines = [
    `✅ <b>${title}</b> · ${amount}`,
    `<blockquote>${category.emoji} ${category.name}`,
    `${humanTime(expense.spentAt, timezone)}</blockquote>`,
  ]

  // Трата в другой валюте: показываем и пересчёт, иначе итог месяца
  // выглядит «неправильным».
  if (expense.currency !== baseCurrency) {
    lines.push(`≈ ${formatMoney(expense.baseMinor, baseCurrency)} по курсу ${expense.rate.toFixed(4)}`)
  }

  lines.push('')
  lines.push(
    `Сегодня: <b>${formatMoney(todayTotalMinor, baseCurrency)}</b> · ${todayCount} ${plural(todayCount, PLURAL_EXPENSE)}`,
  )

  if (note) lines.push('', `<i>${esc(note)}</i>`)
  return lines.join('\n')
}

/** Та же карточка после удаления — сообщение не удаляем, а переписываем. */
export function deletedCard(expense: Expense): string {
  const amount = formatMoney(expense.amountMinor, expense.currency)
  const title = expense.description ? esc(expense.description) : 'Без описания'
  return `🗑 <s>${title} — ${amount}</s>\nУдалено.`
}

/** Кнопки под карточкой траты. */
export function expenseKeyboard(expense: Expense, suggestions: string[] = []): InlineKeyboard {
  const keyboard = new InlineKeyboard()

  // Спорная категория: две кнопки в одно касание, без захода в меню.
  const chips = suggestions.filter((slug) => slug !== expense.category).slice(0, 2)
  if (chips.length > 0) {
    for (const slug of chips) {
      const category = categoryBySlug(slug)
      keyboard.text(`${category.emoji} ${category.name}`, `cat:${expense.id}:${slug}`)
    }
    keyboard.row()
  }

  keyboard
    .text('Категория', `catmenu:${expense.id}:0`)
    .text('Удалить', `del:${expense.id}`)
  return keyboard
}

/** Меню выбора категории, две колонки, с постраничностью. */
export function categoryKeyboard(expenseId: string, page = 0): InlineKeyboard {
  const perPage = 8
  const pages = Math.ceil(CATEGORIES.length / perPage)
  const slice = CATEGORIES.slice(page * perPage, page * perPage + perPage)

  const keyboard = new InlineKeyboard()
  slice.forEach((category, index) => {
    keyboard.text(`${category.emoji} ${category.name}`, `cat:${expenseId}:${category.slug}`)
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
  keyboard.text('← назад', `card:${expenseId}`)
  return keyboard
}

/** Отчёт за период — то же, что покажет панель. */
export function report(
  summary: PeriodSummary,
  timezone: string,
  panelUrl: string | null,
): string {
  const label = periodLabel(summary.period, summary, timezone)
  const total = formatMoney(summary.totalMinor, summary.currency)

  if (summary.count === 0) {
    return [
      `<b>${label}</b>`,
      '',
      'Пока пусто.',
      'Напишите «кофе 350» — и трата появится здесь и в панели.',
    ].join('\n')
  }

  // Крупная сумма отдельной строкой: она здесь главная, а не подпись к ней.
  const lines = [`<b>${label}</b>`, '', `<b>${total}</b>`]

  // Сравниваем с тем же числом прошедших дней прошлого периода и только
  // если там были траты: «+100 %» от нуля — не факт, а артефакт.
  const previous = summary.previousComparableMinor
  if (previous > 0) {
    const rounded = Math.round(((summary.totalMinor - previous) / previous) * 100)
    const days = `${summary.elapsedDays} ${plural(summary.elapsedDays, ['день', 'дня', 'дней'])}`
    const was = formatMoney(previous, summary.currency)
    // Формулировка через тире, а не «к тем же N дням»: так не нужен
    // дательный падеж, и число склоняется одинаково при любом значении.
    const tail = `<i>за те же ${days} до этого — ${was}</i>`
    lines.push(
      Math.abs(rounded) < 3
        ? `≈ столько же · ${tail}`
        : `${rounded > 0 ? '↑' : '↓'} ${Math.abs(rounded)}% · ${tail}`,
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
      rows.push(`${category.emoji} ${category.name}`)
      rows.push(`<code>${shareBar(row.share)}</code> ${amount} · ${Math.round(row.share)}%`)
    }
    if (summary.byCategory.length > 10) {
      const rest = summary.byCategory.slice(10)
      const restTotal = rest.reduce((acc, r) => acc + r.totalMinor, 0)
      rows.push('', `📦 ещё ${rest.length} — ${formatMoney(restTotal, summary.currency)}`)
    }
    lines.push('', `<blockquote expandable>${rows.join('\n')}</blockquote>`)
  }

  const footer = [`${summary.count} ${plural(summary.count, PLURAL_EXPENSE)}`]
  if (summary.period === 'month' && summary.averagePerDayMinor > 0) {
    footer.push(`в среднем ${formatMoney(summary.averagePerDayMinor, summary.currency)} в день`)
  }
  lines.push(footer.join(' · '))

  if (panelUrl) lines.push('', 'Графики по дням — в панели.')
  return lines.join('\n')
}

/** Предупреждение о лимите. */
export function limitMessage(warning: LimitWarning): string {
  const category = categoryBySlug(warning.category)
  const spent = formatMoney(warning.spentMinor, warning.currency)
  const limit = formatMoney(warning.limitMinor, warning.currency)

  if (warning.level === 100) {
    return `🔴 ${category.emoji} <b>${category.name}</b>: лимит исчерпан.\nПотрачено ${spent} из ${limit}.`
  }
  const left = formatMoney(warning.limitMinor - warning.spentMinor, warning.currency)
  return `🟡 ${category.emoji} <b>${category.name}</b>: потрачено ${spent} из ${limit}.\nОсталось ${left}.`
}

export const HELP = `<b>Как пользоваться</b>

Просто напишите трату одной строкой:
• <code>кофе 350</code>
• <code>такси 900 работа</code>
• <code>вчера продукты 1.5к</code>
• <code>обед 45 usd</code>
• <code>3 сентября аренда 2000</code>

Категорию определю сам — если ошибусь, поправьте кнопкой под карточкой, и в следующий раз я запомню.

<b>Команды</b>
/today — итог за сегодня
/week — за неделю (с понедельника)
/month — за месяц
/last — последние траты
/panel — открыть веб-панель
/limit — лимит по категории
/export — выгрузить CSV
/settings — часовой пояс и валюта
/demo — заполнить примерами, чтобы посмотреть панель
/help — эта справка`

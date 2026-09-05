/**
 * Telegram-бот: единственный способ ввода траты.
 *
 * Работает через long polling — так не нужен публичный адрес и туннель,
 * бот поднимается и локально, и на сервере одной командой.
 *
 * ВАЖНО: Telegram допускает только ОДНОГО потребителя getUpdates на токен.
 * Если запустить бота локально с боевым токеном, бот на сервере замолчит.
 * Для разработки заведите второго бота и положите его токен
 * в TELEGRAM_BOT_TOKEN_DEV.
 */
import 'dotenv/config'
import { autoRetry } from '@grammyjs/auto-retry'
import { Bot, GrammyError, HttpError, InlineKeyboard, InputFile, Keyboard } from 'grammy'
import type { Context } from 'grammy'
import { runMigrations } from '../../scripts/migrate'
import { pruneExpired, issueLoginToken } from '../lib/auth'
import { CATEGORIES, categoryBySlug, categoryName, isCategorySlug } from '../lib/categories'
import { csvFilename, expensesToCsv } from '../lib/csv'
import { clearDemo, hasDemo, seedDemo } from '../lib/demo'
import type { User } from '../lib/db/schema'
import { env } from '../lib/env'
import {
  addExpense,
  deleteExpense,
  ensureUser,
  getExpense,
  lastExpenseInChat,
  linkExpenseMessage,
  listLimits,
  removeLimit,
  restoreExpense,
  localeOf,
  setBaseCurrency,
  setLimit,
  setLocale,
  setTimezone,
  updateExpense,
} from '../lib/expenses'
import { EXAMPLES, LOCALES, LOCALE_NAMES, isLocale, t, type Locale } from '../lib/i18n'
import { formatMoney, fromMinor, isValidCurrency, toMinor } from '../lib/money'
import { isOcrEnabled, recognizeReceipt, warmupOcr } from '../lib/ocr'
import { explainFailure, parseExpense, splitEntries } from '../lib/parser'
import { refreshRates } from '../lib/rates'
import { expensesInRange, recentExpenses, summarize, totalFor } from '../lib/stats'
import { rangeFor, safeTimeZone, zoneOffsetMs } from '../lib/time'
import {
  applyStyle,
  categoryKeyboard,
  deletedCard,
  esc,
  expenseCard,
  expenseKeyboard,
  helpText,
  humanTime,
  limitMessage,
  plural,
  report,
} from './ui'

const config = env()
// В разработке предпочитаем отдельный токен, чтобы не глушить боевого бота.
const TOKEN =
  process.env.NODE_ENV !== 'production' && process.env.TELEGRAM_BOT_TOKEN_DEV
    ? process.env.TELEGRAM_BOT_TOKEN_DEV
    : config.TELEGRAM_BOT_TOKEN

const bot = new Bot(TOKEN)
// 429 и 5xx от Telegram — не наша ошибка и не повод терять трату пользователя.
bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }))

/* ------------------------------------------------------------------ */
/*  Вспомогательное                                                    */
/* ------------------------------------------------------------------ */

/** Пользователь из апдейта; заодно освежает профиль. */
function currentUser(ctx: { from?: { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string } }): User | null {
  if (!ctx.from) return null
  return ensureUser(
    {
      id: ctx.from.id,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      username: ctx.from.username,
      language_code: ctx.from.language_code,
    },
    { timezone: config.DEFAULT_TIMEZONE, currency: config.DEFAULT_CURRENCY },
  )
}

/** Свежая одноразовая ссылка на панель. */
function panelLink(userId: number): string {
  const { token } = issueLoginToken(userId)
  return `${config.APP_URL.replace(/\/$/, '')}/enter?t=${token}`
}

/**
 * Годится ли адрес для URL-кнопки.
 *
 * Telegram отклоняет кнопки со ссылкой на localhost: «Bad Request: inline
 * keyboard button URL is invalid: Wrong HTTP URL». Причём отклоняет всё
 * сообщение целиком — при локальном запуске пользователь на /start и /panel
 * не получал вообще ничего. Поэтому при непубличном адресе ссылка уходит
 * обычным текстом: она всё равно кликабельна.
 */
function canUseUrlButton(): boolean {
  try {
    const url = new URL(config.APP_URL)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.localhost')) return false
    if (host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === '[::1]') return false
    // Telegram требует домен, а не голый адрес в локальной сети.
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false
    return host.includes('.')
  } catch {
    return false
  }
}

/** Кнопка «Открыть панель», если адрес публичный. Иначе кнопки нет. */
function panelKeyboard(userId: number): InlineKeyboard | undefined {
  if (!canUseUrlButton()) return undefined
  return new InlineKeyboard().url('Открыть панель', panelLink(userId))
}

/**
 * Готовые параметры ответа со ссылкой на панель: кнопкой либо текстом.
 * Возвращает и добавку к тексту сообщения, чтобы ссылка не потерялась.
 */
function panelReply(userId: number): { extraText: string; keyboard: InlineKeyboard | undefined } {
  const keyboard = panelKeyboard(userId)
  if (keyboard) return { extraText: '', keyboard }
  return {
    extraText: `\n\nПанель: ${panelLink(userId)}\nСсылка действует 10 минут и открывается один раз.`,
    keyboard: undefined,
  }
}

/**
 * Кнопки под полем ввода.
 *
 * Кнопка меню слева занята Mini App, а Telegram разрешает только одну —
 * поэтому список команд ушёл бы из виду. Здесь он возвращается в явном
 * виде: человеку не нужно знать ни одной команды, чтобы всё найти.
 *
 * input_field_placeholder делает главную работу: в пустом поле ввода
 * написано «кофе 350», и формат понятен без единого слова инструкции.
 */
const BUTTON_KEYS = ['today', 'week', 'month', 'panel', 'last', 'help'] as const
type ButtonKey = (typeof BUTTON_KEYS)[number]

/** Подпись кнопки на языке пользователя. */
function buttonLabel(locale: Locale, key: ButtonKey): string {
  return t(locale, `btn.${key}`)
}

/**
 * Все варианты подписи на всех языках.
 *
 * Нажатие приходит боту обычным текстом, а язык человек может сменить —
 * значит слушать надо все три подписи сразу. Иначе после смены языка
 * кнопки молча перестают работать: текст уходит в разбор траты.
 */
function allButtonLabels(key: ButtonKey): string[] {
  return LOCALES.map((locale) => buttonLabel(locale, key))
}

function mainKeyboard(locale: Locale) {
  const keyboard = new Keyboard()
    .text(buttonLabel(locale, 'today'))
    .text(buttonLabel(locale, 'week'))
    .text(buttonLabel(locale, 'month'))
    .row()
    .text(buttonLabel(locale, 'panel'))
    .text(buttonLabel(locale, 'last'))
    .text(buttonLabel(locale, 'help'))
    .resized()
    .persistent()
    .placeholder(t(locale, 'placeholder.input'))

  // Цвет кнопок появился в Bot API 10.3 (24 августа 2026). Синим выделена
  // «Панель» — главное действие после ввода траты; остальные обычные,
  // иначе выделенным оказывается всё и не выделено ничего.
  for (const row of keyboard.keyboard) {
    for (const button of row) {
      if (typeof button === 'object' && button.text === buttonLabel(locale, 'panel')) {
        ;(button as { style?: string }).style = 'primary'
      }
    }
  }
  return keyboard
}

/**
 * Города для выбора часового пояса. Список, а не ввод IANA-зоны руками:
 * «Asia/Dushanbe» знает не каждый, а свой город — каждый.
 *
 * Душанбе первым: продукт для Таджикистана. Хорог и Худжанд живут в той же
 * зоне, отдельными кнопками их не выносим.
 *
 * Заметьте: это НЕ обязательный шаг при первом запуске. Панель определяет
 * зону по браузеру сама, а мастер настройки из четырёх экранов до первой
 * траты — ровно то, чего просят не делать: «трата добавляется одним
 * сообщением».
 */
interface CityChoice {
  zone: string
  /** Название города на каждом языке: в английском интерфейсе «Москва» лишняя. */
  name: Record<Locale, string>
  /** Валюта страны — подставляется сразу после выбора города. */
  currency: string
}

const TIMEZONE_CHOICES: CityChoice[] = [
  { zone: 'Asia/Dushanbe', currency: 'TJS', name: { ru: 'Душанбе', tg: 'Душанбе', en: 'Dushanbe' } },
  { zone: 'Asia/Tashkent', currency: 'UZS', name: { ru: 'Ташкент', tg: 'Тошканд', en: 'Tashkent' } },
  { zone: 'Asia/Almaty', currency: 'KZT', name: { ru: 'Алматы', tg: 'Алмато', en: 'Almaty' } },
  { zone: 'Asia/Bishkek', currency: 'KGS', name: { ru: 'Бишкек', tg: 'Бишкек', en: 'Bishkek' } },
  { zone: 'Europe/Moscow', currency: 'RUB', name: { ru: 'Москва', tg: 'Маскав', en: 'Moscow' } },
  { zone: 'Asia/Yekaterinburg', currency: 'RUB', name: { ru: 'Екатеринбург', tg: 'Екатеринбург', en: 'Yekaterinburg' } },
  { zone: 'Asia/Novosibirsk', currency: 'RUB', name: { ru: 'Новосибирск', tg: 'Новосибирск', en: 'Novosibirsk' } },
  { zone: 'Asia/Baku', currency: 'AZN', name: { ru: 'Баку', tg: 'Боку', en: 'Baku' } },
  { zone: 'Europe/Istanbul', currency: 'TRY', name: { ru: 'Стамбул', tg: 'Истанбул', en: 'Istanbul' } },
  { zone: 'Asia/Dubai', currency: 'AED', name: { ru: 'Дубай', tg: 'Дубай', en: 'Dubai' } },
  { zone: 'Europe/Minsk', currency: 'BYN', name: { ru: 'Минск', tg: 'Минск', en: 'Minsk' } },
  { zone: 'Europe/Berlin', currency: 'EUR', name: { ru: 'Берлин', tg: 'Берлин', en: 'Berlin' } },
]

/** Название города на языке пользователя; для чужой зоны — сама зона. */
function cityName(zone: string, locale: Locale): string {
  return TIMEZONE_CHOICES.find((c) => c.zone === zone)?.name[locale] ?? zone
}

/** Валюты для быстрого выбора. Остальные — командой, их сотни. */
const CURRENCY_CHOICES: Array<[string, string]> = [
  ['🇹🇯 Сомонӣ', 'TJS'],
  ['🇺🇸 Доллар', 'USD'],
  ['🇷🇺 Рубль', 'RUB'],
  ['🇪🇺 Евро', 'EUR'],
  ['🇺🇿 Сум', 'UZS'],
  ['🇰🇿 Тенге', 'KZT'],
  ['🇰🇬 Сом', 'KGS'],
  ['🇹🇷 Лира', 'TRY'],
]

/** Текущее смещение зоны словами: «UTC+5». */
function utcOffsetLabel(zone: string): string {
  const minutes = Math.round(zoneOffsetMs(Date.now(), safeTimeZone(zone)) / 60000)
  const sign = minutes < 0 ? '−' : '+'
  const hours = Math.abs(minutes) / 60
  return `UTC${sign}${Number.isInteger(hours) ? hours : hours.toFixed(1)}`
}

function timezoneKeyboard(current: string, locale: Locale, prefix = 'tz'): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  TIMEZONE_CHOICES.forEach((city, index) => {
    const mark = city.zone === current ? '• ' : ''
    keyboard.text(
      `${mark}${city.name[locale]} (${utcOffsetLabel(city.zone)})`,
      `${prefix}:${city.zone}`,
    )
    if (index % 2 === 1) keyboard.row()
  })
  if (TIMEZONE_CHOICES.length % 2 === 1) keyboard.row()
  return keyboard
}

function languageKeyboard(current: Locale): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  for (const locale of LOCALES) {
    const mark = locale === current ? '• ' : ''
    keyboard.text(`${mark}${LOCALE_NAMES[locale]}`, `lang:${locale}`).row()
  }
  return keyboard
}

/** Шаг 1: язык. Отличается от настроек префиксом — дальше идёт выбор города. */
function wizardLanguageKeyboard(current: Locale): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  for (const locale of LOCALES) {
    const mark = locale === current ? '• ' : ''
    keyboard.text(`${mark}${LOCALE_NAMES[locale]}`, `wlang:${locale}`).row()
  }
  return keyboard
}

function currencyKeyboard(current: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  CURRENCY_CHOICES.forEach(([name, code], index) => {
    const mark = code === current ? '• ' : ''
    keyboard.text(`${mark}${name}`, `cur:${code}`)
    if (index % 2 === 1) keyboard.row()
  })
  if (CURRENCY_CHOICES.length % 2 === 1) keyboard.row()
  return keyboard
}

/** Кнопка возврата после удаления — зелёная: это спасательное действие. */
function undoKeyboard(expenseId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard().text('Вернуть', `undo:${expenseId}`)
  applyStyle(keyboard, 'Вернуть', 'success')
  return keyboard
}

/** Итог за сегодня — печатается под каждой сохранённой тратой. */
function todayTotals(user: User) {
  const range = rangeFor('day', Date.now(), user.timezone, user.weekStart)
  return totalFor(user.id, range)
}

/* ------------------------------------------------------------------ */
/*  Команды                                                            */
/* ------------------------------------------------------------------ */

bot.command('start', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return

  const L = localeOf(user)
  const examples = EXAMPLES[L]
  const name = user.firstName ? `, ${esc(user.firstName)}` : ''
  const panel = panelReply(user.id)
  await ctx.reply(
    [
      t(L, 'start.greeting', { name }),
      '',
      t(L, 'start.howto', { example1: examples.one, example2: examples.two }),
      '',
      t(L, 'start.reports'),
      t(L, 'start.panel'),
    ].join('\n') + panel.extraText,
    {
      parse_mode: 'HTML',
      reply_markup: panel.keyboard,
      link_preview_options: { is_disabled: true },
    },
  )
  // Отдельным сообщением: показать кнопки и подсказать формат ввода.
  // Reply-клавиатуру нельзя послать вместе с inline-кнопкой в одном сообщении.
  await ctx.reply(t(L, 'start.buttons'), { reply_markup: mainKeyboard(L) })

  // Мастер: язык → город → валюта. Он идёт ПОСЛЕ приветствия и ничего не
  // блокирует: трату можно написать, не пройдя ни одного шага, — сообщение
  // с кнопками просто останется в переписке. Так выполняется и просьба
  // спросить язык со страной, и главное требование конкурса: трата
  // добавляется одним сообщением, без обязательной анкеты.
  await ctx.reply(t(L, 'wizard.language'), {
    parse_mode: 'HTML',
    reply_markup: wizardLanguageKeyboard(L),
  })
})

bot.command('help', async (ctx) => {
  const user = currentUser(ctx)
  const L = user ? localeOf(user) : 'ru'
  await ctx.reply(helpText(L, EXAMPLES[L]), {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  })
})

bot.command('panel', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const panel = panelReply(user.id)
  await ctx.reply(t(localeOf(user), 'panel.once') + panel.extraText, {
    reply_markup: panel.keyboard,
    link_preview_options: { is_disabled: true },
  })
})

// Context, а не CommandContext: отчёт вызывается и командой, и кнопкой.
async function sendReport(ctx: Context, period: 'day' | 'week' | 'month') {
  const user = currentUser(ctx)
  if (!user) return
  const summary = summarize(
    { id: user.id, timezone: user.timezone, baseCurrency: user.baseCurrency, weekStart: user.weekStart },
    period,
  )
  const L = localeOf(user)
  const panel = panelReply(user.id)
  await ctx.reply(
    report(summary, user.timezone, config.APP_URL, L, EXAMPLES[L].one) + panel.extraText,
    {
      parse_mode: 'HTML',
      reply_markup: panel.keyboard,
      link_preview_options: { is_disabled: true },
    },
  )
}

bot.command(['today', 'сегодня'], (ctx) => sendReport(ctx, 'day'))
bot.command(['week', 'неделя'], (ctx) => sendReport(ctx, 'week'))
bot.command(['month', 'месяц'], (ctx) => sendReport(ctx, 'month'))

/** Общее тело для команды /last и одноимённой кнопки. */
async function sendRecent(ctx: Context) {
  const user = currentUser(ctx)
  if (!user) return
  const L = localeOf(user)
  const rows = recentExpenses(user.id, 10)
  if (rows.length === 0) {
    await ctx.reply(t(L, 'last.empty', { example: EXAMPLES[L].one }))
    return
  }

  const lines = [t(L, 'last.title'), '']
  for (const row of rows) {
    const category = categoryBySlug(row.category)
    const title = row.description ? esc(row.description) : t(L, 'last.noDescription')
    lines.push(
      `${category.emoji} ${title} — <b>${formatMoney(row.amountMinor, row.currency)}</b>`,
      `<i>${humanTime(row.spentAt, user.timezone, L)}</i> · /e_${row.id}`,
      '',
    )
  }
  lines.push(t(L, 'last.hint'))
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
}

bot.command('last', sendRecent)

/** /e_<id> — открыть карточку конкретной траты из списка. */
bot.hears(/^\/e_([0-9a-z]+)$/i, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const id = ctx.match[1]!
  const L = localeOf(user)
  const expense = getExpense(user.id, id)
  if (!expense || expense.deletedAt) {
    await ctx.reply(t(L, 'last.notFound'))
    return
  }
  const totals = todayTotals(user)
  await ctx.reply(
    expenseCard(expense, user.timezone, totals.totalMinor, totals.count, user.baseCurrency, L),
    { parse_mode: 'HTML', reply_markup: expenseKeyboard(expense, [], L) },
  )
})

/* Нажатия на кнопки. Регистрируются ДО обработчика обычного текста,
   иначе «Месяц» ушло бы в разбор траты и получило «не нашёл сумму». */
bot.hears(allButtonLabels('today'), (ctx) => sendReport(ctx, 'day'))
bot.hears(allButtonLabels('week'), (ctx) => sendReport(ctx, 'week'))
bot.hears(allButtonLabels('month'), (ctx) => sendReport(ctx, 'month'))
bot.hears(allButtonLabels('last'), sendRecent)

bot.hears(allButtonLabels('help'), async (ctx) => {
  const user = currentUser(ctx)
  const L = user ? localeOf(user) : 'ru'
  await ctx.reply(helpText(L, EXAMPLES[L]), {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: mainKeyboard(L),
  })
})

bot.hears(allButtonLabels('panel'), async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const panel = panelReply(user.id)
  await ctx.reply(t(localeOf(user), 'panel.once') + panel.extraText, {
    reply_markup: panel.keyboard,
    link_preview_options: { is_disabled: true },
  })
})

bot.command(['limit', 'limits'], async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const L = localeOf(user)
  const argument = ctx.match?.trim() ?? ''

  if (!argument) {
    const rows = listLimits(user)
    if (rows.length === 0) {
      const names = CATEGORIES.filter((c) => c.slug !== 'other')
        .map((c) => categoryName(c.slug, L).toLowerCase())
        .join(', ')
      await ctx.reply(
        [
          t(L, 'limit.title'),
          '',
          t(L, 'limit.intro'),
          '',
          t(L, 'limit.example'),
          '',
          t(L, 'limit.categories', { list: esc(names) }),
        ].join('\n'),
        { parse_mode: 'HTML' },
      )
      return
    }

    const lines = [t(L, 'limit.current'), '']
    for (const row of rows) {
      const category = categoryBySlug(row.category)
      const share = row.amountMinor > 0 ? Math.round((row.spentMinor / row.amountMinor) * 100) : 0
      const mark = share >= 100 ? '🔴' : share >= 80 ? '🟡' : '🟢'
      lines.push(
        t(L, 'limit.row', {
          mark,
          emoji: category.emoji,
          name: categoryName(row.category, L),
          spent: formatMoney(row.spentMinor, row.currency),
          limit: formatMoney(row.amountMinor, row.currency),
          percent: share,
        }),
      )
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
    return
  }

  // «/limit продукты 2000» — категория словом, сумма числом.
  const match = /^(.+?)\s+(\d+(?:[.,]\d+)?)$/.exec(argument)
  if (!match) {
    await ctx.reply(t(L, 'limit.format'), { parse_mode: 'HTML' })
    return
  }
  const name = match[1]!.trim().toLowerCase()
  const amount = Number(match[2]!.replace(',', '.'))
  // Ищем по названию на любом из языков: человек мог сменить язык,
  // а команду написать по привычке на прежнем.
  const matches = (c: (typeof CATEGORIES)[number], exact: boolean) =>
    LOCALES.some((loc) => {
      const label = categoryName(c.slug, loc).toLowerCase()
      return exact ? label === name : label.startsWith(name)
    })
  const category =
    CATEGORIES.find((c) => matches(c, true)) ??
    CATEGORIES.find((c) => matches(c, false)) ??
    (isCategorySlug(name) ? categoryBySlug(name) : undefined)

  if (!category) {
    await ctx.reply(t(L, 'limit.unknownCategory', { name: esc(name) }), { parse_mode: 'HTML' })
    return
  }

  if (amount === 0) {
    const removed = removeLimit(user.id, category.slug)
    await ctx.reply(
      removed
        ? t(L, 'limit.removed', { name: categoryName(category.slug, L) })
        : t(L, 'limit.absent'),
    )
    return
  }

  setLimit(user, category.slug, amount)
  await ctx.reply(
    t(L, 'limit.set', {
      emoji: category.emoji,
      name: categoryName(category.slug, L),
      amount: formatMoney(Math.round(amount * 100), user.baseCurrency),
    }),
  )
})

bot.command('export', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const L = localeOf(user)
  const now = Date.now()
  const range = rangeFor('month', now, user.timezone, user.weekStart)
  const rows = expensesInRange(user.id, range)

  if (rows.length === 0) {
    await ctx.reply(t(L, 'export.empty'))
    return
  }

  const csv = expensesToCsv(rows, user.timezone, user.baseCurrency)
  await ctx.replyWithDocument(
    new InputFile(Buffer.from(csv, 'utf8'), csvFilename('траты', now, user.timezone)),
    {
      caption: t(L, 'export.caption', {
        count: rows.length,
        plural: plural(L, 'plural.expense', rows.length),
      }),
    },
  )
})

/**
 * Заполняет аккаунт примерами. Нужно для первого знакомства: панель у нового
 * человека пуста, а чужие траты показать нельзя — данные не смешиваются.
 */
bot.command('demo', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return

  const L = localeOf(user)
  if (hasDemo(user.id)) {
    const panel = panelReply(user.id)
    await ctx.reply(t(L, 'demo.already') + panel.extraText, {
      reply_markup: panel.keyboard,
      link_preview_options: { is_disabled: true },
    })
    return
  }

  const added = seedDemo(user)
  // Одна ссылка на ответ: issueLoginToken гасит предыдущий токен, поэтому
  // два вызова подряд оставили бы в тексте мёртвую ссылку.
  const panel = panelReply(user.id)
  await ctx.reply(
    [
      t(L, 'demo.added', { count: added, plural: plural(L, 'plural.expense', added) }),
      t(L, 'demo.yours'),
      '',
      t(L, 'demo.next'),
      t(L, 'demo.clearHint'),
    ].join('\n') + panel.extraText,
    { reply_markup: panel.keyboard, link_preview_options: { is_disabled: true } },
  )
})

bot.command('demo_clear', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const L = localeOf(user)
  const removed = clearDemo(user.id)
  await ctx.reply(
    removed > 0
      ? t(L, 'demo.cleared', { count: removed, plural: plural(L, 'plural.example', removed) })
      : t(L, 'demo.nothing'),
  )
})

/**
 * Служебное: показывает идентификаторы премиум-эмодзи из присланного
 * сообщения. Нужно, чтобы выбрать эмодзи для категорий не наугад —
 * несуществующий идентификатор отрисовался бы пустым квадратом.
 *
 * Команда не в списке /setMyCommands: она для настройки, а не для людей.
 */
bot.command('emoji_id', async (ctx) => {
  await ctx.reply(
    [
      'Пришлите сообщение с премиум-эмодзи (ответом на это или просто следующим),',
      'и я покажу их идентификаторы.',
      '',
      'Premium нужен только чтобы их отправить — читаю я любые.',
    ].join('\n'),
  )
})

bot.on('message:entities:custom_emoji', async (ctx) => {
  const text = ctx.message.text ?? ctx.message.caption ?? ''
  const found = (ctx.message.entities ?? [])
    .filter((e) => e.type === 'custom_emoji')
    .map((e) => ({
      emoji: text.slice(e.offset, e.offset + e.length),
      id: (e as { custom_emoji_id?: string }).custom_emoji_id ?? '?',
    }))

  if (found.length === 0) return
  await ctx.reply(
    ['<b>Идентификаторы премиум-эмодзи</b>', '', ...found.map((f) => `${f.emoji} — <code>${f.id}</code>`)].join('\n'),
    { parse_mode: 'HTML' },
  )
})

bot.command('settings', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const argument = ctx.match?.trim() ?? ''

  if (argument) {
    // «/settings Europe/Moscow» или «/settings USD»
    const asZone = safeTimeZone(argument, '')
    if (asZone) {
      setTimezone(user.id, asZone)
      await ctx.reply(`Часовой пояс: ${asZone}. «Сегодня» теперь считается по нему.`)
      return
    }
    // «/settings tg» — смена языка кодом, без захода в кнопки.
    if (isLocale(argument.toLowerCase())) {
      const next = argument.toLowerCase() as Locale
      setLocale(user.id, next)
      await ctx.reply(t(next, 'settings.languageSet', { name: LOCALE_NAMES[next] }), {
        parse_mode: 'HTML',
        reply_markup: mainKeyboard(next),
      })
      return
    }

    const code = argument.toUpperCase()
    if (isValidCurrency(code)) {
      setBaseCurrency(user.id, code)
      await ctx.reply(
        `Валюта отчётов: ${code}. Уже записанные траты остаются в валюте ввода — пересчёт идёт по курсу на момент траты.`,
      )
      return
    }
    await ctx.reply('Не понял. Пример: <code>/settings Asia/Dushanbe</code> или <code>/settings USD</code>', {
      parse_mode: 'HTML',
    })
    return
  }

  const L = localeOf(user)
  await ctx.reply(
    [
      t(L, 'settings.title'),
      '',
      t(L, 'settings.language', { name: LOCALE_NAMES[L] }),
      t(L, 'settings.timezone', {
        zone: esc(user.timezone),
        offset: utcOffsetLabel(user.timezone),
      }),
      t(L, 'settings.currency', { code: esc(user.baseCurrency) }),
      '',
      t(L, 'settings.whyTimezone'),
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text(t(L, 'btn.changeLanguage'), 'setlang')
        .row()
        .text(t(L, 'btn.changeTimezone'), 'settz')
        .row()
        .text(t(L, 'btn.changeCurrency'), 'setcur'),
    },
  )
})

/* ------------------------------------------------------------------ */
/*  Ввод траты                                                         */
/* ------------------------------------------------------------------ */

async function saveExpenseFromText(ctx: Context, user: User, text: string) {
  // Запоминаем ДО записи: addExpense проставит отметку о первой трате,
  // а нам надо знать, была ли она первой именно сейчас.
  const wasFirstEver = !user.firstExpenseAt
  const L = localeOf(user)
  const entries = splitEntries(text)
  const results = []

  for (const entry of entries.slice(0, 10)) {
    const parsed = parseExpense(entry, user.baseCurrency)
    if (!parsed.ok) {
      results.push({ ok: false as const, reason: parsed.reason, entry })
      continue
    }
    results.push({
      ok: true as const,
      saved: addExpense(user, parsed.value, {
        source: 'bot',
        chatId: ctx.chat?.id ?? null,
      }),
    })
  }

  const failures = results.filter((r) => !r.ok)
  if (failures.length === results.length) {
    const first = failures[0]!
    await ctx.reply(
      [
        explainFailure(first.reason, L),
        '',
        t(L, 'parse.examples', {
          e1: EXAMPLES[L].one,
          e2: EXAMPLES[L].two,
          e3: EXAMPLES[L].three,
        }),
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
    return
  }

  const totals = todayTotals(user)

  for (const result of results) {
    if (!result.ok) continue
    const { expense, classification, rateSource, limitWarning } = result.saved

    const note =
      rateSource === 'unknown'
        ? t(L, 'rate.unknown', { currency: expense.currency })
        : rateSource === 'offline'
          ? t(L, 'rate.offline')
          : undefined

    const message = await ctx.reply(
      expenseCard(expense, user.timezone, totals.totalMinor, totals.count, user.baseCurrency, L, note),
      {
        parse_mode: 'HTML',
        reply_markup: expenseKeyboard(
          expense,
          classification.status === 'ambiguous' ? classification.suggestions : [],
          L,
        ),
      },
    )

    // Запоминаем id карточки: панель потом перепишет её при правке.
    linkExpenseMessage(user.id, expense.id, ctx.chat?.id ?? null, message.message_id)

    if (limitWarning) {
      await ctx.reply(limitMessage(limitWarning, L), { parse_mode: 'HTML' })
    }
  }

  // Первая в жизни трата: сразу показываем, ради чего всё это.
  // Без подсказки человек может так и не узнать, что есть панель.
  if (wasFirstEver && results.some((r) => r.ok)) {
    const panel = panelReply(user.id)
    await ctx.reply(
      [t(L, 'first.done'), '', t(L, 'first.reports'), t(L, 'first.panel')].join('\n') + panel.extraText,
      {
        parse_mode: 'HTML',
        reply_markup: panel.keyboard,
        link_preview_options: { is_disabled: true },
      },
    )
  }
}

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim()
  if (text.startsWith('/')) return // неизвестная команда — не трата

  const user = currentUser(ctx)
  if (!user) return
  await saveExpenseFromText(ctx, user, text)
})

/**
 * Пользователь поправил своё сообщение — самое естественное «изменить трату».
 * Находим трату, созданную из этого сообщения, и обновляем её.
 */
bot.on('edited_message:text', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return

  const L = localeOf(user)
  const parsed = parseExpense(ctx.editedMessage.text, user.baseCurrency)
  if (!parsed.ok) {
    await ctx.reply(explainFailure(parsed.reason, L))
    return
  }

  // Правим последнюю живую трату из этого чата.
  const candidate = lastExpenseInChat(user.id, ctx.chat.id)
  if (!candidate) return

  const updated = updateExpense(user, candidate.id, {
    amount: parsed.value.amount,
    currency: parsed.value.currency,
    description: parsed.value.description,
  })
  if (!updated) return

  const totals = todayTotals(user)
  await ctx.reply(
    expenseCard(
      updated,
      user.timezone,
      totals.totalMinor,
      totals.count,
      user.baseCurrency,
      L,
      t(L, 'card.editedByYou'),
    ),
    { parse_mode: 'HTML', reply_markup: expenseKeyboard(updated, [], L) },
  )
})


/* ------------------------------------------------------------------ */
/*  Чек с фотографии                                                   */
/* ------------------------------------------------------------------ */

/**
 * Подписи к фотографиям чеков: подпись — это описание будущей траты.
 * Живут в памяти и недолго; после перезапуска бота описание станет «Чек»,
 * и это не беда — сумму человек всё равно подтверждает касанием.
 */
const receiptCaptions = new Map<string, { text: string; at: number }>()

function rememberCaption(key: string, text: string): void {
  const now = Date.now()
  for (const [id, value] of receiptCaptions) {
    if (now - value.at > 30 * 60 * 1000) receiptCaptions.delete(id)
  }
  if (text) receiptCaptions.set(key, { text, at: now })
}

bot.on('message:photo', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return

  const L = localeOf(user)
  if (!isOcrEnabled()) {
    await ctx.reply(t(L, 'receipt.off', { example: EXAMPLES[L].one }))
    return
  }

  const notice = await ctx.reply(t(L, 'receipt.reading'))

  try {
    // Берём самый крупный вариант: мелкий эскиз распознаётся заметно хуже.
    const photo = ctx.message.photo[ctx.message.photo.length - 1]!
    const file = await ctx.api.getFile(photo.file_id)
    if (!file.file_path) throw new Error('Telegram не отдал файл')

    const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`не удалось скачать фото: HTTP ${response.status}`)
    const image = Buffer.from(await response.arrayBuffer())

    const result = await recognizeReceipt(image)

    if (result.candidates.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        notice.message_id,
        t(L, 'receipt.failed', { example: EXAMPLES[L].one }),
      )
      return
    }

    const caption = (ctx.message.caption ?? '').trim()
    const keyboard = new InlineKeyboard()
    for (const candidate of result.candidates) {
      keyboard
        .text(
          formatMoney(toMinor(candidate.amount, user.baseCurrency), user.baseCurrency),
          `ocr:${toMinor(candidate.amount, user.baseCurrency)}`,
        )
        .row()
    }

    rememberCaption(String(notice.message_id), caption)

    const lines = [
      t(L, 'receipt.question'),
      '',
      ...result.candidates.map((c) => `• <b>${formatMoney(toMinor(c.amount, user.baseCurrency), user.baseCurrency)}</b> — <i>${esc(c.line.slice(0, 60))}</i>`),
      '',
      t(L, 'receipt.hint'),
    ]

    await ctx.api.editMessageText(ctx.chat.id, notice.message_id, lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    })
  } catch (error) {
    console.warn('[чек]', (error as Error).message)
    await ctx.api
      .editMessageText(
        ctx.chat.id,
        notice.message_id,
        t(L, 'receipt.error', { example: EXAMPLES[L].one }),
      )
      .catch(() => undefined)
  }
})

bot.callbackQuery(/^ocr:(\d+)$/, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return

  const minor = Number(ctx.match[1])
  if (!Number.isFinite(minor) || minor <= 0) {
    await ctx.answerCallbackQuery({ text: 'Странная сумма' })
    return
  }

  const L = localeOf(user)
  const remembered = ctx.callbackQuery.message
    ? receiptCaptions.get(String(ctx.callbackQuery.message.message_id))
    : undefined
  const description = remembered?.text || t(L, 'receipt.word')

  const parsed = parseExpense(
    `${description} ${fromMinor(minor, user.baseCurrency)}`.trim(),
    user.baseCurrency,
  )
  if (!parsed.ok) {
    await ctx.answerCallbackQuery({ text: 'Не удалось сохранить' })
    return
  }

  const saved = addExpense(user, parsed.value, {
    source: 'ocr',
    chatId: ctx.chat?.id ?? null,
  })
  const totals = todayTotals(user)

  await ctx.editMessageText(
    expenseCard(
      saved.expense,
      user.timezone,
      totals.totalMinor,
      totals.count,
      user.baseCurrency,
      L,
      t(L, 'card.fromReceipt'),
    ),
    {
      parse_mode: 'HTML',
      reply_markup: expenseKeyboard(saved.expense, saved.classification.suggestions, L),
    },
  )
  if (ctx.callbackQuery.message) {
    linkExpenseMessage(user.id, saved.expense.id, ctx.chat?.id ?? null, ctx.callbackQuery.message.message_id)
  }
  if (saved.limitWarning) {
    await ctx.reply(limitMessage(saved.limitWarning, L), { parse_mode: 'HTML' })
  }
  await ctx.answerCallbackQuery({ text: 'Записал' })
})

/* ------------------------------------------------------------------ */
/*  Кнопки                                                             */
/* ------------------------------------------------------------------ */

bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery())

// Шаг 1 → шаг 2. Ответ уже на новом языке: иначе смена выглядит как отказ.
bot.callbackQuery(/^wlang:([a-z]{2})$/, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const code = ctx.match[1]!
  if (!isLocale(code)) {
    await ctx.answerCallbackQuery()
    return
  }
  setLocale(user.id, code)
  await ctx.editMessageText(t(code, 'wizard.city'), {
    parse_mode: 'HTML',
    reply_markup: timezoneKeyboard(user.timezone, code, 'wtz'),
  })
  // Клавиатура под полем ввода подписана на прежнем языке — присылаем новую.
  await ctx.reply(t(code, 'start.buttons'), { reply_markup: mainKeyboard(code) })
  await ctx.answerCallbackQuery({ text: LOCALE_NAMES[code] })
})

// Шаг 2 → итог. Валюта берётся из страны города: спрашивать её отдельно
// значило бы третий обязательный экран ради ответа, который и так известен.
bot.callbackQuery(/^wtz:(.+)$/, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const L = localeOf(user)
  const zone = safeTimeZone(ctx.match[1]!, '')
  if (!zone) {
    await ctx.answerCallbackQuery({ text: t(L, 'settings.unknownZone') })
    return
  }
  setTimezone(user.id, zone)

  const city = TIMEZONE_CHOICES.find((c) => c.zone === zone)
  // Валюту меняем только у нового пользователя: если он уже успел записать
  // траты и выбрать валюту сам, мастер не должен её перебивать.
  const currency =
    city && user.firstExpenseAt === null && setBaseCurrency(user.id, city.currency)
      ? city.currency
      : user.baseCurrency

  await ctx.editMessageText(
    t(L, 'wizard.done', {
      city: esc(cityName(zone, L)),
      offset: utcOffsetLabel(zone),
      currency: esc(currency),
      example: esc(EXAMPLES[L].one),
    }),
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text(t(L, 'wizard.changeCurrency'), 'setcur'),
    },
  )
  await ctx.answerCallbackQuery({ text: cityName(zone, L) })
})

bot.callbackQuery('setlang', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const L = localeOf(user)
  await ctx.editMessageText(t(L, 'settings.pickLanguage'), {
    parse_mode: 'HTML',
    reply_markup: languageKeyboard(L),
  })
  await ctx.answerCallbackQuery()
})

bot.callbackQuery(/^lang:([a-z]{2})$/, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const code = ctx.match[1]!
  if (!isLocale(code) || !setLocale(user.id, code)) {
    await ctx.answerCallbackQuery({ text: '?' })
    return
  }
  // Ответ уже на новом языке — иначе смена выглядит как будто не сработала.
  await ctx.editMessageText(t(code, 'settings.languageSet', { name: LOCALE_NAMES[code] }), {
    parse_mode: 'HTML',
  })
  // Клавиатура подписана на прежнем языке: присылаем новую.
  await ctx.reply(t(code, 'start.buttons'), { reply_markup: mainKeyboard(code) })
  await ctx.answerCallbackQuery({ text: LOCALE_NAMES[code] })
})

bot.callbackQuery('settz', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  await ctx.editMessageText(t(localeOf(user), 'settings.pickTimezone'), {
    parse_mode: 'HTML',
    reply_markup: timezoneKeyboard(user.timezone, localeOf(user)),
  })
  await ctx.answerCallbackQuery()
})

bot.callbackQuery('setcur', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  await ctx.editMessageText(t(localeOf(user), 'settings.pickCurrency'), {
    parse_mode: 'HTML',
    reply_markup: currencyKeyboard(user.baseCurrency),
  })
  await ctx.answerCallbackQuery()
})

bot.callbackQuery(/^tz:([A-Za-z_]+\/[A-Za-z_]+)$/, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const L = localeOf(user)
  const zone = safeTimeZone(ctx.match[1]!, '')
  if (!zone) {
    await ctx.answerCallbackQuery({ text: t(L, 'settings.unknownZone') })
    return
  }
  setTimezone(user.id, zone)
  await ctx.editMessageText(
    t(L, 'settings.timezoneSet', { city: esc(cityName(zone, L)), offset: utcOffsetLabel(zone) }),
    { parse_mode: 'HTML' },
  )
  await ctx.answerCallbackQuery({ text: cityName(zone, L) })
})

bot.callbackQuery(/^cur:([A-Z]{3})$/, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const L = localeOf(user)
  const code = ctx.match[1]!
  if (!isValidCurrency(code)) {
    await ctx.answerCallbackQuery({ text: t(L, 'settings.unknownCurrency') })
    return
  }
  setBaseCurrency(user.id, code)
  await ctx.editMessageText(t(L, 'settings.currencySet', { code: esc(code) }), {
    parse_mode: 'HTML',
  })
  await ctx.answerCallbackQuery({ text: code })
})

bot.callbackQuery(/^catmenu:([0-9a-z]+):(\d+)$/i, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const id = ctx.match[1]!
  const page = Number(ctx.match[2])
  if (!getExpense(user.id, id)) {
    await ctx.answerCallbackQuery({ text: 'Трата не найдена' })
    return
  }
  await ctx.editMessageReplyMarkup({ reply_markup: categoryKeyboard(id, page, localeOf(user)) })
  await ctx.answerCallbackQuery()
})

bot.callbackQuery(/^card:([0-9a-z]+)$/i, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const expense = getExpense(user.id, ctx.match[1]!)
  if (!expense) {
    await ctx.answerCallbackQuery({ text: 'Трата не найдена' })
    return
  }
  await ctx.editMessageReplyMarkup({ reply_markup: expenseKeyboard(expense, [], localeOf(user)) })
  await ctx.answerCallbackQuery()
})

bot.callbackQuery(/^cat:([0-9a-z]+):([a-z_]+)$/i, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const [, id, slug] = ctx.match

  const L = localeOf(user)
  const existing = getExpense(user.id, id!)
  if (!existing) {
    await ctx.answerCallbackQuery({ text: 'Трата не найдена' })
    return
  }
  // Ту же категорию выбрали повторно: править сообщение нечем, а Telegram
  // на попытку записать тот же текст отвечает «message is not modified»,
  // и кнопка крутится, будто всё сломалось.
  if (existing.category === slug) {
    await ctx.answerCallbackQuery({ text: categoryName(slug!, L) })
    return
  }

  const updated = updateExpense(user, id!, { category: slug! })
  if (!updated) {
    await ctx.answerCallbackQuery({ text: 'Трата не найдена' })
    return
  }

  const totals = todayTotals(user)
  const category = categoryBySlug(slug!)
  await ctx.editMessageText(
    expenseCard(
      updated,
      user.timezone,
      totals.totalMinor,
      totals.count,
      user.baseCurrency,
      L,
      t(L, 'card.remembered'),
    ),
    { parse_mode: 'HTML', reply_markup: expenseKeyboard(updated, [], L) },
  )
  await ctx.answerCallbackQuery({ text: `${category.emoji} ${categoryName(slug!, L)}` })
})

bot.callbackQuery(/^del:([0-9a-z]+)$/i, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const deleted = deleteExpense(user.id, ctx.match[1]!)
  if (!deleted) {
    await ctx.answerCallbackQuery({ text: 'Уже удалено' })
    return
  }
  // Сообщение не удаляем: Bot API разрешает это только первые 48 часов,
  // а переписать собственную карточку можно всегда.
  await ctx.editMessageText(deletedCard(deleted, localeOf(user)), {
    parse_mode: 'HTML',
    reply_markup: undoKeyboard(deleted.id),
  })
  await ctx.answerCallbackQuery({ text: 'Удалено' })
})

bot.callbackQuery(/^undo:([0-9a-z]+)$/i, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const restored = restoreExpense(user.id, ctx.match[1]!)
  if (!restored) {
    await ctx.answerCallbackQuery({ text: 'Не получилось вернуть' })
    return
  }
  const totals = todayTotals(user)
  await ctx.editMessageText(
    expenseCard(
      restored,
      user.timezone,
      totals.totalMinor,
      totals.count,
      user.baseCurrency,
      localeOf(user),
      t(localeOf(user), 'card.restored'),
    ),
    { parse_mode: 'HTML', reply_markup: expenseKeyboard(restored, [], localeOf(user)) },
  )
  await ctx.answerCallbackQuery({ text: 'Вернул' })
})

/* ------------------------------------------------------------------ */
/*  Ошибки и запуск                                                    */
/* ------------------------------------------------------------------ */

bot.catch((error) => {
  const ctx = error.ctx
  const where = `update ${ctx.update.update_id}`
  const cause = error.error

  if (cause instanceof GrammyError) {
    // 403 — пользователь заблокировал бота. Это не сбой, писать некому.
    if (cause.error_code === 403) {
      console.warn(`[бот] ${where}: пользователь заблокировал бота`)
      return
    }
    console.error(`[бот] ${where}: Telegram ответил ${cause.error_code} ${cause.description}`)
    return
  }
  if (cause instanceof HttpError) {
    console.error(`[бот] ${where}: сеть недоступна`, cause)
    return
  }
  console.error(`[бот] ${where}:`, cause)
})

async function main() {
  runMigrations()

  await bot.api.setMyCommands([
    { command: 'today', description: 'Итог за сегодня' },
    { command: 'week', description: 'Итог за неделю' },
    { command: 'month', description: 'Итог за месяц' },
    { command: 'last', description: 'Последние траты' },
    { command: 'panel', description: 'Открыть веб-панель' },
    { command: 'limit', description: 'Лимит по категории' },
    { command: 'export', description: 'Выгрузить CSV' },
    { command: 'settings', description: 'Часовой пояс и валюта' },
    { command: 'demo', description: 'Заполнить примерами' },
    { command: 'help', description: 'Как пользоваться' },
  ])

  // Модель распознавания греем в фоне: первый пользователь не должен
  // ждать, пока скачаются файлы модели.
  void warmupOcr().then((ready) => {
    if (ready) console.log('[бот] распознавание чеков готово')
  })

  // Курсы и уборка протухших сессий — раз в час, без отдельного планировщика.
  const housekeeping = setInterval(
    () => {
      pruneExpired()
      void refreshRates()
    },
    60 * 60 * 1000,
  )
  void refreshRates()

  const stop = async (signal: string) => {
    console.log(`\n[бот] ${signal}: останавливаюсь…`)
    clearInterval(housekeeping)
    await bot.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => void stop('SIGINT'))
  process.once('SIGTERM', () => void stop('SIGTERM'))

  const me = await bot.api.getMe()
  console.log(`[бот] @${me.username} запущен, панель: ${config.APP_URL}`)

  await bot.start({
    allowed_updates: ['message', 'edited_message', 'callback_query'],
    drop_pending_updates: false,
  })
}

void main()

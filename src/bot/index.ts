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
import { CATEGORIES, categoryBySlug, isCategorySlug } from '../lib/categories'
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
  setBaseCurrency,
  setLimit,
  setTimezone,
  updateExpense,
} from '../lib/expenses'
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
  HELP,
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
const BUTTONS = {
  today: 'Сегодня',
  week: 'Неделя',
  month: 'Месяц',
  panel: 'Панель',
  last: 'Последние',
  help: 'Как писать',
} as const

function mainKeyboard() {
  const keyboard = new Keyboard()
    .text(BUTTONS.today)
    .text(BUTTONS.week)
    .text(BUTTONS.month)
    .row()
    .text(BUTTONS.panel)
    .text(BUTTONS.last)
    .text(BUTTONS.help)
    .resized()
    .persistent()
    .placeholder('кофе 350')

  // Цвет кнопок появился в Bot API 10.3 (24 августа 2026). Синим выделена
  // «Панель» — главное действие после ввода траты; остальные обычные,
  // иначе выделенным оказывается всё и не выделено ничего.
  for (const row of keyboard.keyboard) {
    for (const button of row) {
      if (typeof button === 'object' && button.text === BUTTONS.panel) {
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
const TIMEZONE_CHOICES: Array<[string, string]> = [
  ['Душанбе', 'Asia/Dushanbe'],
  ['Ташкент', 'Asia/Tashkent'],
  ['Алматы', 'Asia/Almaty'],
  ['Бишкек', 'Asia/Bishkek'],
  ['Москва', 'Europe/Moscow'],
  ['Екатеринбург', 'Asia/Yekaterinburg'],
  ['Новосибирск', 'Asia/Novosibirsk'],
  ['Баку', 'Asia/Baku'],
  ['Стамбул', 'Europe/Istanbul'],
  ['Дубай', 'Asia/Dubai'],
  ['Минск', 'Europe/Minsk'],
  ['Берлин', 'Europe/Berlin'],
]

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

function timezoneKeyboard(current: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  TIMEZONE_CHOICES.forEach(([city, zone], index) => {
    const mark = zone === current ? '• ' : ''
    keyboard.text(`${mark}${city} (${utcOffsetLabel(zone)})`, `tz:${zone}`)
    if (index % 2 === 1) keyboard.row()
  })
  if (TIMEZONE_CHOICES.length % 2 === 1) keyboard.row()
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

  const name = user.firstName ? `, ${esc(user.firstName)}` : ''
  const panel = panelReply(user.id)
  await ctx.reply(
    [
      `Привет${name}. Я записываю траты.`,
      '',
      'Просто напишите строку — например <code>кофе 350</code> или <code>такси 900 работа</code>.',
      'Сумму и категорию разберу сам.',
      '',
      'Итоги — кнопками ниже или командами /today, /week, /month.',
      'Графики по дням и категориям — в панели, вход через того же бота, без пароля.',
    ].join('\n') + panel.extraText,
    {
      parse_mode: 'HTML',
      reply_markup: panel.keyboard,
      link_preview_options: { is_disabled: true },
    },
  )
  // Отдельным сообщением: показать кнопки и подсказать формат ввода.
  // Reply-клавиатуру нельзя послать вместе с inline-кнопкой в одном сообщении.
  await ctx.reply('Кнопки ниже — то же самое, что команды.', {
    reply_markup: mainKeyboard(),
  })
})

bot.command('help', async (ctx) => {
  await ctx.reply(HELP, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
})

bot.command('panel', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const panel = panelReply(user.id)
  await ctx.reply(
    'Ссылка действует 10 минут и открывается один раз — так её нельзя переслать и войти чужим.' +
      panel.extraText,
    { reply_markup: panel.keyboard, link_preview_options: { is_disabled: true } },
  )
})

// Context, а не CommandContext: отчёт вызывается и командой, и кнопкой.
async function sendReport(ctx: Context, period: 'day' | 'week' | 'month') {
  const user = currentUser(ctx)
  if (!user) return
  const summary = summarize(
    { id: user.id, timezone: user.timezone, baseCurrency: user.baseCurrency, weekStart: user.weekStart },
    period,
  )
  const panel = panelReply(user.id)
  await ctx.reply(report(summary, user.timezone, config.APP_URL) + panel.extraText, {
    parse_mode: 'HTML',
    reply_markup: panel.keyboard,
    link_preview_options: { is_disabled: true },
  })
}

bot.command(['today', 'сегодня'], (ctx) => sendReport(ctx, 'day'))
bot.command(['week', 'неделя'], (ctx) => sendReport(ctx, 'week'))
bot.command(['month', 'месяц'], (ctx) => sendReport(ctx, 'month'))

/** Общее тело для команды /last и одноимённой кнопки. */
async function sendRecent(ctx: Context) {
  const user = currentUser(ctx)
  if (!user) return
  const rows = recentExpenses(user.id, 10)
  if (rows.length === 0) {
    await ctx.reply('Пока ни одной траты. Напишите «кофе 350».')
    return
  }

  const lines = ['<b>Последние траты</b>', '']
  for (const row of rows) {
    const category = categoryBySlug(row.category)
    const title = row.description ? esc(row.description) : 'без описания'
    lines.push(
      `${category.emoji} ${title} — <b>${formatMoney(row.amountMinor, row.currency)}</b>`,
      `<i>${humanTime(row.spentAt, user.timezone)}</i> · /e_${row.id}`,
      '',
    )
  }
  lines.push('Чтобы поправить или удалить — нажмите ссылку под тратой.')
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
}

bot.command('last', sendRecent)

/** /e_<id> — открыть карточку конкретной траты из списка. */
bot.hears(/^\/e_([0-9a-z]+)$/i, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const id = ctx.match[1]!
  const expense = getExpense(user.id, id)
  if (!expense || expense.deletedAt) {
    await ctx.reply('Такой траты нет.')
    return
  }
  const totals = todayTotals(user)
  await ctx.reply(
    expenseCard(expense, user.timezone, totals.totalMinor, totals.count, user.baseCurrency),
    { parse_mode: 'HTML', reply_markup: expenseKeyboard(expense) },
  )
})

/* Нажатия на кнопки. Регистрируются ДО обработчика обычного текста,
   иначе «Месяц» ушло бы в разбор траты и получило «не нашёл сумму». */
bot.hears(BUTTONS.today, (ctx) => sendReport(ctx, 'day'))
bot.hears(BUTTONS.week, (ctx) => sendReport(ctx, 'week'))
bot.hears(BUTTONS.month, (ctx) => sendReport(ctx, 'month'))
bot.hears(BUTTONS.last, sendRecent)

bot.hears(BUTTONS.help, async (ctx) => {
  await ctx.reply(HELP, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: mainKeyboard(),
  })
})

bot.hears(BUTTONS.panel, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const panel = panelReply(user.id)
  await ctx.reply(
    'Ссылка действует 10 минут и открывается один раз — так её нельзя переслать и войти чужим.' +
      panel.extraText,
    { reply_markup: panel.keyboard, link_preview_options: { is_disabled: true } },
  )
})

bot.command(['limit', 'limits'], async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const argument = ctx.match?.trim() ?? ''

  if (!argument) {
    const rows = listLimits(user)
    if (rows.length === 0) {
      const names = CATEGORIES.filter((c) => c.slug !== 'other')
        .map((c) => c.name.toLowerCase())
        .join(', ')
      await ctx.reply(
        [
          '<b>Лимиты по категориям</b>',
          '',
          'Задайте месячный потолок — предупрежу на 80% и когда он будет исчерпан.',
          '',
          'Например: <code>/limit продукты 2000</code>',
          `Снять: <code>/limit продукты 0</code>`,
          '',
          `Категории: ${esc(names)}`,
        ].join('\n'),
        { parse_mode: 'HTML' },
      )
      return
    }

    const lines = ['<b>Лимиты на этот месяц</b>', '']
    for (const row of rows) {
      const category = categoryBySlug(row.category)
      const share = row.amountMinor > 0 ? Math.round((row.spentMinor / row.amountMinor) * 100) : 0
      const mark = share >= 100 ? '🔴' : share >= 80 ? '🟡' : '🟢'
      lines.push(
        `${mark} ${category.emoji} ${category.name} — ${formatMoney(row.spentMinor, row.currency)} из ${formatMoney(row.amountMinor, row.currency)} (${share}%)`,
      )
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
    return
  }

  // «/limit продукты 2000» — категория словом, сумма числом.
  const match = /^(.+?)\s+(\d+(?:[.,]\d+)?)$/.exec(argument)
  if (!match) {
    await ctx.reply('Формат: <code>/limit продукты 2000</code>', { parse_mode: 'HTML' })
    return
  }
  const name = match[1]!.trim().toLowerCase()
  const amount = Number(match[2]!.replace(',', '.'))
  const category =
    CATEGORIES.find((c) => c.name.toLowerCase() === name) ??
    CATEGORIES.find((c) => c.name.toLowerCase().startsWith(name)) ??
    (isCategorySlug(name) ? categoryBySlug(name) : undefined)

  if (!category) {
    await ctx.reply(`Не знаю категорию «${esc(name)}». Список — в /limit без аргументов.`, {
      parse_mode: 'HTML',
    })
    return
  }

  if (amount === 0) {
    const removed = removeLimit(user.id, category.slug)
    await ctx.reply(removed ? `Лимит на «${category.name}» снят.` : 'Такого лимита не было.')
    return
  }

  setLimit(user, category.slug, amount)
  await ctx.reply(
    `${category.emoji} Лимит на «${category.name}»: ${formatMoney(
      Math.round(amount * 100),
      user.baseCurrency,
    )} в месяц.`,
  )
})

bot.command('export', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const now = Date.now()
  const range = rangeFor('month', now, user.timezone, user.weekStart)
  const rows = expensesInRange(user.id, range)

  if (rows.length === 0) {
    await ctx.reply('За этот месяц трат нет — выгружать нечего.')
    return
  }

  const csv = expensesToCsv(rows, user.timezone, user.baseCurrency)
  await ctx.replyWithDocument(
    new InputFile(Buffer.from(csv, 'utf8'), csvFilename('траты', now, user.timezone)),
    { caption: `${rows.length} ${plural(rows.length, ['трата', 'траты', 'трат'])} за текущий месяц.` },
  )
})

/**
 * Заполняет аккаунт примерами. Нужно для первого знакомства: панель у нового
 * человека пуста, а чужие траты показать нельзя — данные не смешиваются.
 */
bot.command('demo', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return

  if (hasDemo(user.id)) {
    const panel = panelReply(user.id)
    await ctx.reply('Примеры уже добавлены. Убрать их — /demo_clear.' + panel.extraText, {
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
      `Добавил ${added} ${plural(added, ['трату', 'траты', 'трат'])} за последние полтора месяца.`,
      'Это ваши собственные записи — их видно только вам.',
      '',
      'Посмотрите /month, а потом откройте панель.',
      'Убрать примеры одной командой: /demo_clear',
    ].join('\n') + panel.extraText,
    { reply_markup: panel.keyboard, link_preview_options: { is_disabled: true } },
  )
})

bot.command('demo_clear', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const removed = clearDemo(user.id)
  await ctx.reply(
    removed > 0
      ? `Убрал ${removed} ${plural(removed, ['пример', 'примера', 'примеров'])}. Ваши настоящие траты не тронуты.`
      : 'Примеров не было.',
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

  await ctx.reply(
    [
      '<b>Настройки</b>',
      '',
      `🌍 Часовой пояс: <b>${esc(user.timezone)}</b> (${utcOffsetLabel(user.timezone)})`,
      `💰 Валюта отчётов: <b>${esc(user.baseCurrency)}</b>`,
      '',
      'От часового пояса зависит, что считать «сегодня».',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text('Сменить часовой пояс', 'settz')
        .row()
        .text('Сменить валюту', 'setcur'),
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
        explainFailure(first.reason),
        '',
        'Примеры: <code>кофе 350</code>, <code>такси 900 работа</code>, <code>вчера продукты 1.5к</code>.',
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
        ? `Курс ${expense.currency} неизвестен — сумма учтена как есть. Поправьте в панели.`
        : rateSource === 'offline'
          ? 'Курс взят из встроенной таблицы: сети не было.'
          : undefined

    const message = await ctx.reply(
      expenseCard(expense, user.timezone, totals.totalMinor, totals.count, user.baseCurrency, note),
      {
        parse_mode: 'HTML',
        reply_markup: expenseKeyboard(
          expense,
          classification.status === 'ambiguous' ? classification.suggestions : [],
        ),
      },
    )

    // Запоминаем id карточки: панель потом перепишет её при правке.
    linkExpenseMessage(user.id, expense.id, ctx.chat?.id ?? null, message.message_id)

    if (limitWarning) {
      await ctx.reply(limitMessage(limitWarning), { parse_mode: 'HTML' })
    }
  }

  // Первая в жизни трата: сразу показываем, ради чего всё это.
  // Без подсказки человек может так и не узнать, что есть панель.
  if (wasFirstEver && results.some((r) => r.ok)) {
    const panel = panelReply(user.id)
    await ctx.reply(
      [
        'Готово — первая трата записана.',
        '',
        'Итоги: /today, /week, /month.',
        'Графики по дням и категориям — в панели.',
      ].join('\n') + panel.extraText,
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

  const parsed = parseExpense(ctx.editedMessage.text, user.baseCurrency)
  if (!parsed.ok) {
    await ctx.reply(explainFailure(parsed.reason))
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
    expenseCard(updated, user.timezone, totals.totalMinor, totals.count, user.baseCurrency, 'Обновил по вашей правке.'),
    { parse_mode: 'HTML', reply_markup: expenseKeyboard(updated) },
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

  if (!isOcrEnabled()) {
    await ctx.reply('Распознавание чеков выключено. Напишите трату текстом: «продукты 350».')
    return
  }

  const notice = await ctx.reply('Читаю чек…')

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
        'Сумму на чеке разобрать не вышло. Напишите её текстом: «продукты 350».',
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
      'Нашёл на чеке. Какая сумма — трата?',
      '',
      ...result.candidates.map((c) => `• <b>${formatMoney(toMinor(c.amount, user.baseCurrency), user.baseCurrency)}</b> — <i>${esc(c.line.slice(0, 60))}</i>`),
      '',
      'Если ни одна не подходит — просто напишите сумму текстом.',
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
        'Не получилось прочитать чек. Напишите трату текстом: «продукты 350».',
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

  const remembered = ctx.callbackQuery.message
    ? receiptCaptions.get(String(ctx.callbackQuery.message.message_id))
    : undefined
  const description = remembered?.text || 'Чек'

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
      'Сумма с чека. Категорию можно поправить кнопкой.',
    ),
    { parse_mode: 'HTML', reply_markup: expenseKeyboard(saved.expense, saved.classification.suggestions) },
  )
  if (ctx.callbackQuery.message) {
    linkExpenseMessage(user.id, saved.expense.id, ctx.chat?.id ?? null, ctx.callbackQuery.message.message_id)
  }
  if (saved.limitWarning) {
    await ctx.reply(limitMessage(saved.limitWarning), { parse_mode: 'HTML' })
  }
  await ctx.answerCallbackQuery({ text: 'Записал' })
})

/* ------------------------------------------------------------------ */
/*  Кнопки                                                             */
/* ------------------------------------------------------------------ */

bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery())

bot.callbackQuery('settz', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  await ctx.editMessageText(
    ['<b>Часовой пояс</b>', '', 'Выберите город — по нему считаются «сегодня», неделя и месяц.'].join('\n'),
    { parse_mode: 'HTML', reply_markup: timezoneKeyboard(user.timezone) },
  )
  await ctx.answerCallbackQuery()
})

bot.callbackQuery('setcur', async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  await ctx.editMessageText(
    [
      '<b>Валюта отчётов</b>',
      '',
      'Траты в других валютах пересчитываются в неё по курсу на день траты.',
      'Нужной нет? Напишите код: <code>/settings GBP</code>',
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: currencyKeyboard(user.baseCurrency) },
  )
  await ctx.answerCallbackQuery()
})

bot.callbackQuery(/^tz:([A-Za-z_]+\/[A-Za-z_]+)$/, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const zone = safeTimeZone(ctx.match[1]!, '')
  if (!zone) {
    await ctx.answerCallbackQuery({ text: 'Неизвестная зона' })
    return
  }
  setTimezone(user.id, zone)
  const city = TIMEZONE_CHOICES.find(([, z]) => z === zone)?.[0] ?? zone
  await ctx.editMessageText(
    [
      `🌍 Часовой пояс: <b>${esc(city)}</b> (${utcOffsetLabel(zone)})`,
      '',
      'Теперь «сегодня», неделя и месяц считаются по нему.',
    ].join('\n'),
    { parse_mode: 'HTML' },
  )
  await ctx.answerCallbackQuery({ text: city })
})

bot.callbackQuery(/^cur:([A-Z]{3})$/, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const code = ctx.match[1]!
  if (!isValidCurrency(code)) {
    await ctx.answerCallbackQuery({ text: 'Неизвестная валюта' })
    return
  }
  setBaseCurrency(user.id, code)
  await ctx.editMessageText(
    [
      `💰 Валюта отчётов: <b>${esc(code)}</b>`,
      '',
      'Уже записанные траты остаются в валюте ввода — пересчёт идёт по курсу на день траты.',
    ].join('\n'),
    { parse_mode: 'HTML' },
  )
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
  await ctx.editMessageReplyMarkup({ reply_markup: categoryKeyboard(id, page) })
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
  await ctx.editMessageReplyMarkup({ reply_markup: expenseKeyboard(expense) })
  await ctx.answerCallbackQuery()
})

bot.callbackQuery(/^cat:([0-9a-z]+):([a-z_]+)$/i, async (ctx) => {
  const user = currentUser(ctx)
  if (!user) return
  const [, id, slug] = ctx.match

  const existing = getExpense(user.id, id!)
  if (!existing) {
    await ctx.answerCallbackQuery({ text: 'Трата не найдена' })
    return
  }
  // Ту же категорию выбрали повторно: править сообщение нечем, а Telegram
  // на попытку записать тот же текст отвечает «message is not modified»,
  // и кнопка крутится, будто всё сломалось.
  if (existing.category === slug) {
    await ctx.answerCallbackQuery({ text: categoryBySlug(slug!).name })
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
      'Запомнил: в следующий раз определю так же.',
    ),
    { parse_mode: 'HTML', reply_markup: expenseKeyboard(updated) },
  )
  await ctx.answerCallbackQuery({ text: `${category.emoji} ${category.name}` })
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
  await ctx.editMessageText(deletedCard(deleted), {
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
    expenseCard(restored, user.timezone, totals.totalMinor, totals.count, user.baseCurrency, 'Вернул.'),
    { parse_mode: 'HTML', reply_markup: expenseKeyboard(restored) },
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

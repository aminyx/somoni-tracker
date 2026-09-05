/**
 * Работа с тратами. Единственное место, где траты создаются, правятся
 * и удаляются, — и бот, и панель ходят сюда.
 *
 * Изоляция данных: КАЖДЫЙ запрос фильтруется по userId, а функции правки
 * возвращают null, если строка принадлежит другому пользователю. Никаких
 * «найди по id, потом проверь» — условие всегда внутри WHERE.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { classify, normalizeForMatch, type ClassifyResult, type UserRules } from './categorize'
import { OTHER_CATEGORY, isCategorySlug } from './categories'
import { db } from './db'
import {
  categoryOverrides,
  expenses,
  limits,
  users,
  type Expense,
  type User,
} from './db/schema'
import { newId } from './id'
import { convertMinor, toMinor } from './money'
import type { ParsedExpense } from './parser'
import { getRate } from './rates'
import { spentInCategory } from './stats'
import { monthKey, rangeFor, zonedStartOfDay, partsInZone, safeTimeZone } from './time'

export interface TelegramProfile {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
  photo_url?: string
}

/** Заводит пользователя при первом сообщении и обновляет профиль при каждом. */
export function ensureUser(profile: TelegramProfile, defaults?: { timezone?: string; currency?: string }): User {
  const now = Date.now()
  const existing = db.select().from(users).where(eq(users.id, profile.id)).get()

  if (existing) {
    db.update(users)
      .set({
        firstName: profile.first_name ?? existing.firstName,
        lastName: profile.last_name ?? existing.lastName,
        username: profile.username ?? existing.username,
        photoUrl: profile.photo_url ?? existing.photoUrl,
        languageCode: profile.language_code ?? existing.languageCode,
        lastSeenAt: now,
      })
      .where(eq(users.id, profile.id))
      .run()
    return db.select().from(users).where(eq(users.id, profile.id)).get()!
  }

  db.insert(users)
    .values({
      id: profile.id,
      firstName: profile.first_name ?? '',
      lastName: profile.last_name ?? null,
      username: profile.username ?? null,
      photoUrl: profile.photo_url ?? null,
      languageCode: profile.language_code ?? null,
      timezone: defaults?.timezone ?? 'Asia/Dushanbe',
      baseCurrency: defaults?.currency ?? 'TJS',
      createdAt: now,
      lastSeenAt: now,
    })
    .run()

  return db.select().from(users).where(eq(users.id, profile.id)).get()!
}

export function getUser(userId: number): User | null {
  return db.select().from(users).where(eq(users.id, userId)).get() ?? null
}

/* ------------------------------------------------------------------ */
/*  Обучение категориям                                                */
/* ------------------------------------------------------------------ */

/** Собирает правила пользователя: его правки важнее общего словаря. */
export function loadUserRules(userId: number): UserRules {
  const rows = db
    .select()
    .from(categoryOverrides)
    .where(eq(categoryOverrides.userId, userId))
    .all()

  const exact = new Map<string, string>()
  const token = new Map<string, string>()
  for (const row of rows) {
    if (row.phrase.includes(' ')) exact.set(row.phrase, row.category)
    else token.set(row.phrase, row.category)
  }

  // Привычка: какие категории пользователь вообще использует. Влияет только
  // на разрешение ничьей, поэтому нормируем на самую частую.
  const counts = db
    .select({ category: expenses.category, count: sql<number>`count(*)` })
    .from(expenses)
    .where(and(eq(expenses.userId, userId), isNull(expenses.deletedAt)))
    .groupBy(expenses.category)
    .all()

  const max = counts.reduce((acc, row) => Math.max(acc, Number(row.count)), 0)
  const prior = new Map<string, number>()
  if (max > 0) {
    for (const row of counts) prior.set(row.category, Number(row.count) / max)
  }

  return { exact, token, prior }
}

/**
 * Запоминает правку пользователя. Учим на нормализованном описании:
 * «Обед у Фаруха» и «обед у фаруха» — одно и то же правило.
 */
export function rememberCategory(userId: number, description: string, category: string): void {
  const phrase = normalizeForMatch(description)
  if (!phrase || !isCategorySlug(category)) return

  db.insert(categoryOverrides)
    .values({ userId, phrase, category, hits: 1, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: [categoryOverrides.userId, categoryOverrides.phrase],
      set: { category, hits: sql`${categoryOverrides.hits} + 1`, updatedAt: Date.now() },
    })
    .run()
}

/* ------------------------------------------------------------------ */
/*  Создание траты                                                     */
/* ------------------------------------------------------------------ */

export interface AddExpenseOptions {
  source?: 'bot' | 'web' | 'ocr' | 'seed'
  chatId?: number | null
  messageId?: number | null
  /** категория, выбранная человеком явно — обучение и никакого угадывания */
  category?: string | null
  /** момент траты, если он известен точно (импорт, правка) */
  spentAt?: number
}

export interface AddExpenseResult {
  expense: Expense
  classification: ClassifyResult
  /** курс взят из офлайн-таблицы или неизвестен — стоит сказать пользователю */
  rateSource: 'same' | 'cache' | 'offline' | 'unknown'
  limitWarning: LimitWarning | null
}

/** Вычисляет момент траты по разобранной дате: «вчера», «3 сентября». */
export function resolveSpentAt(parsed: ParsedExpense, user: User, now = Date.now()): number {
  const tz = safeTimeZone(user.timezone)
  const today = partsInZone(now, tz)

  if (parsed.explicitDate) {
    const { year, month, day } = parsed.explicitDate
    let resolvedYear = year ?? today.year
    if (year === null) {
      // Без года берём ближайшую прошедшую дату: 31 декабря, названное
      // 2 января, — это прошлый год, а не будущий.
      const candidate = zonedStartOfDay(tz, resolvedYear, month, day)
      if (candidate > now) resolvedYear -= 1
    }
    const start = zonedStartOfDay(tz, resolvedYear, month, day)
    // Внутри дня ставим текущее локальное время — так порядок в ленте
    // остаётся осмысленным.
    return start + (today.hour * 60 + today.minute) * 60_000
  }

  if (parsed.dayOffset !== 0) {
    const shifted = zonedStartOfDay(tz, today.year, today.month, today.day + parsed.dayOffset)
    return shifted + (today.hour * 60 + today.minute) * 60_000
  }

  return now
}

/**
 * Предел длины описания.
 *
 * Без него длинное сообщение раздувает карточку за лимит Telegram в 4096
 * символов, и подтверждение не приходит вовсе: трата записана, ответа нет.
 * Столько же стоит в схеме проверки на стороне панели.
 */
const MAX_DESCRIPTION = 200

function trimDescription(text: string): string {
  const clean = text.trim()
  return clean.length <= MAX_DESCRIPTION ? clean : clean.slice(0, MAX_DESCRIPTION - 1) + '…'
}

export function addExpense(
  user: User,
  parsed: ParsedExpense,
  options: AddExpenseOptions = {},
): AddExpenseResult {
  const now = Date.now()
  const rules = loadUserRules(user.id)

  const classification = options.category
    ? ({ category: options.category, confidence: 1, status: 'confident', suggestions: [] } as ClassifyResult)
    : classify(parsed.description || parsed.raw, rules)

  const category = isCategorySlug(classification.category) ? classification.category : OTHER_CATEGORY

  const amountMinor = toMinor(parsed.amount, parsed.currency)
  const { rate, source } = getRate(user.baseCurrency, parsed.currency)
  const baseMinor = convertMinor(amountMinor, parsed.currency, user.baseCurrency, rate)

  const expense = {
    id: newId(now),
    userId: user.id,
    amountMinor,
    currency: parsed.currency.toUpperCase(),
    baseMinor,
    rate,
    category,
    description: trimDescription(parsed.description),
    spentAt: options.spentAt ?? resolveSpentAt(parsed, user, now),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    source: options.source ?? 'bot',
    rawText: parsed.raw,
    chatId: options.chatId ?? null,
    messageId: options.messageId ?? null,
  }

  db.insert(expenses).values(expense).run()

  if (!user.firstExpenseAt) {
    db.update(users).set({ firstExpenseAt: now }).where(eq(users.id, user.id)).run()
  }

  // Пользователь назвал категорию сам — запоминаем на будущее.
  if (options.category && parsed.description) {
    rememberCategory(user.id, parsed.description, options.category)
  }

  return {
    expense: expense as Expense,
    classification,
    rateSource: source,
    limitWarning: checkLimit(user, category, now),
  }
}

/* ------------------------------------------------------------------ */
/*  Правка и удаление                                                  */
/* ------------------------------------------------------------------ */

export function getExpense(userId: number, id: string): Expense | null {
  return (
    db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
      .get() ?? null
  )
}

export interface ExpensePatch {
  amount?: number
  currency?: string
  category?: string
  description?: string
  spentAt?: number
}

/**
 * Правит трату. Возвращает null, если трата не найдена ИЛИ принадлежит
 * другому пользователю — вызывающему коду разница не сообщается.
 */
export function updateExpense(user: User, id: string, patch: ExpensePatch): Expense | null {
  const current = getExpense(user.id, id)
  if (!current || current.deletedAt) return null

  const currency = (patch.currency ?? current.currency).toUpperCase()
  const amountMinor =
    patch.amount !== undefined ? toMinor(patch.amount, currency) : current.amountMinor

  let rate = current.rate
  let baseMinor = current.baseMinor
  if (patch.amount !== undefined || patch.currency !== undefined) {
    rate = getRate(user.baseCurrency, currency).rate
    baseMinor = convertMinor(amountMinor, currency, user.baseCurrency, rate)
  }

  const category =
    patch.category && isCategorySlug(patch.category) ? patch.category : current.category

  db.update(expenses)
    .set({
      amountMinor,
      currency,
      baseMinor,
      rate,
      category,
      description: trimDescription(patch.description ?? current.description),
      spentAt: patch.spentAt ?? current.spentAt,
      updatedAt: Date.now(),
    })
    .where(and(eq(expenses.id, id), eq(expenses.userId, user.id)))
    .run()

  // Смена категории вручную — это урок: в следующий раз угадаем правильно.
  if (patch.category && patch.category !== current.category) {
    rememberCategory(user.id, patch.description ?? current.description, patch.category)
  }

  return getExpense(user.id, id)
}

/** Мягкое удаление: строка остаётся, чтобы работала кнопка «Отменить». */
export function deleteExpense(userId: number, id: string): Expense | null {
  const now = Date.now()
  const rows = db
    .update(expenses)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(expenses.id, id), eq(expenses.userId, userId), isNull(expenses.deletedAt)))
    .returning()
    .all()
  return rows[0] ?? null
}

export function restoreExpense(userId: number, id: string): Expense | null {
  const rows = db
    .update(expenses)
    .set({ deletedAt: null, updatedAt: Date.now() })
    .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
    .returning()
    .all()
  return rows[0] ?? null
}

/** Последняя живая трата — для команды «/отмена» и правки «то, что только что». */
export function lastExpense(userId: number): Expense | null {
  return (
    db
      .select()
      .from(expenses)
      .where(and(eq(expenses.userId, userId), isNull(expenses.deletedAt)))
      .orderBy(desc(expenses.createdAt))
      .limit(1)
      .get() ?? null
  )
}

/* ------------------------------------------------------------------ */
/*  Лимиты по категориям                                               */
/* ------------------------------------------------------------------ */

export interface LimitWarning {
  category: string
  /** 80 или 100 */
  level: 80 | 100
  spentMinor: number
  limitMinor: number
  currency: string
}

export function setLimit(user: User, category: string, amount: number): void {
  if (!isCategorySlug(category)) return
  const now = Date.now()
  const amountMinor = toMinor(amount, user.baseCurrency)

  db.insert(limits)
    .values({
      id: newId(now),
      userId: user.id,
      category,
      amountMinor,
      currency: user.baseCurrency,
      notifiedLevel: 0,
      periodKey: monthKey(now, user.timezone),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [limits.userId, limits.category],
      set: { amountMinor, currency: user.baseCurrency, notifiedLevel: 0, updatedAt: now },
    })
    .run()
}

export function removeLimit(userId: number, category: string): boolean {
  const result = db
    .delete(limits)
    .where(and(eq(limits.userId, userId), eq(limits.category, category)))
    .run()
  return result.changes > 0
}

export function listLimits(user: User, now = Date.now()) {
  const rows = db.select().from(limits).where(eq(limits.userId, user.id)).all()
  const range = rangeFor('month', now, user.timezone, user.weekStart)
  return rows.map((row) => ({
    ...row,
    spentMinor: spentInCategory(user.id, row.category, range),
  }))
}

/**
 * Проверяет лимит после новой траты.
 *
 * Порог сообщается один раз за месяц: пользователь, который каждый день
 * покупает кофе, не должен получать «вы превысили лимит» двадцать раз.
 */
export function checkLimit(user: User, category: string, now = Date.now()): LimitWarning | null {
  const row = db
    .select()
    .from(limits)
    .where(and(eq(limits.userId, user.id), eq(limits.category, category)))
    .get()
  if (!row) return null

  const period = monthKey(now, user.timezone)
  let notified = row.notifiedLevel
  if (row.periodKey !== period) {
    notified = 0
    db.update(limits)
      .set({ periodKey: period, notifiedLevel: 0, updatedAt: now })
      .where(eq(limits.id, row.id))
      .run()
  }

  const range = rangeFor('month', now, user.timezone, user.weekStart)
  const spent = spentInCategory(user.id, category, range)
  const share = row.amountMinor > 0 ? (spent / row.amountMinor) * 100 : 0

  const level: 80 | 100 | null = share >= 100 ? 100 : share >= 80 ? 80 : null
  if (level === null || level <= notified) return null

  db.update(limits)
    .set({ notifiedLevel: level, periodKey: period, updatedAt: now })
    .where(eq(limits.id, row.id))
    .run()

  return {
    category,
    level,
    spentMinor: spent,
    limitMinor: row.amountMinor,
    currency: row.currency,
  }
}

/** Привязывает карточку в чате к трате: панель потом её перепишет. */
export function linkExpenseMessage(
  userId: number,
  expenseId: string,
  chatId: number | null,
  messageId: number,
): void {
  db.update(expenses)
    .set({ chatId, messageId })
    .where(and(eq(expenses.id, expenseId), eq(expenses.userId, userId)))
    .run()
}

/** Меняет часовой пояс пользователя. От него зависит, что такое «сегодня». */
export function setTimezone(userId: number, timezone: string): void {
  // timezoneAuto = 0: человек выбрал зону сам, панель её больше не перебьёт.
  db.update(users)
    .set({ timezone: safeTimeZone(timezone), timezoneAuto: 0 })
    .where(eq(users.id, userId))
    .run()
}

/**
 * Меняет валюту отчётов И пересчитывает всё уже записанное.
 *
 * Без пересчёта столбец base_minor остаётся в СТАРОЙ базовой валюте, а все
 * итоги подписываются новой: сто сомони превращались в сто долларов, и цифры
 * врали в разы. Сумма и валюта ввода при этом не трогаются — они факт,
 * а base_minor всего лишь их пересчёт.
 *
 * Возвращает, сколько трат пересчитано.
 */
export function setBaseCurrency(userId: number, currency: string): number {
  const code = currency.toUpperCase()
  const rows = db.select().from(expenses).where(eq(expenses.userId, userId)).all()

  return db.transaction((tx) => {
    tx.update(users).set({ baseCurrency: code }).where(eq(users.id, userId)).run()

    let touched = 0
    for (const row of rows) {
      const { rate } = getRate(code, row.currency)
      const baseMinor = convertMinor(row.amountMinor, row.currency, code, rate)
      if (baseMinor === row.baseMinor && rate === row.rate) continue
      tx.update(expenses)
        .set({ baseMinor, rate })
        .where(eq(expenses.id, row.id))
        .run()
      touched++
    }
    return touched
  })
}

/** Последняя трата из конкретного чата — для правки отредактированного сообщения. */
export function lastExpenseInChat(userId: number, chatId: number): Expense | null {
  return (
    db
      .select()
      .from(expenses)
      .where(
        and(eq(expenses.userId, userId), eq(expenses.chatId, chatId), isNull(expenses.deletedAt)),
      )
      .orderBy(desc(expenses.createdAt))
      .limit(1)
      .get() ?? null
  )
}

/**
 * Ставит зону, подсказанную браузером, — но только если пользователь
 * не выбирал её сам. Возвращает true, если зона действительно изменилась.
 */
export function applyBrowserTimezone(user: User, zone: string): boolean {
  if (user.timezoneAuto !== 1) return false
  if (user.timezone === zone) return false
  db.update(users).set({ timezone: safeTimeZone(zone) }).where(eq(users.id, user.id)).run()
  return true
}

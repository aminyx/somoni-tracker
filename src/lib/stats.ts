/**
 * Агрегаты для панели и для бота. Один источник правды: если бот и панель
 * покажут разные цифры за один и тот же период — доверие к продукту исчезает,
 * поэтому обе стороны ходят сюда.
 */
import { and, asc, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { db } from './db'
import { expenses } from './db/schema'
import { dayKey, enumerateDays, previousRange, rangeFor, type Period, type Range } from './time'

export interface UserContext {
  id: number
  timezone: string
  baseCurrency: string
  weekStart: number
}

export interface CategoryTotal {
  category: string
  totalMinor: number
  count: number
  share: number
}

export interface DayTotal {
  day: string
  totalMinor: number
  count: number
}

export interface PeriodSummary {
  period: Period
  range: Range
  totalMinor: number
  count: number
  currency: string
  byCategory: CategoryTotal[]
  byDay: DayTotal[]
  /** Тот же период предыдущего цикла — для «−12 % к прошлому месяцу». */
  previousTotalMinor: number
  /** Средние траты в день по прошедшим дням периода. */
  averagePerDayMinor: number
  /** Самый дорогой день периода. */
  topDay: DayTotal | null
}

const alive = (userId: number) => and(eq(expenses.userId, userId), isNull(expenses.deletedAt))

function inRange(userId: number, range: Range) {
  return and(alive(userId), gte(expenses.spentAt, range.start), lt(expenses.spentAt, range.end))
}

/** Сумма и количество трат за произвольный диапазон. */
export function totalFor(userId: number, range: Range): { totalMinor: number; count: number } {
  const row = db
    .select({
      total: sql<number>`coalesce(sum(${expenses.baseMinor}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(expenses)
    .where(inRange(userId, range))
    .get()
  return { totalMinor: row?.total ?? 0, count: row?.count ?? 0 }
}

/** Разбивка по категориям, от большего к меньшему. */
export function byCategory(userId: number, range: Range): CategoryTotal[] {
  const rows = db
    .select({
      category: expenses.category,
      total: sql<number>`sum(${expenses.baseMinor})`,
      count: sql<number>`count(*)`,
    })
    .from(expenses)
    .where(inRange(userId, range))
    .groupBy(expenses.category)
    .orderBy(desc(sql`sum(${expenses.baseMinor})`))
    .all()

  const total = rows.reduce((acc, r) => acc + Number(r.total ?? 0), 0)
  return rows.map((r) => ({
    category: r.category,
    totalMinor: Number(r.total ?? 0),
    count: Number(r.count ?? 0),
    share: total ? (Number(r.total ?? 0) / total) * 100 : 0,
  }))
}

/**
 * Разбивка по дням. Дни без трат возвращаются нулями — иначе на графике
 * появляются «дыры» и месяц выглядит короче, чем он есть.
 */
export function byDay(userId: number, range: Range, timezone: string): DayTotal[] {
  const rows = db
    .select({ spentAt: expenses.spentAt, amount: expenses.baseMinor })
    .from(expenses)
    .where(inRange(userId, range))
    .all()

  const buckets = new Map<string, DayTotal>()
  for (const day of enumerateDays(range, timezone)) {
    buckets.set(day, { day, totalMinor: 0, count: 0 })
  }
  for (const row of rows) {
    const key = dayKey(row.spentAt, timezone)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.totalMinor += row.amount
      bucket.count += 1
    }
  }
  return [...buckets.values()]
}

/** Полная сводка за период — то, что рисует панель и печатает бот. */
export function summarize(user: UserContext, period: Period, at: number = Date.now()): PeriodSummary {
  const range = rangeFor(period, at, user.timezone, user.weekStart)
  const { totalMinor, count } = totalFor(user.id, range)
  const prev = previousRange(period, at, user.timezone, user.weekStart)
  const previousTotalMinor = period === 'all' ? 0 : totalFor(user.id, prev).totalMinor

  const days = period === 'all' ? [] : byDay(user.id, range, user.timezone)
  // Средние считаем по прошедшим дням, а не по всей длине месяца:
  // 3-го числа «в среднем 40 смн/день» честнее, чем «4 смн/день».
  const elapsedDays = Math.max(
    1,
    days.filter((d) => d.day <= dayKey(Math.min(at, range.end - 1), user.timezone)).length,
  )

  const topDay = days.reduce<DayTotal | null>(
    (best, d) => (d.totalMinor > (best?.totalMinor ?? 0) ? d : best),
    null,
  )

  return {
    period,
    range,
    totalMinor,
    count,
    currency: user.baseCurrency,
    byCategory: byCategory(user.id, range),
    byDay: days,
    previousTotalMinor,
    averagePerDayMinor: Math.round(totalMinor / elapsedDays),
    topDay,
  }
}

/** Последние траты пользователя — лента в панели и «/last» в боте. */
export function recentExpenses(userId: number, limit = 20, offset = 0) {
  return db
    .select()
    .from(expenses)
    .where(alive(userId))
    .orderBy(desc(expenses.spentAt), desc(expenses.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
}

/** Траты за период, по возрастанию времени — для экспорта в CSV. */
export function expensesInRange(userId: number, range: Range) {
  return db
    .select()
    .from(expenses)
    .where(inRange(userId, range))
    .orderBy(asc(expenses.spentAt))
    .all()
}

/** Потрачено по одной категории за период — нужно для проверки лимитов. */
export function spentInCategory(userId: number, category: string, range: Range): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${expenses.baseMinor}), 0)` })
    .from(expenses)
    .where(and(inRange(userId, range), eq(expenses.category, category)))
    .get()
  return row?.total ?? 0
}

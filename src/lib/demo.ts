/**
 * Демонстрационные траты.
 *
 * Нужны по прозаичной причине: у нового человека панель пуста, а данные
 * пользователей не смешиваются — показать чужие траты нельзя. Поэтому бот
 * умеет насыпать примеры В СОБСТВЕННЫЙ аккаунт пользователя и так же
 * начисто их убрать.
 *
 * Суммы взяты из реальных душанбинских цен: маршрутка 1,6 сомони,
 * лепёшка 5, обед в чайхане 25–40.
 */
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { expenses, type User } from './db/schema'
import { addExpense } from './expenses'
import { parseExpense } from './parser'
import { partsInZone, zonedStartOfDay } from './time'

/** Заготовки: строка траты и сдвиг в днях назад от сегодняшнего. */
const SAMPLES: Array<[string, number, number]> = [
  // текст, дней назад, час
  ['маршрутка 1.6', 0, 8],
  ['нон 5', 0, 9],
  ['кофе 12', 0, 11],
  ['обед чайхана 35', 0, 13],
  ['маршрутка 1.6', 0, 18],
  ['продукты базар 145', 1, 10],
  ['такси 25', 1, 19],
  ['аптека 60', 1, 16],
  ['кофе 12', 2, 10],
  ['сомса 8', 2, 12],
  ['интернет 150', 2, 15],
  ['маршрутка 3.2', 3, 9],
  ['мясо гушт 220', 3, 11],
  ['лекарства 45', 3, 17],
  ['такси 30', 4, 8],
  ['обед 40', 4, 13],
  ['подарок племяннику 120', 4, 18],
  ['продукты 310', 5, 11],
  ['бензин 180', 5, 14],
  ['кино 60', 6, 20],
  ['кофе 12', 6, 10],
  ['тсел 30', 7, 12],
  ['футболка 150', 8, 15],
  ['свет барки точик 95', 9, 10],
  ['вода 30', 9, 10],
  ['лагман 30', 10, 13],
  ['маршрутка 1.6', 11, 8],
  ['книга 85', 12, 16],
  ['продукты 275', 13, 11],
  ['такси 45 аэропорт', 14, 6],
  ['спортзал абонемент 200', 15, 18],
  ['аренда квартиры 1800', 16, 12],

  // Прошлый месяц: без него сравнение «к прошлому периоду» показывать
  // не из чего, а именно оно делает цифру осмысленной.
  ['продукты 260', 31, 11],
  ['маршрутка 3.2', 31, 8],
  ['обед 38', 31, 13],
  ['такси 28', 32, 19],
  ['нон 5', 32, 9],
  ['кофе 12', 33, 10],
  ['аптека 75', 33, 16],
  ['продукты базар 190', 34, 11],
  ['интернет 150', 35, 15],
  ['тсел 30', 35, 12],
  ['кино 60', 36, 20],
  ['маршрутка 1.6', 37, 8],
  ['обед чайхана 42', 38, 13],
  ['одежда 240', 39, 16],
  ['свет 88', 40, 10],
  ['мясо 210', 41, 11],
  ['такси 35', 42, 18],
  ['подарок 150', 43, 17],
  ['продукты 320', 44, 11],
  ['аренда квартиры 1800', 46, 12],
]

/** Заполняет аккаунт примерами. Возвращает, сколько трат добавлено. */
export function seedDemo(user: User, now = Date.now()): number {
  const tz = user.timezone
  const today = partsInZone(now, tz)
  let added = 0

  for (const [text, daysAgo, hour] of SAMPLES) {
    const parsed = parseExpense(text, user.baseCurrency)
    if (!parsed.ok) continue

    const dayStart = zonedStartOfDay(tz, today.year, today.month, today.day - daysAgo)
    const spentAt = dayStart + hour * 3_600_000
    // Не заглядываем в будущее: трата «сегодня в 18:00» в 10 утра выглядит
    // как ошибка в данных.
    if (spentAt > now) continue

    addExpense(user, parsed.value, { source: 'seed', spentAt })
    added++
  }
  return added
}

/** Убирает только демонстрационные траты, настоящие не трогает. */
export function clearDemo(userId: number): number {
  const result = db
    .delete(expenses)
    .where(and(eq(expenses.userId, userId), eq(expenses.source, 'seed')))
    .run()
  return result.changes
}

/** Есть ли у пользователя демо-траты. */
export function hasDemo(userId: number): boolean {
  const row = db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.userId, userId), eq(expenses.source, 'seed')))
    .limit(1)
    .get()
  return Boolean(row)
}

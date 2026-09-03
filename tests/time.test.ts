import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addDays,
  dayKey,
  dayKeyToInstant,
  enumerateDays,
  monthKey,
  partsInZone,
  previousRange,
  rangeFor,
  startOfDay,
  zoneOffsetMs,
} from '../src/lib/time.ts'

const TZ = 'Asia/Dushanbe' // UTC+5, без перехода на летнее время
const HOUR = 3_600_000

test('смещение Душанбе равно +5 часам', () => {
  const t = Date.UTC(2026, 8, 3, 12, 0, 0)
  assert.equal(zoneOffsetMs(t, TZ), 5 * HOUR)
})

test('«сегодня» в 02:00 по Душанбе — это уже новые сутки, а не вчерашние по UTC', () => {
  // 2026-09-03 02:30 в Душанбе = 2026-09-02 21:30 UTC
  const instant = Date.UTC(2026, 8, 2, 21, 30)
  assert.equal(dayKey(instant, TZ), '2026-09-03')
  const day = rangeFor('day', instant, TZ)
  // сутки начинаются в 19:00 UTC предыдущего дня
  assert.equal(day.start, Date.UTC(2026, 8, 2, 19, 0))
  assert.equal(day.end, Date.UTC(2026, 8, 3, 19, 0))
  assert.equal(day.end - day.start, 24 * HOUR)
})

test('трата в 23:50 по Душанбе попадает в текущие сутки, а не в следующие', () => {
  const instant = Date.UTC(2026, 8, 3, 18, 50) // 23:50 местного
  const day = rangeFor('day', instant, TZ)
  assert.ok(instant >= day.start && instant < day.end)
  assert.equal(dayKey(instant, TZ), '2026-09-03')
})

test('неделя начинается с понедельника', () => {
  // 2026-09-03 — четверг
  const instant = Date.UTC(2026, 8, 3, 12, 0)
  assert.equal(partsInZone(instant, TZ).weekday, 4)
  const week = rangeFor('week', instant, TZ, 1)
  assert.equal(dayKey(week.start, TZ), '2026-08-31') // понедельник
  assert.equal(week.end - week.start, 7 * 24 * HOUR)
})

test('месяц покрывает ровно календарный месяц', () => {
  const instant = Date.UTC(2026, 8, 15, 12, 0)
  const month = rangeFor('month', instant, TZ)
  assert.equal(dayKey(month.start, TZ), '2026-09-01')
  assert.equal(dayKey(month.end, TZ), '2026-10-01')
  assert.equal(enumerateDays(month, TZ).length, 30)
})

test('предыдущий месяц вычисляется через границу года', () => {
  const jan = Date.UTC(2026, 0, 10, 12, 0)
  const prev = previousRange('month', jan, TZ)
  assert.equal(monthKey(prev.start, TZ), '2025-12')
  assert.equal(enumerateDays(prev, TZ).length, 31)
})

test('високосный февраль — 29 дней', () => {
  const feb = Date.UTC(2028, 1, 10, 12, 0)
  assert.equal(enumerateDays(rangeFor('month', feb, TZ), TZ).length, 29)
})

test('зона с переводом часов: сутки могут быть 23 или 25 часов', () => {
  const berlin = 'Europe/Berlin'
  // Переход на летнее время 2026: 29 марта
  const spring = Date.UTC(2026, 2, 29, 12, 0)
  const day = rangeFor('day', spring, berlin)
  assert.equal(day.end - day.start, 23 * HOUR)
  const autumn = Date.UTC(2026, 9, 25, 12, 0)
  const day2 = rangeFor('day', autumn, berlin)
  assert.equal(day2.end - day2.start, 25 * HOUR)
})

test('addDays идёт по календарю, а не по 24 часам', () => {
  const berlin = 'Europe/Berlin'
  const before = startOfDay(Date.UTC(2026, 2, 28, 12, 0), berlin)
  const after = addDays(before, 1, berlin)
  assert.equal(dayKey(after, berlin), '2026-03-29')
})

test('ключ дня и обратное преобразование согласованы', () => {
  const instant = Date.UTC(2026, 8, 3, 6, 0)
  const key = dayKey(instant, TZ)
  assert.equal(dayKeyToInstant(key, TZ), startOfDay(instant, TZ))
  assert.equal(dayKeyToInstant('мусор', TZ), null)
})

test('неизвестная зона не роняет расчёт', () => {
  const instant = Date.UTC(2026, 8, 3, 12, 0)
  assert.equal(dayKey(instant, 'Mars/Olympus' as string), dayKey(instant, TZ))
})

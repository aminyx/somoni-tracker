/**
 * Границы периодов с учётом часового пояса пользователя.
 *
 * Почему не просто `new Date().setHours(0,0,0,0)`: сервер может стоять в UTC,
 * а пользователь живёт в Душанбе (UTC+5). В 02:00 по Душанбе на сервере ещё
 * вчерашний день, и «итог за сегодня» показал бы вчерашние траты.
 * Всё считается через IANA-зону, без зависимостей.
 */

export type Period = 'day' | 'week' | 'month' | 'year' | 'all'

export interface Range {
  /** включительно, epoch-мс UTC */
  start: number
  /** исключительно, epoch-мс UTC */
  end: number
}

export interface LocalDateParts {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number
  minute: number
  second: number
  /** 0 = воскресенье … 6 = суббота */
  weekday: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatterCache.set(timeZone, f)
  }
  return f
}

/** Проверяет, что зона существует; иначе возвращает запасную. */
export function safeTimeZone(timeZone: string | null | undefined, fallback = 'Asia/Dushanbe'): string {
  if (!timeZone) return fallback
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return fallback
  }
}

/** Разбирает момент времени в локальные части указанной зоны. */
export function partsInZone(instant: number, timeZone: string): LocalDateParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  // 24-часовой формат в ICU может отдать «24» вместо «00» на полуночи.
  const hour = Number(get('hour')) % 24
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  }
}

/** Смещение зоны относительно UTC в миллисекундах на конкретный момент. */
export function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = partsInZone(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  // Отбрасываем миллисекунды исходного момента: смещения зон кратны минуте.
  return asUtc - Math.floor(instant / 1000) * 1000
}

/**
 * UTC-момент локальной полуночи заданной календарной даты.
 * Две итерации нужны на случай перевода часов: первая оценка смещения
 * может быть взята с «неправильной» стороны перехода.
 */
export function zonedStartOfDay(
  timeZone: string,
  year: number,
  month: number,
  day: number,
): number {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0)
  let guess = naive - zoneOffsetMs(naive, timeZone)
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(guess, timeZone)
    const drift =
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - naive
    if (drift === 0) break
    guess -= drift
  }
  return guess
}

/** Начало локальных суток, в которые попадает момент. */
export function startOfDay(instant: number, timeZone: string): number {
  const p = partsInZone(instant, timeZone)
  return zonedStartOfDay(timeZone, p.year, p.month, p.day)
}

/** Сдвиг на n локальных суток (не 24 часа — важно при переводе часов). */
export function addDays(instant: number, days: number, timeZone: string): number {
  const p = partsInZone(instant, timeZone)
  return zonedStartOfDay(timeZone, p.year, p.month, p.day + days)
}

/**
 * Диапазон периода, содержащего `instant`.
 * `weekStart`: 1 = неделя с понедельника (принято в РФ/Таджикистане).
 */
export function rangeFor(
  period: Period,
  instant: number,
  timeZone: string,
  weekStart: number = 1,
): Range {
  const tz = safeTimeZone(timeZone)
  const p = partsInZone(instant, tz)

  switch (period) {
    case 'day': {
      const start = zonedStartOfDay(tz, p.year, p.month, p.day)
      return { start, end: zonedStartOfDay(tz, p.year, p.month, p.day + 1) }
    }
    case 'week': {
      const shift = (p.weekday - weekStart + 7) % 7
      const start = zonedStartOfDay(tz, p.year, p.month, p.day - shift)
      const end = zonedStartOfDay(tz, p.year, p.month, p.day - shift + 7)
      return { start, end }
    }
    case 'month': {
      const start = zonedStartOfDay(tz, p.year, p.month, 1)
      const end = zonedStartOfDay(tz, p.year, p.month + 1, 1)
      return { start, end }
    }
    case 'year': {
      const start = zonedStartOfDay(tz, p.year, 1, 1)
      const end = zonedStartOfDay(tz, p.year + 1, 1, 1)
      return { start, end }
    }
    case 'all':
      return { start: 0, end: instant + 86_400_000 }
  }
}

/** Предыдущий период такой же длины — для сравнения «месяц к месяцу». */
export function previousRange(
  period: Period,
  instant: number,
  timeZone: string,
  weekStart: number = 1,
): Range {
  const tz = safeTimeZone(timeZone)
  const current = rangeFor(period, instant, tz, weekStart)
  if (period === 'all') return current
  // Берём момент за секунду до начала текущего периода — он лежит в предыдущем.
  return rangeFor(period, current.start - 1000, tz, weekStart)
}

/** Ключ месяца вида «2026-09» в зоне пользователя. */
export function monthKey(instant: number, timeZone: string): string {
  const p = partsInZone(instant, safeTimeZone(timeZone))
  return `${p.year}-${String(p.month).padStart(2, '0')}`
}

/** Ключ дня вида «2026-09-03» в зоне пользователя. */
export function dayKey(instant: number, timeZone: string): string {
  const p = partsInZone(instant, safeTimeZone(timeZone))
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Разбирает «2026-09-03» обратно в UTC-момент локальной полуночи. */
export function dayKeyToInstant(key: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  return zonedStartOfDay(safeTimeZone(timeZone), Number(m[1]), Number(m[2]), Number(m[3]))
}

/** Сколько локальных дней в диапазоне. */
export function daysInRange(range: Range, timeZone: string): number {
  const tz = safeTimeZone(timeZone)
  let cursor = startOfDay(range.start, tz)
  let count = 0
  while (cursor < range.end && count < 400) {
    count++
    cursor = addDays(cursor, 1, tz)
  }
  return count
}

/** Список ключей дней диапазона по порядку — ось X графика. */
export function enumerateDays(range: Range, timeZone: string): string[] {
  const tz = safeTimeZone(timeZone)
  const out: string[] = []
  let cursor = startOfDay(range.start, tz)
  while (cursor < range.end && out.length < 400) {
    out.push(dayKey(cursor, tz))
    cursor = addDays(cursor, 1, tz)
  }
  return out
}

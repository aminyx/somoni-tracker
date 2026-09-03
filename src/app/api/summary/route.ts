/**
 * Данные для панели за выбранный период.
 *
 * Один запрос отдаёт всё, что рисует экран: итог, сравнение с прошлым
 * периодом, разбивку по дням и категориям и список трат. Так панель
 * перерисовывается целиком и не может показать несогласованные цифры.
 */
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/session'
import { expensesInRange, summarize } from '@/lib/stats'
import { dayKeyToInstant, rangeFor, type Period } from '@/lib/time'

export const dynamic = 'force-dynamic'

const PERIODS: Period[] = ['day', 'week', 'month']

export async function GET(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const url = new URL(request.url)
  const requested = url.searchParams.get('period') as Period | null
  const period: Period = requested && PERIODS.includes(requested) ? requested : 'month'

  // Момент, вокруг которого строится период. Приходит либо как день
  // («2026-09-03» — выбор дня на графике), либо как метка времени.
  const dayParam = url.searchParams.get('day')
  const atParam = url.searchParams.get('at')
  let at = Date.now()
  if (dayParam) {
    at = dayKeyToInstant(dayParam, user.timezone) ?? at
  } else if (atParam && Number.isFinite(Number(atParam))) {
    at = Number(atParam)
  }
  // В будущее не пускаем: пустые будущие месяцы выглядят как поломка.
  if (at > Date.now()) at = Date.now()

  const context = {
    id: user.id,
    timezone: user.timezone,
    baseCurrency: user.baseCurrency,
    weekStart: user.weekStart,
  }

  const summary = summarize(context, period, at)
  const range = rangeFor(period, at, user.timezone, user.weekStart)
  const rows = expensesInRange(user.id, range)

  return NextResponse.json({
    user: {
      firstName: user.firstName,
      username: user.username,
      timezone: user.timezone,
      baseCurrency: user.baseCurrency,
      firstExpenseAt: user.firstExpenseAt,
    },
    period,
    at,
    summary,
    // От новых к старым: лента читается сверху вниз.
    expenses: rows.slice().reverse(),
    now: Date.now(),
  })
}

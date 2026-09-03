/**
 * Выгрузка трат в CSV. Период — тот же, что и в панели.
 */
import { expensesToCsv, csvFilename } from '@/lib/csv'
import { currentUser } from '@/lib/session'
import { expensesInRange } from '@/lib/stats'
import { dayKeyToInstant, rangeFor, type Period } from '@/lib/time'

export const dynamic = 'force-dynamic'

const PERIODS: Period[] = ['day', 'week', 'month', 'year', 'all']

export async function GET(request: Request) {
  const user = await currentUser()
  if (!user) return new Response('Не авторизован', { status: 401 })

  const url = new URL(request.url)
  const requested = url.searchParams.get('period') as Period | null
  const period: Period = requested && PERIODS.includes(requested) ? requested : 'month'

  const day = url.searchParams.get('day')
  const at = (day ? dayKeyToInstant(day, user.timezone) : null) ?? Date.now()

  const range = rangeFor(period, at, user.timezone, user.weekStart)
  const rows = expensesInRange(user.id, range)
  const csv = expensesToCsv(rows, user.timezone, user.baseCurrency)
  const name = csvFilename('traty', at, user.timezone)

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      // filename* с UTF-8 — чтобы имя не ломалось; ASCII-вариант как запасной.
      'content-disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
    },
  })
}

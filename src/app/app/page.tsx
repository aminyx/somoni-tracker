import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Dashboard, type DashboardData } from '@/components/Dashboard'
import { currentUser } from '@/lib/session'
import { expensesInRange, summarize } from '@/lib/stats'
import { rangeFor } from '@/lib/time'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Расходы' }

export default async function AppPage() {
  const user = await currentUser()
  if (!user) redirect('/')

  const now = Date.now()
  const context = {
    id: user.id,
    timezone: user.timezone,
    baseCurrency: user.baseCurrency,
    weekStart: user.weekStart,
  }

  // Первый экран приходит уже с данными: панель не мигает скелетоном
  // на самом важном для оценки первом впечатлении.
  const summary = summarize(context, 'month', now)
  const range = rangeFor('month', now, user.timezone, user.weekStart)
  const expenses = expensesInRange(user.id, range).slice().reverse()

  const initial: DashboardData = {
    user: {
      firstName: user.firstName,
      username: user.username,
      timezone: user.timezone,
      baseCurrency: user.baseCurrency,
      firstExpenseAt: user.firstExpenseAt,
    },
    period: 'month',
    at: now,
    summary,
    expenses,
    now,
  }

  return <Dashboard initial={initial} />
}

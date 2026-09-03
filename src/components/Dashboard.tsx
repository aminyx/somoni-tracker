'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Expense } from '@/lib/db/schema'
import { formatMoney } from '@/lib/money'
import type { PeriodSummary } from '@/lib/stats'
import { dayKey, partsInZone, type Period } from '@/lib/time'
import { CategoryBlock } from './CategoryBlock'
import { DayRail } from './DayRail'
import { ExpenseList } from './ExpenseList'

export interface DashboardData {
  user: {
    firstName: string
    username: string | null
    timezone: string
    baseCurrency: string
    firstExpenseAt: number | null
  }
  period: Period
  at: number
  summary: PeriodSummary
  expenses: Expense[]
  now: number
}

const PERIOD_LABELS: Array<{ value: Period; label: string; title: string }> = [
  { value: 'day', label: 'Д', title: 'День' },
  { value: 'week', label: 'Н', title: 'Неделя' },
  { value: 'month', label: 'М', title: 'Месяц' },
]

const MONTHS_NOMINATIVE = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/** «1–3 сентября», «Сентябрь 2026» — период называется датами, а не словом. */
function periodTitle(period: Period, summary: PeriodSummary, timezone: string): string {
  const from = partsInZone(summary.range.start, timezone)
  const to = partsInZone(summary.range.end - 1000, timezone)
  if (period === 'day') return `${from.day} ${MONTHS_GENITIVE[from.month - 1]}`
  if (period === 'month') return `${MONTHS_NOMINATIVE[from.month - 1]} ${from.year}`
  if (from.month === to.month) return `${from.day}–${to.day} ${MONTHS_GENITIVE[from.month - 1]}`
  return `${from.day} ${MONTHS_GENITIVE[from.month - 1]} — ${to.day} ${MONTHS_GENITIVE[to.month - 1]}`
}

/**
 * Подпись сравнения. Именно «за те же N дней» — сравнение обрезано по числу
 * прошедших дней, и подпись обязана это проговаривать, иначе цифра выглядит
 * как сопоставление целых месяцев.
 */
function elapsedLabel(period: Period, summary: PeriodSummary, timezone: string): string {
  const days = summary.elapsedDays
  if (days <= 0) return ''
  const from = partsInZone(summary.range.start, timezone)
  if (period === 'month') {
    return `за те же ${days} ${plural(days, ['день', 'дня', 'дней'])} ${MONTHS_GENITIVE[(from.month + 10) % 12]}`
  }
  return `за те же ${days} ${plural(days, ['день', 'дня', 'дней'])} прошлого периода`
}

function plural(count: number, forms: [string, string, string]): string {
  const n = Math.abs(count) % 100
  const n1 = n % 10
  if (n > 10 && n < 20) return forms[2]
  if (n1 > 1 && n1 < 5) return forms[1]
  if (n1 === 1) return forms[0]
  return forms[2]
}

export function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial)
  const [period, setPeriod] = useState<Period>(initial.period)
  const [at, setAt] = useState(initial.at)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState(false)
  const [loading, setLoading] = useState(false)
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(
    async (nextPeriod: Period, nextAt: number, day?: string | null) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ period: nextPeriod })
        if (day) params.set('day', day)
        else params.set('at', String(nextAt))
        const response = await fetch(`/api/summary?${params}`, { cache: 'no-store' })
        if (response.status === 401) {
          window.location.href = '/'
          return
        }
        if (!response.ok) return
        setData((await response.json()) as DashboardData)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const refresh = useCallback(() => {
    void load(period, at, selectedDay)
  }, [load, period, at, selectedDay])

  function changePeriod(next: Period) {
    setPeriod(next)
    setSelectedDay(null)
    void load(next, at, null)
  }

  /** Шаг по периодам назад и вперёд. В будущее не пускаем. */
  function step(direction: -1 | 1) {
    const span = data.summary.range.end - data.summary.range.start
    const next = direction < 0 ? data.summary.range.start - 1000 : data.summary.range.end + span / 2
    if (direction > 0 && data.summary.range.end > Date.now()) return
    setAt(next)
    setSelectedDay(null)
    void load(period, next, null)
  }

  function selectDay(day: string | null) {
    setSelectedDay(day)
  }

  async function editExpense(id: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/expenses/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (response.ok) refresh()
  }

  async function removeExpense(id: string) {
    const target = data.expenses.find((e) => e.id === id)
    // Убираем строку сразу, не дожидаясь ответа: так интерфейс не «залипает».
    setData((current) => ({
      ...current,
      expenses: current.expenses.filter((e) => e.id !== id),
    }))
    const response = await fetch(`/api/expenses/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      refresh()
      return
    }
    setUndo({
      id,
      label: target?.description || 'Трата',
    })
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => {
      setUndo(null)
      refresh()
    }, 5000)
    refresh()
  }

  async function restore(id: string) {
    setUndo(null)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    await fetch(`/api/expenses/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restore: true }),
    })
    refresh()
  }

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
  }, [])

  const { summary, user } = data
  const todayKey = dayKey(data.now, user.timezone)

  // Выбранный день пересчитывает верхние блоки, но не перезагружает период:
  // так виден и день, и его место в месяце.
  const dayScoped = useMemo(() => {
    if (!selectedDay) return null
    const rows = data.expenses.filter((e) => dayKey(e.spentAt, user.timezone) === selectedDay)
    const total = rows.reduce((acc, e) => acc + e.baseMinor, 0)
    return { rows, total }
  }, [selectedDay, data.expenses, user.timezone])

  const heroTotal = dayScoped ? dayScoped.total : summary.totalMinor
  const heroCount = dayScoped ? dayScoped.rows.length : summary.count

  // Сравниваем с тем же числом прошедших дней прошлого периода.
  const previous = summary.previousComparableMinor
  const delta =
    previous > 0 && !dayScoped
      ? Math.round(((summary.totalMinor - previous) / previous) * 100)
      : null

  const isEmpty = summary.count === 0 && !loading

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-24">
      <header className="sticky top-0 z-20 flex h-11 items-center justify-between border-b border-[var(--border)] bg-[var(--bg)]/95 px-2 backdrop-blur">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => step(-1)}
            className="flex size-11 items-center justify-center text-[var(--text-2)]"
            aria-label="Предыдущий период"
          >
            ‹
          </button>
          <span className="px-1 text-[15px] font-semibold text-[var(--text-1)]">
            {selectedDay
              ? `${Number(selectedDay.split('-')[2])} ${MONTHS_GENITIVE[Number(selectedDay.split('-')[1]) - 1]}`
              : periodTitle(period, summary, user.timezone)}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={summary.range.end > Date.now()}
            className="flex size-11 items-center justify-center text-[var(--text-2)] disabled:opacity-35"
            aria-label="Следующий период"
          >
            ›
          </button>
        </div>

        <div className="flex gap-1 pr-1">
          {PERIOD_LABELS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => changePeriod(option.value)}
              title={option.title}
              className="h-11 w-9 rounded-[var(--r-sm)] text-[13px] font-medium transition-colors"
              style={{
                background: period === option.value ? 'var(--surface-2)' : 'transparent',
                color: period === option.value ? 'var(--text-1)' : 'var(--text-3)',
              }}
              aria-pressed={period === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <section className="px-4 pb-5 pt-6">
        <div className="eyebrow mb-2">
          {selectedDay ? 'Потрачено за день' : 'Потрачено'}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="num text-[40px] font-bold leading-none text-[var(--text-1)]">
            {formatMoney(heroTotal, user.baseCurrency, { withSymbol: false })}
          </span>
          <span className="text-[20px] font-medium text-[var(--text-2)]">
            {user.baseCurrency === 'TJS' ? 'смн' : user.baseCurrency}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          {delta !== null && Math.abs(delta) >= 3 ? (
            <span
              className="chip-in num inline-flex h-[22px] items-center rounded-[var(--r-sm)] px-2 font-medium"
              style={{
                background: delta < 0 ? 'var(--pos-bg)' : 'var(--neg-bg)',
                color: delta < 0 ? 'var(--pos)' : 'var(--neg)',
              }}
            >
              {delta < 0 ? '↓' : '↑'} {Math.abs(delta)}%
            </span>
          ) : delta !== null ? (
            <span className="inline-flex h-[22px] items-center rounded-[var(--r-sm)] bg-[var(--surface-2)] px-2 text-[var(--text-2)]">
              ≈ так же
            </span>
          ) : null}

          <span className="text-[var(--text-2)]">
            {delta !== null
              ? `${elapsedLabel(period, summary, user.timezone)} — ${formatMoney(previous, user.baseCurrency)}`
              : heroCount > 0
                ? `${heroCount} ${plural(heroCount, ['трата', 'траты', 'трат'])}`
                : ''}
          </span>
        </div>

        {selectedDay ? (
          <button
            type="button"
            onClick={() => setSelectedDay(null)}
            className="mt-3 text-[13px] text-[var(--accent-ink)] underline underline-offset-4"
          >
            показать весь период
          </button>
        ) : null}
      </section>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {period !== 'day' ? (
            <DayRail
              days={summary.byDay}
              currency={user.baseCurrency}
              todayKey={todayKey}
              selectedDay={selectedDay}
              onSelectDay={selectDay}
            />
          ) : null}

          <CategoryBlock
            categories={summary.byCategory}
            totalCount={summary.count}
            currency={user.baseCurrency}
            expanded={expandedCategories}
            onToggle={() => setExpandedCategories((v) => !v)}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
          />

          <ExpenseList
            expenses={
              selectedDay
                ? data.expenses.filter((e) => dayKey(e.spentAt, user.timezone) === selectedDay)
                : data.expenses
            }
            timezone={user.timezone}
            baseCurrency={user.baseCurrency}
            now={data.now}
            filterCategory={selectedCategory}
            onEdit={editExpense}
            onDelete={removeExpense}
          />

          <footer className="flex items-center justify-between px-4 py-6 text-[13px]">
            <a
              href={`/api/export?period=${period}`}
              className="text-[var(--text-2)] underline underline-offset-4"
            >
              Скачать CSV
            </a>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="text-[var(--text-3)]">
                Выйти
              </button>
            </form>
          </footer>
        </>
      )}

      {undo ? (
        <div className="toast-in fixed inset-x-4 bottom-6 z-30 mx-auto flex max-w-md items-center justify-between rounded-[var(--r-lg)] bg-[var(--surface-2)] px-4 py-3 shadow-lg">
          <span className="truncate text-[14px] text-[var(--text-1)]">Удалено: {undo.label}</span>
          <button
            type="button"
            onClick={() => void restore(undo.id)}
            className="ml-3 shrink-0 text-[14px] font-semibold text-[var(--accent-ink)]"
          >
            Вернуть
          </button>
        </div>
      ) : null}
    </div>
  )
}

function EmptyState() {
  return (
    <section className="flex flex-col items-center px-6 py-16 text-center">
      <div className="num mb-5 text-[48px] leading-none text-[var(--text-3)]">смн</div>
      <h2 className="mb-2 text-[17px] font-semibold text-[var(--text-1)]">
        Здесь появятся траты
      </h2>
      <p className="max-w-[280px] text-[15px] leading-relaxed text-[var(--text-2)]">
        Напишите боту «кофе 350» — и она окажется на этом экране через секунду.
      </p>
    </section>
  )
}

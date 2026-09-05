'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Expense } from '@/lib/db/schema'
import { formatMoney } from '@/lib/money'
import type { PeriodSummary } from '@/lib/stats'
import {
  EXAMPLES,
  MONTHS_GENITIVE,
  MONTHS_NOMINATIVE,
  t,
  tPlural,
  type Locale,
} from '@/lib/i18n'
import { dayKey, partsInZone, type Period } from '@/lib/time'
import { CategoryBlock } from './CategoryBlock'
import { DayRail } from './DayRail'
import { ExpenseList } from './ExpenseList'
import { ThemeToggle } from './ThemeToggle'

export interface DashboardData {
  user: {
    firstName: string
    username: string | null
    timezone: string
    baseCurrency: string
    firstExpenseAt: number | null
    locale: Locale
  }
  period: Period
  at: number
  summary: PeriodSummary
  expenses: Expense[]
  now: number
}

/** Переключатель периода. Подпись — первая буква слова на своём языке. */
function periodOptions(locale: Locale): Array<{ value: Period; label: string; title: string }> {
  const titles = {
    day: t(locale, 'web.day'),
    week: t(locale, 'web.week'),
    month: t(locale, 'web.month'),
  }
  return (['day', 'week', 'month'] as const).map((value) => ({
    value,
    label: titles[value].slice(0, 1).toUpperCase(),
    title: titles[value],
  }))
}

/** «1–3 сентября», «Сентябрь 2026» — период называется датами, а не словом. */
function periodTitle(
  period: Period,
  summary: PeriodSummary,
  timezone: string,
  locale: Locale,
): string {
  const from = partsInZone(summary.range.start, timezone)
  const to = partsInZone(summary.range.end - 1000, timezone)
  const gen = MONTHS_GENITIVE[locale]
  if (period === 'day') return `${from.day} ${gen[from.month - 1]}`
  if (period === 'month') return `${MONTHS_NOMINATIVE[locale][from.month - 1]} ${from.year}`
  if (from.month === to.month) return `${from.day}–${to.day} ${gen[from.month - 1]}`
  return `${from.day} ${gen[from.month - 1]} — ${to.day} ${gen[to.month - 1]}`
}

/**
 * Подпись сравнения. Именно «за те же N дней» — сравнение обрезано по числу
 * прошедших дней, и подпись обязана это проговаривать, иначе цифра выглядит
 * как сопоставление целых месяцев.
 */
function elapsedLabel(
  period: Period,
  summary: PeriodSummary,
  timezone: string,
  locale: Locale,
): string {
  const count = summary.elapsedDays
  if (count <= 0) return ''
  const days = `${count} ${tPlural(locale, 'plural.day', count)}`
  if (period === 'month') {
    const from = partsInZone(summary.range.start, timezone)
    return t(locale, 'web.sameDaysMonth', {
      days,
      month: MONTHS_GENITIVE[locale][(from.month + 10) % 12]!,
    })
  }
  return t(locale, 'web.sameDaysPeriod', { days })
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
  // Номер запроса. Пользователь может быстро нажать «Д», потом «М» — ответ
  // на первый запрос придёт позже и затёр бы данные второго.
  const requestId = useRef(0)

  const load = useCallback(
    async (nextPeriod: Period, nextAt: number, day?: string | null) => {
      const id = ++requestId.current
      setLoading(true)
      try {
        const params = new URLSearchParams({ period: nextPeriod })
        if (day) params.set('day', day)
        else params.set('at', String(nextAt))
        const response = await fetch(`/api/summary?${params}`, { cache: 'no-store' })
        // Пока ждали, пользователь мог переключить период — этот ответ устарел.
        if (id !== requestId.current) return
        if (response.status === 401) {
          window.location.href = '/'
          return
        }
        if (!response.ok) return
        const payload = (await response.json()) as DashboardData
        if (id !== requestId.current) return
        setData(payload)
      } finally {
        if (id === requestId.current) setLoading(false)
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
      label: target?.description || t(L, 'web.expense'),
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
  const L = user.locale
  const todayKey = dayKey(data.now, user.timezone)

  // Выбранный день пересчитывает верхние блоки, но не перезагружает период:
  // так виден и день, и его место в месяце.
  const dayScoped = useMemo(() => {
    if (!selectedDay) return null
    const rows = data.expenses.filter((e) => dayKey(e.spentAt, user.timezone) === selectedDay)
    const total = rows.reduce((acc, e) => acc + e.baseMinor, 0)

    // Разбивка по категориям тоже обязана пересчитаться. Иначе на экране
    // рядом стоят «230 смн за день» и категории за весь месяц — и цифры
    // перестают сходиться на глазах у читателя.
    const byCategory = new Map<string, { totalMinor: number; count: number }>()
    for (const row of rows) {
      const entry = byCategory.get(row.category) ?? { totalMinor: 0, count: 0 }
      entry.totalMinor += row.baseMinor
      entry.count += 1
      byCategory.set(row.category, entry)
    }
    const categories = [...byCategory.entries()]
      .map(([category, value]) => ({
        category,
        totalMinor: value.totalMinor,
        count: value.count,
        share: total ? (value.totalMinor / total) * 100 : 0,
      }))
      .sort((a, b) => b.totalMinor - a.totalMinor)

    return { rows, total, categories }
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
            aria-label={t(L, 'web.prevPeriod')}
          >
            ‹
          </button>
          <span className="px-1 text-[15px] font-semibold text-[var(--text-1)]">
            {selectedDay
              ? `${Number(selectedDay.split('-')[2])} ${MONTHS_GENITIVE[L][Number(selectedDay.split('-')[1]) - 1]}`
              : periodTitle(period, summary, user.timezone, L)}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={summary.range.end > Date.now()}
            className="flex size-11 items-center justify-center text-[var(--text-2)] disabled:opacity-35"
            aria-label={t(L, 'web.nextPeriod')}
          >
            ›
          </button>
        </div>

        <div className="flex gap-1 pr-1">
          {periodOptions(L).map((option) => (
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
          {selectedDay ? t(L, 'web.spentDay') : t(L, 'web.spent')}
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
              {t(L, 'web.almostSame')}
            </span>
          ) : null}

          <span className="text-[var(--text-2)]">
            {delta !== null
              ? `${elapsedLabel(period, summary, user.timezone, L)} — ${formatMoney(previous, user.baseCurrency)}`
              : heroCount > 0
                ? `${heroCount} ${tPlural(L, 'plural.expense', heroCount)}`
                : ''}
          </span>
        </div>

        {selectedDay ? (
          <button
            type="button"
            onClick={() => setSelectedDay(null)}
            className="mt-3 text-[13px] text-[var(--accent-ink)] underline underline-offset-4"
          >
            {t(L, 'web.showAll')}
          </button>
        ) : null}
      </section>

      {isEmpty ? (
        <EmptyState locale={L} />
      ) : (
        <>
          {period !== 'day' ? (
            <DayRail
              days={summary.byDay}
              currency={user.baseCurrency}
              todayKey={todayKey}
              selectedDay={selectedDay}
              onSelectDay={selectDay}
              locale={L}
            />
          ) : null}

          <CategoryBlock
            categories={dayScoped ? dayScoped.categories : summary.byCategory}
            totalCount={dayScoped ? dayScoped.rows.length : summary.count}
            currency={user.baseCurrency}
            expanded={expandedCategories}
            onToggle={() => setExpandedCategories((v) => !v)}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            locale={L}
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
            locale={L}
          />

          <footer className="flex items-center justify-between px-4 py-6 text-[13px]">
            <a
              href={`/api/export?period=${period}`}
              className="text-[var(--text-2)] underline underline-offset-4"
            >
              {t(L, 'web.downloadCsv')}
            </a>
            <div className="flex items-center gap-4">
              <ThemeToggle locale={L} />
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="text-[var(--text-3)]">
                  {t(L, 'web.logout')}
                </button>
              </form>
            </div>
          </footer>
        </>
      )}

      {undo ? (
        <div className="toast-in fixed inset-x-4 bottom-6 z-30 mx-auto flex max-w-md items-center justify-between rounded-[var(--r-lg)] bg-[var(--surface-2)] px-4 py-3 shadow-lg">
          <span className="truncate text-[14px] text-[var(--text-1)]">
            {t(L, 'web.deletedToast', { label: undo.label })}
          </span>
          <button
            type="button"
            onClick={() => void restore(undo.id)}
            className="ml-3 shrink-0 text-[14px] font-semibold text-[var(--accent-ink)]"
          >
            {t(L, 'web.restore')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function EmptyState({ locale }: { locale: Locale }) {
  return (
    <section className="flex flex-col items-center px-6 py-16 text-center">
      <div className="num mb-5 text-[48px] leading-none text-[var(--text-3)]">смн</div>
      <h2 className="mb-2 text-[17px] font-semibold text-[var(--text-1)]">
        {t(locale, 'web.emptyTitle')}
      </h2>
      <p className="max-w-[280px] text-[15px] leading-relaxed text-[var(--text-2)]">
        {t(locale, 'web.emptyBody', { example: EXAMPLES[locale].one })}
      </p>
    </section>
  )
}

'use client'

import { useState } from 'react'
import { CATEGORIES, categoryBySlug } from '@/lib/categories'
import type { Expense } from '@/lib/db/schema'
import { formatMoney, fromMinor } from '@/lib/money'
import { dayKey, partsInZone } from '@/lib/time'

/**
 * Лента трат с правкой на месте.
 *
 * Правка раскрывается прямо в строке, а не в модальном окне: модалка
 * закрывает собой цифры, ради которых пользователь сюда пришёл.
 *
 * Удаление происходит сразу, без вопроса «вы уверены», но с кнопкой
 * «вернуть» на пять секунд. Диалог подтверждения ради траты на 250 сомони —
 * это трение ради вида, а отмена честно решает ту же задачу.
 */

interface Props {
  expenses: Expense[]
  timezone: string
  baseCurrency: string
  now: number
  filterCategory: string | null
  onEdit: (id: string, patch: Record<string, unknown>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

function dayHeading(key: string, timezone: string, now: number): string {
  const todayKey = dayKey(now, timezone)
  const yesterdayKey = dayKey(now - 86_400_000, timezone)
  if (key === todayKey) return 'Сегодня'
  if (key === yesterdayKey) return 'Вчера'
  const [year, month, day] = key.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()]
  return `${day} ${MONTHS_GENITIVE[month! - 1]}, ${weekday}`
}

function timeLabel(instant: number, timezone: string): string {
  const p = partsInZone(instant, timezone)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

export function ExpenseList({
  expenses,
  timezone,
  baseCurrency,
  now,
  filterCategory,
  onEdit,
  onDelete,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null)

  const visible = filterCategory
    ? expenses.filter((e) => e.category === filterCategory)
    : expenses

  if (visible.length === 0) {
    return (
      <section className="border-t border-[var(--border)] px-4 py-10 text-center">
        <p className="text-[15px] text-[var(--text-2)]">
          {filterCategory ? 'В этой категории пока пусто.' : 'За период трат нет.'}
        </p>
      </section>
    )
  }

  // Группировка по локальным дням: заголовок дня несёт свой итог,
  // чтобы сумма в ленте сходилась с графиком.
  const groups = new Map<string, Expense[]>()
  for (const expense of visible) {
    const key = dayKey(expense.spentAt, timezone)
    const list = groups.get(key)
    if (list) list.push(expense)
    else groups.set(key, [expense])
  }

  return (
    <section className="border-t border-[var(--border)]">
      {[...groups.entries()].map(([key, rows]) => {
        const dayTotal = rows.reduce((acc, r) => acc + r.baseMinor, 0)
        return (
          <div key={key}>
            <div className="sticky top-[44px] z-10 flex items-baseline justify-between bg-[var(--bg)]/95 px-4 py-2 backdrop-blur">
              <span className="eyebrow">{dayHeading(key, timezone, now)}</span>
              <span className="num text-[13px] text-[var(--text-2)]">
                {formatMoney(dayTotal, baseCurrency)}
              </span>
            </div>

            <ul>
              {rows.map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  timezone={timezone}
                  baseCurrency={baseCurrency}
                  open={openId === expense.id}
                  onOpen={() => setOpenId(openId === expense.id ? null : expense.id)}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

function ExpenseRow({
  expense,
  timezone,
  baseCurrency,
  open,
  onOpen,
  onEdit,
  onDelete,
}: {
  expense: Expense
  timezone: string
  baseCurrency: string
  open: boolean
  onOpen: () => void
  onEdit: (id: string, patch: Record<string, unknown>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const category = categoryBySlug(expense.category)
  const [amount, setAmount] = useState(String(fromMinor(expense.amountMinor, expense.currency)))
  const [description, setDescription] = useState(expense.description)
  const [saving, setSaving] = useState(false)

  async function save(patch: Record<string, unknown>) {
    setSaving(true)
    try {
      await onEdit(expense.id, patch)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="border-t border-[var(--border)] first:border-t-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-14 w-full items-center gap-3 px-4 text-left"
        style={{ touchAction: 'manipulation' }}
        aria-expanded={open}
      >
        <span
          className="cat-color size-2 shrink-0 rounded-full"
          style={
            { '--cat': category.color, '--cat-light': category.colorLight } as React.CSSProperties
          }
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] text-[var(--text-1)]">
            {expense.description || category.name}
          </span>
          <span className="block text-[13px] text-[var(--text-3)]">
            {category.name} · {timeLabel(expense.spentAt, timezone)}
          </span>
        </span>
        <span className="num shrink-0 text-right text-[15px] text-[var(--text-1)]">
          {formatMoney(expense.amountMinor, expense.currency)}
          {expense.currency !== baseCurrency ? (
            <span className="block text-[12px] text-[var(--text-3)]">
              ≈ {formatMoney(expense.baseMinor, baseCurrency)}
            </span>
          ) : null}
        </span>
      </button>

      {open ? (
        <div className="bg-[var(--surface)] px-4 pb-4 pt-1">
          <div className="mb-3 flex gap-2">
            <label className="flex-1">
              <span className="eyebrow mb-1 block">Сумма</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                onBlur={() => {
                  const parsed = Number(amount.replace(',', '.'))
                  if (Number.isFinite(parsed) && parsed > 0) void save({ amount: parsed })
                }}
                className="num h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--bg)] px-3 text-[18px] text-[var(--text-1)] outline-none"
              />
            </label>
            <label className="flex-[2]">
              <span className="eyebrow mb-1 block">Описание</span>
              <input
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={() => {
                  if (description !== expense.description) void save({ description })
                }}
                className="h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--bg)] px-3 text-[15px] text-[var(--text-1)] outline-none"
              />
            </label>
          </div>

          <span className="eyebrow mb-2 block">Категория</span>
          <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {CATEGORIES.map((option) => {
              const active = option.slug === expense.category
              return (
                <button
                  key={option.slug}
                  type="button"
                  onClick={() => void save({ category: option.slug })}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--r-sm)] border px-3 text-[13px] transition-colors"
                  style={{
                    borderColor: active ? 'var(--border-strong)' : 'var(--border)',
                    color: active ? 'var(--text-1)' : 'var(--text-2)',
                    background: active ? 'var(--surface-2)' : 'transparent',
                  }}
                >
                  <span aria-hidden>{option.emoji}</span>
                  {option.name}
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--text-3)]">
              {saving ? 'сохраняю…' : 'изменения сохраняются сразу'}
            </span>
            <button
              type="button"
              onClick={() => void onDelete(expense.id)}
              className="h-9 rounded-[var(--r-sm)] px-3 text-[13px] font-medium text-[var(--neg)]"
            >
              Удалить
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

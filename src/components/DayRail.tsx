'use client'

import { useMemo } from 'react'
import { formatMoney } from '@/lib/money'
import type { DayTotal } from '@/lib/stats'

/**
 * Столбики по дням.
 *
 * Три решения, которые здесь важнее внешнего вида:
 *
 * 1. Рисуются ВСЕ дни периода, включая пустые — обрубком в 2 пикселя.
 *    Если показывать только дни с тратами, три покупки выглядят как плотный
 *    месяц. Это самая распространённая тихая ложь в трекерах расходов.
 * 2. Столбики растут от нуля. Обрезанная ось искажает восприятие величин.
 * 3. Никаких всплывающих подсказок: на телефоне их нечем вызвать. Вместо
 *    этого тап по столбику переключает весь экран на этот день.
 */

interface Props {
  days: DayTotal[]
  currency: string
  todayKey: string
  selectedDay: string | null
  onSelectDay: (day: string | null) => void
}

const MONTHS_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
]

function shortLabel(dayKey: string): string {
  const [, month, day] = dayKey.split('-')
  return `${Number(day)} ${MONTHS_SHORT[Number(month) - 1]}`
}

export function DayRail({ days, currency, todayKey, selectedDay, onSelectDay }: Props) {
  const { max, average, maxDay } = useMemo(() => {
    const values = days.map((d) => d.totalMinor)
    const peak = Math.max(0, ...values)
    // Среднее считаем по прошедшим дням, а не по всей длине месяца:
    // третьего числа «в среднем 4 смн в день» — это неправда.
    const elapsed = days.filter((d) => d.day <= todayKey)
    const spent = elapsed.reduce((acc, d) => acc + d.totalMinor, 0)
    const top = days.reduce<DayTotal | null>(
      (best, d) => (d.totalMinor > (best?.totalMinor ?? 0) ? d : best),
      null,
    )
    return {
      max: peak,
      average: elapsed.length > 0 ? spent / elapsed.length : 0,
      maxDay: top,
    }
  }, [days, todayKey])

  // Запас сверху, чтобы самый высокий столбик не упирался в подпись.
  const scale = max > 0 ? max * 1.15 : 1
  const gap = days.length > 14 ? 2.5 : 8

  return (
    <section className="px-4 pb-5 pt-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[13px] font-medium text-[var(--text-2)]">По дням</h2>
        {maxDay && maxDay.totalMinor > 0 ? (
          // Эта строка заменяет собой ось Y: одно число вместо пяти подписей.
          <span className="num text-[12px] text-[var(--text-2)]">
            макс. {formatMoney(maxDay.totalMinor, currency)} · {shortLabel(maxDay.day)}
          </span>
        ) : null}
      </header>

      <div className="relative">
        <div
          className="relative flex h-[88px] items-end border-b border-[var(--border)]"
          style={{ gap: `${gap}px` }}
        >
          {average > 0 && days.filter((d) => d.totalMinor > 0).length >= 2 ? (
            <div
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--text-3)]"
              style={{ bottom: `${Math.min(100, (average / scale) * 100)}%` }}
              aria-hidden
            />
          ) : null}

          {days.map((day) => {
            const isToday = day.day === todayKey
            const isSelected = selectedDay === day.day
            const dimmed = selectedDay !== null && !isSelected
            const height = day.totalMinor > 0 ? Math.max(3, (day.totalMinor / scale) * 100) : 0

            return (
              <button
                key={day.day}
                type="button"
                onClick={() => onSelectDay(isSelected ? null : day.day)}
                // Область нажатия во всю высоту: столбик в 9 пикселей
                // пальцем не поймать.
                className="group relative h-full min-w-[6px] max-w-[32px] flex-1 cursor-pointer"
                style={{ touchAction: 'manipulation' }}
                aria-label={`${shortLabel(day.day)}: ${formatMoney(day.totalMinor, currency)}`}
                aria-pressed={isSelected}
              >
                {day.totalMinor > 0 ? (
                  <span
                    className="bar-grow absolute inset-x-0 bottom-0 rounded-t-[3px] transition-opacity"
                    style={{
                      height: `${height}%`,
                      background: isSelected || isToday ? 'var(--accent)' : 'var(--bar)',
                      opacity: dimmed ? 0.45 : 1,
                    }}
                  />
                ) : (
                  // Пустой день — не пропуск, а видимый обрубок.
                  <span
                    className="absolute inset-x-0 bottom-0 h-[2px] rounded-t-[1px] bg-[var(--grid)]"
                    aria-hidden
                  />
                )}
              </button>
            )
          })}
        </div>

        {average > 0 && days.filter((d) => d.totalMinor > 0).length >= 2 ? (
          <div
            className="num pointer-events-none absolute right-0 -translate-y-1/2 bg-[var(--bg)] pl-1 text-[11px] text-[var(--text-3)]"
            style={{ bottom: `${Math.min(100, (average / scale) * 100)}%` }}
          >
            ср. {formatMoney(Math.round(average), currency)}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-[var(--text-3)]">
        <span>{days.length > 0 ? shortLabel(days[0]!.day) : ''}</span>
        {days.length > 6 ? (
          <span>{shortLabel(days[Math.floor(days.length / 2)]!.day)}</span>
        ) : null}
        <span>{days.length > 1 ? shortLabel(days[days.length - 1]!.day) : ''}</span>
      </div>
    </section>
  )
}

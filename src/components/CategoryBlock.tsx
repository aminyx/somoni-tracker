'use client'

import { categoryBySlug, categoryName } from '@/lib/categories'
import { t, tPlural, type Locale } from '@/lib/i18n'
import { formatMoney } from '@/lib/money'
import type { CategoryTotal } from '@/lib/stats'

/**
 * Разбивка по категориям — горизонтальные строки, а не кольцо.
 *
 * Кольцо здесь проигрывает по трём причинам: русские названия категорий
 * длинные и требуют легенды, которая съедает пол-экрана; задача читателя —
 * сравнить величины, а это лучше делают полосы; и главное — при одной
 * трате кольцо превращается в сплошной круг и выглядит сломанным.
 *
 * Часть «доля от целого» при этом не теряется: её берёт на себя полоска
 * в шесть пикселей сверху. Столько и стоит эта информация.
 */

interface Props {
  categories: CategoryTotal[]
  totalCount: number
  currency: string
  expanded: boolean
  onToggle: () => void
  onSelect: (slug: string | null) => void
  selected: string | null
  locale: Locale
}

const VISIBLE = 4

export function CategoryBlock({
  categories,
  totalCount,
  currency,
  expanded,
  onToggle,
  onSelect,
  selected,
  locale,
}: Props) {
  if (categories.length === 0) return null

  const shown = expanded ? categories : categories.slice(0, VISIBLE)
  const rest = categories.slice(VISIBLE)
  const restTotal = rest.reduce((acc, row) => acc + row.totalMinor, 0)

  return (
    <section className="border-t border-[var(--border)] px-4 pb-2 pt-5">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="eyebrow">{t(locale, 'web.categories')}</h2>
        <span className="num text-[12px] text-[var(--text-2)]">
          {totalCount} {tPlural(locale, 'plural.expense', totalCount)}
        </span>
      </header>

      <div className="mb-4 flex h-[6px] gap-[2px] overflow-hidden rounded-[3px]" aria-hidden>
        {categories.map((row) => (
          <span
            key={row.category}
            className="cat-color min-w-[6px] rounded-[3px]"
            style={
              {
                width: `${row.share}%`,
                '--cat': categoryBySlug(row.category).color,
                '--cat-light': categoryBySlug(row.category).colorLight,
                opacity: selected && selected !== row.category ? 0.3 : 1,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <ul>
        {shown.map((row) => {
          const category = categoryBySlug(row.category)
          const isSelected = selected === row.category
          return (
            <li key={row.category}>
              <button
                type="button"
                onClick={() => onSelect(isSelected ? null : row.category)}
                className="flex h-10 w-full items-center gap-2 text-left"
                style={{ touchAction: 'manipulation' }}
                aria-pressed={isSelected}
              >
                <span
                  className="cat-color size-2 shrink-0 rounded-full"
                  style={
                    { '--cat': category.color, '--cat-light': category.colorLight } as React.CSSProperties
                  }
                  aria-hidden
                />
                {/* min-w-0 + truncate, а не shrink-0: на экране 320 px
                    «Связь и интернет» иначе выдавливает колонку процентов
                    за край. Лучше подрезать название, чем потерять число. */}
                <span
                  className="min-w-0 truncate text-[15px] text-[var(--text-1)]"
                  style={{ opacity: selected && !isSelected ? 0.5 : 1 }}
                >
                  {categoryName(row.category, locale)}
                </span>
                {/* Отточие: ведёт глаз через пустоту от названия к сумме.
                    Устройство из бумажного чека, и оно делает реальную работу
                    на узком экране. */}
                <span className="leader" aria-hidden />
                <span className="num w-[88px] shrink-0 text-right text-[15px] text-[var(--text-1)]">
                  {formatMoney(row.totalMinor, currency)}
                </span>
                <span className="num w-[36px] shrink-0 text-right text-[13px] text-[var(--text-3)]">
                  {Math.round(row.share)}%
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {rest.length > 0 ? (
        <button
          type="button"
          onClick={onToggle}
          className="flex h-10 w-full items-center justify-between text-[13px] text-[var(--text-2)]"
        >
          <span>
            {expanded
              ? t(locale, 'web.collapse')
              : t(locale, 'web.moreCategories', {
                  count: rest.length,
                  plural: tPlural(locale, 'plural.category', rest.length),
                })}
          </span>
          <span className="num text-[13px] text-[var(--text-3)]">
            {expanded ? '' : formatMoney(restTotal, currency)}
          </span>
        </button>
      ) : null}
    </section>
  )
}

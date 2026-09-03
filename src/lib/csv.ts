/**
 * Выгрузка трат в CSV.
 *
 * Два решения приняты ради Excel с русской локалью:
 *  • разделитель — точка с запятой: в ru-RU Excel запятая занята под дробную
 *    часть, и файл с запятыми открывается одной колонкой;
 *  • в начало файла ставится BOM, иначе кириллица превращается в кракозябры.
 * В LibreOffice и Google Sheets такой файл тоже открывается корректно.
 */
import { categoryBySlug } from './categories'
import type { Expense } from './db/schema'
import { fromMinor } from './money'
import { partsInZone } from './time'

const BOM = '﻿'
const SEP = ';'

const COLUMNS = [
  'Дата',
  'Время',
  'Описание',
  'Категория',
  'Сумма',
  'Валюта',
  'Сумма в базовой валюте',
  'Базовая валюта',
  'Курс',
  'Источник',
] as const

function cell(value: string | number): string {
  const text = String(value)
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/** Число с запятой в качестве дробного разделителя — так ждёт русский Excel. */
function decimal(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',')
}

export function expensesToCsv(
  rows: Expense[],
  timezone: string,
  baseCurrency: string,
): string {
  const lines = [COLUMNS.join(SEP)]

  for (const row of rows) {
    const p = partsInZone(row.spentAt, timezone)
    const date = `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`
    const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`

    lines.push(
      [
        date,
        time,
        cell(row.description || ''),
        cell(categoryBySlug(row.category).name),
        decimal(fromMinor(row.amountMinor, row.currency)),
        row.currency,
        decimal(fromMinor(row.baseMinor, baseCurrency)),
        baseCurrency,
        decimal(row.rate, 4),
        row.source,
      ].join(SEP),
    )
  }

  // \r\n — Excel на Windows иначе иногда склеивает последнюю строку.
  return BOM + lines.join('\r\n') + '\r\n'
}

/** Имя файла вида «траты-2026-09.csv». */
export function csvFilename(prefix: string, instant: number, timezone: string): string {
  const p = partsInZone(instant, timezone)
  return `${prefix}-${p.year}-${String(p.month).padStart(2, '0')}.csv`
}

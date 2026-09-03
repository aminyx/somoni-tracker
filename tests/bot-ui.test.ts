/**
 * Тексты бота отправляются с parse_mode: HTML. Любая строка, пришедшая
 * от пользователя, обязана быть экранирована — иначе описание вида
 * «<b>кофе» ломает разметку, и Telegram отклоняет сообщение целиком:
 * трата сохранена, а подтверждения нет.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Expense } from '../src/lib/db/schema.ts'
import {
  categoryKeyboard,
  deletedCard,
  esc,
  expenseCard,
  expenseKeyboard,
  humanTime,
  limitMessage,
  periodLabel,
  plural,
  report,
} from '../src/bot/ui.ts'
import type { PeriodSummary } from '../src/lib/stats.ts'

const TZ = 'Asia/Dushanbe'

/**
 * formatMoney разделяет число и символ валюты неразрывным пробелом —
 * так строка не переносится посередине суммы. Для сравнения в тестах
 * приводим их к обычным пробелам.
 */
function plain(text: string): string {
  return text.replace(/[   ]/g, ' ')
}

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'abc123def456xyz',
    userId: 1,
    amountMinor: 35000,
    currency: 'TJS',
    baseMinor: 35000,
    rate: 1,
    category: 'eating_out',
    description: 'кофе',
    spentAt: Date.UTC(2026, 8, 3, 9, 5),
    createdAt: Date.UTC(2026, 8, 3, 9, 5),
    updatedAt: Date.UTC(2026, 8, 3, 9, 5),
    deletedAt: null,
    source: 'bot',
    rawText: 'кофе 350',
    chatId: 1,
    messageId: 1,
    ...overrides,
  } as Expense
}

function makeSummary(overrides: Partial<PeriodSummary> = {}): PeriodSummary {
  return {
    period: 'month',
    range: { start: Date.UTC(2026, 7, 31, 19), end: Date.UTC(2026, 8, 30, 19) },
    totalMinor: 40660,
    count: 8,
    currency: 'TJS',
    byCategory: [
      { category: 'groceries', totalMinor: 15000, count: 2, share: 36.9 },
      { category: 'transport', totalMinor: 2660, count: 3, share: 6.5 },
    ],
    byDay: [],
    previousTotalMinor: 42120,
    previousComparableMinor: 42120,
    elapsedDays: 3,
    averagePerDayMinor: 13553,
    topDay: null,
    ...overrides,
  } as PeriodSummary
}

test('esc закрывает угловые скобки и амперсанд', () => {
  assert.equal(esc('<b>x</b> & y'), '&lt;b&gt;x&lt;/b&gt; &amp; y')
})

test('описание с разметкой не ломает карточку', () => {
  const card = expenseCard(
    makeExpense({ description: '<b>кофе</b> & чай' }),
    TZ,
    35000,
    1,
    'TJS',
  )
  assert.ok(!card.includes('<b>кофе</b>'), 'сырой тег пользователя не должен попадать в текст')
  assert.ok(card.includes('&lt;b&gt;кофе&lt;/b&gt;'))
  assert.ok(card.includes('&amp;'))
})

test('незакрытый тег в описании тоже экранируется', () => {
  const card = expenseCard(makeExpense({ description: 'кофе <i' }), TZ, 100, 1, 'TJS')
  assert.ok(card.includes('кофе &lt;i'))
})

test('карточка удаления экранирует описание', () => {
  const card = deletedCard(makeExpense({ description: '<script>x</script>' }))
  assert.ok(!card.includes('<script>'))
  assert.ok(card.includes('&lt;script&gt;'))
})

test('в карточке видна сумма, категория и итог за день', () => {
  const card = plain(expenseCard(makeExpense(), TZ, 40660, 8, 'TJS'))
  assert.match(card, /350 смн/)
  assert.match(card, /Кафе и еда вне дома/)
  assert.match(card, /406,60 смн/)
  assert.match(card, /8 трат/)
})

test('трата в другой валюте показывает пересчёт и курс', () => {
  const card = plain(
    expenseCard(
      makeExpense({ currency: 'USD', amountMinor: 1000, baseMinor: 9238, rate: 9.2382 }),
      TZ,
      9238,
      1,
      'TJS',
    ),
  )
  assert.match(card, /10 \$/)
  assert.match(card, /92,38 смн/)
  assert.match(card, /9\.2382/)
})

test('кнопки под карточкой умещаются в лимит callback_data в 64 байта', () => {
  const keyboard = expenseKeyboard(makeExpense(), ['groceries', 'transport'])
  const buttons = keyboard.inline_keyboard.flat()
  assert.ok(buttons.length >= 3)
  for (const button of buttons) {
    if ('callback_data' in button && button.callback_data) {
      assert.ok(
        Buffer.byteLength(button.callback_data, 'utf8') <= 64,
        `слишком длинное callback_data: ${button.callback_data}`,
      )
    }
  }
})

test('меню категорий тоже укладывается в лимит', () => {
  for (const page of [0, 1]) {
    for (const button of categoryKeyboard('abc123def456xyz', page).inline_keyboard.flat()) {
      if ('callback_data' in button && button.callback_data) {
        assert.ok(Buffer.byteLength(button.callback_data, 'utf8') <= 64)
      }
    }
  }
})

test('подсказка категории не дублирует текущую', () => {
  const keyboard = expenseKeyboard(makeExpense({ category: 'groceries' }), [
    'groceries',
    'transport',
  ])
  const texts = keyboard.inline_keyboard.flat().map((b) => b.text)
  assert.equal(texts.filter((t) => t.includes('Продукты')).length, 0)
  assert.ok(texts.some((t) => t.includes('Транспорт')))
})

test('отчёт сравнивает с тем же числом прошедших дней', () => {
  const text = plain(report(makeSummary(), TZ, 'https://example.tj'))
  assert.match(text, /за те же 3 дня прошлого периода/)
  assert.match(text, /421,20 смн/)
})

test('без данных за прошлый период сравнения нет', () => {
  const text = report(makeSummary({ previousComparableMinor: 0, previousTotalMinor: 0 }), TZ, null)
  // Доли категорий с процентами остаются; не должно быть именно строки сравнения.
  assert.ok(!text.includes('прошлого периода'), 'сравнивать не с чем — строки быть не должно')
  assert.ok(!/[↑↓]/.test(text))
})

test('пустой период говорит об этом прямо', () => {
  const text = report(makeSummary({ count: 0, totalMinor: 0 }), TZ, null)
  assert.match(text, /Пока пусто/)
})

test('подпись периода называет даты, а не слово «неделя»', () => {
  const summary = makeSummary({
    period: 'week',
    range: { start: Date.UTC(2026, 7, 30, 19), end: Date.UTC(2026, 8, 6, 19) },
  })
  // Неделя пересекает границу месяца — подпись обязана назвать оба месяца.
  assert.equal(periodLabel('week', summary, TZ), '31 августа — 6 сентября')
  assert.equal(periodLabel('month', makeSummary(), TZ), 'Сентябрь 2026')
})

test('предупреждение о лимите различает 80% и исчерпание', () => {
  const at80 = plain(limitMessage({
    category: 'transport',
    level: 80,
    spentMinor: 8000,
    limitMinor: 10000,
    currency: 'TJS',
  }))
  assert.match(at80, /Осталось 20 смн/)
  const at100 = limitMessage({
    category: 'transport',
    level: 100,
    spentMinor: 10500,
    limitMinor: 10000,
    currency: 'TJS',
  })
  assert.match(at100, /лимит исчерпан/)
})

test('склонение числительных', () => {
  const forms: [string, string, string] = ['трата', 'траты', 'трат']
  assert.equal(plural(1, forms), 'трата')
  assert.equal(plural(2, forms), 'траты')
  assert.equal(plural(5, forms), 'трат')
  assert.equal(plural(11, forms), 'трат')
  assert.equal(plural(21, forms), 'трата')
  assert.equal(plural(0, forms), 'трат')
})

test('время подписывается словами «сегодня» и «вчера»', () => {
  const now = Date.UTC(2026, 8, 3, 12, 0)
  assert.match(humanTime(Date.UTC(2026, 8, 3, 9, 5), TZ, now), /^сегодня 14:05$/)
  assert.match(humanTime(Date.UTC(2026, 8, 2, 9, 5), TZ, now), /^вчера 14:05$/)
  assert.match(humanTime(Date.UTC(2026, 7, 20, 9, 5), TZ, now), /^20 августа, 14:05$/)
})

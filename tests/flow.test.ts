/**
 * Сквозной тест сервисного слоя: от строки «кофе 350» до отчёта.
 * Работает на отдельном файле базы, боевые данные не трогает.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const dir = mkdtempSync(join(tmpdir(), 'tracker-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')

const { runMigrations } = await import('../scripts/migrate.ts')
runMigrations(process.env.DATABASE_PATH)

const {
  addExpense,
  deleteExpense,
  ensureUser,
  getExpense,
  listLimits,
  loadUserRules,
  restoreExpense,
  setLimit,
  updateExpense,
} = await import('../src/lib/expenses.ts')
const { parseExpense } = await import('../src/lib/parser.ts')
const { summarize, recentExpenses } = await import('../src/lib/stats.ts')
const { expensesToCsv } = await import('../src/lib/csv.ts')
const { issueLoginToken, consumeLoginToken, createSession, resolveSession, destroySession } =
  await import('../src/lib/auth.ts')
const { formatMoney } = await import('../src/lib/money.ts')

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* файл мог остаться заблокированным на Windows — не мешает тесту */
  }
})

const alice = ensureUser({ id: 1001, first_name: 'Алиса' })
const bob = ensureUser({ id: 1002, first_name: 'Боб' })

/** Записывает трату строкой, как это делает бот. */
function record(user: typeof alice, text: string) {
  const parsed = parseExpense(text, user.baseCurrency)
  assert.equal(parsed.ok, true, `не разобралось: ${text}`)
  if (!parsed.ok) throw new Error('unreachable')
  return addExpense(user, parsed.value, { source: 'bot', chatId: user.id })
}

test('пользователь заводится один раз', () => {
  const again = ensureUser({ id: 1001, first_name: 'Алиса', username: 'alice' })
  assert.equal(again.id, alice.id)
  assert.equal(again.username, 'alice')
  assert.equal(again.timezone, 'Asia/Dushanbe')
  assert.equal(again.baseCurrency, 'TJS')
})

test('трата из строки сохраняется с категорией и суммой', () => {
  const { expense, classification } = record(alice, 'кофе 350')
  assert.equal(expense.amountMinor, 35000)
  assert.equal(expense.currency, 'TJS')
  assert.equal(expense.baseMinor, 35000)
  assert.equal(expense.category, 'eating_out')
  assert.equal(classification.status, 'confident')
  assert.equal(expense.description, 'кофе')
})

test('валютная трата пересчитывается в базовую', () => {
  const { expense } = record(alice, 'подписка 10 usd')
  assert.equal(expense.currency, 'USD')
  assert.equal(expense.amountMinor, 1000)
  // 10 долларов должны стать примерно 92 сомони, а не 10
  assert.ok(expense.baseMinor > 8000 && expense.baseMinor < 11000, `получилось ${expense.baseMinor}`)
})

test('итоги считаются по базовой валюте', () => {
  const summary = summarize(
    { id: alice.id, timezone: alice.timezone, baseCurrency: alice.baseCurrency, weekStart: 1 },
    'day',
  )
  assert.equal(summary.count, 2)
  assert.ok(summary.totalMinor > 35000)
  assert.equal(summary.currency, 'TJS')
})

test('данные пользователей не смешиваются', () => {
  record(bob, 'такси 900')
  const forBob = summarize(
    { id: bob.id, timezone: bob.timezone, baseCurrency: bob.baseCurrency, weekStart: 1 },
    'day',
  )
  assert.equal(forBob.count, 1)
  assert.equal(forBob.totalMinor, 90000)

  const bobRows = recentExpenses(bob.id, 50)
  assert.equal(bobRows.length, 1)
  assert.ok(bobRows.every((r) => r.userId === bob.id))
})

test('чужую трату нельзя ни прочитать, ни изменить, ни удалить', () => {
  const bobExpense = recentExpenses(bob.id, 1)[0]!
  assert.equal(getExpense(alice.id, bobExpense.id), null)
  assert.equal(updateExpense(alice, bobExpense.id, { amount: 1 }), null)
  assert.equal(deleteExpense(alice.id, bobExpense.id), null)
  // у Боба всё на месте
  assert.equal(getExpense(bob.id, bobExpense.id)?.amountMinor, 90000)
})

test('правка категории запоминается и меняет будущие разборы', () => {
  const { expense } = record(alice, 'обед у Фаруха 40')
  assert.equal(expense.category, 'eating_out')

  updateExpense(alice, expense.id, { category: 'groceries' })
  const rules = loadUserRules(alice.id)
  assert.equal(rules.exact.get('обед у фаруха'), 'groceries')

  const next = record(alice, 'обед у Фаруха 45')
  assert.equal(next.expense.category, 'groceries')
})

test('удаление мягкое: трата пропадает из итогов и возвращается', () => {
  const { expense } = record(alice, 'ненужное 999')
  const before = summarize(
    { id: alice.id, timezone: alice.timezone, baseCurrency: alice.baseCurrency, weekStart: 1 },
    'day',
  ).totalMinor

  assert.ok(deleteExpense(alice.id, expense.id))
  const after1 = summarize(
    { id: alice.id, timezone: alice.timezone, baseCurrency: alice.baseCurrency, weekStart: 1 },
    'day',
  ).totalMinor
  assert.equal(before - after1, 99900)

  assert.ok(restoreExpense(alice.id, expense.id))
  const after2 = summarize(
    { id: alice.id, timezone: alice.timezone, baseCurrency: alice.baseCurrency, weekStart: 1 },
    'day',
  ).totalMinor
  assert.equal(after2, before)

  deleteExpense(alice.id, expense.id)
})

test('повторное удаление ничего не ломает', () => {
  const { expense } = record(alice, 'дубль 10')
  assert.ok(deleteExpense(alice.id, expense.id))
  assert.equal(deleteExpense(alice.id, expense.id), null)
})

test('лимит предупреждает на 80% и на 100%, но только по разу', () => {
  const carl = ensureUser({ id: 1003, first_name: 'Карл' })
  setLimit(carl, 'transport', 100)

  const first = record(carl, 'такси 50')
  assert.equal(first.limitWarning, null, 'на половине лимита молчим')

  const second = record(carl, 'такси 35')
  assert.equal(second.limitWarning?.level, 80)

  const third = record(carl, 'такси 5')
  assert.equal(third.limitWarning, null, 'второй раз про 80% не пишем')

  const fourth = record(carl, 'такси 20')
  assert.equal(fourth.limitWarning?.level, 100)

  const fifth = record(carl, 'такси 20')
  assert.equal(fifth.limitWarning, null, 'после исчерпания больше не надоедаем')

  const rows = listLimits(carl)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.spentMinor, 13000)
})

test('«вчера» кладёт трату во вчерашний день', () => {
  const dana = ensureUser({ id: 1004, first_name: 'Дана' })
  record(dana, 'вчера такси 30')

  const today = summarize(
    { id: dana.id, timezone: dana.timezone, baseCurrency: dana.baseCurrency, weekStart: 1 },
    'day',
  )
  assert.equal(today.count, 0, 'вчерашняя трата не должна попадать в «сегодня»')

  const month = summarize(
    { id: dana.id, timezone: dana.timezone, baseCurrency: dana.baseCurrency, weekStart: 1 },
    'month',
  )
  assert.ok(month.count >= 1)
})

test('разбивка по дням покрывает весь месяц, включая пустые дни', () => {
  const summary = summarize(
    { id: alice.id, timezone: alice.timezone, baseCurrency: alice.baseCurrency, weekStart: 1 },
    'month',
  )
  assert.ok(summary.byDay.length >= 28)
  assert.ok(summary.byDay.some((d) => d.totalMinor === 0), 'пустые дни должны быть нулями, а не дырами')
  const sum = summary.byDay.reduce((acc, d) => acc + d.totalMinor, 0)
  assert.equal(sum, summary.totalMinor, 'сумма по дням должна сходиться с итогом')
})

test('разбивка по категориям сходится с общим итогом', () => {
  const summary = summarize(
    { id: alice.id, timezone: alice.timezone, baseCurrency: alice.baseCurrency, weekStart: 1 },
    'month',
  )
  const sum = summary.byCategory.reduce((acc, c) => acc + c.totalMinor, 0)
  assert.equal(sum, summary.totalMinor)
  const shares = summary.byCategory.reduce((acc, c) => acc + c.share, 0)
  assert.ok(Math.abs(shares - 100) < 0.01, `доли дают ${shares}%`)
})

test('CSV содержит заголовок, BOM и данные только своего пользователя', () => {
  const rows = recentExpenses(bob.id, 100)
  const csv = expensesToCsv(rows, bob.timezone, bob.baseCurrency)
  assert.ok(csv.startsWith('﻿'), 'нужен BOM, иначе Excel покажет кракозябры')
  assert.ok(csv.includes('Дата;Время;Описание'))
  assert.ok(csv.includes('такси'))
  assert.ok(!csv.includes('кофе'), 'в выгрузке Боба не должно быть трат Алисы')
  assert.ok(csv.includes('900,00'), 'дробный разделитель — запятая')
})

test('ссылка входа одноразовая и превращается в сессию', () => {
  const { token } = issueLoginToken(alice.id)
  const userId = consumeLoginToken(token)
  assert.equal(userId, alice.id)
  assert.equal(consumeLoginToken(token), null, 'второй раз тот же токен не должен работать')

  const session = createSession(alice.id, 'magic-link')
  assert.equal(resolveSession(session.value)?.id, alice.id)
  destroySession(session.value)
  assert.equal(resolveSession(session.value), null)
})

test('новая ссылка гасит предыдущую', () => {
  const first = issueLoginToken(bob.id)
  const second = issueLoginToken(bob.id)
  assert.equal(consumeLoginToken(first.token), null, 'старая ссылка должна перестать работать')
  assert.equal(consumeLoginToken(second.token), bob.id)
})

test('подделанное значение cookie не даёт доступа', () => {
  assert.equal(resolveSession('совершенно-случайная-строка'), null)
  assert.equal(resolveSession(''), null)
  assert.equal(resolveSession(undefined), null)
})

test('форматирование итога читается человеком', () => {
  assert.equal(formatMoney(125050, 'TJS'), '1 250,50 смн')
})

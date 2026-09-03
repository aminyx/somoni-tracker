import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseExpense, splitEntries } from '../src/lib/parser.ts'

/** Короткая обёртка: разбираем и требуем успеха. */
function ok(input: string) {
  const result = parseExpense(input)
  assert.equal(result.ok, true, `не разобралось: ${input}`)
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

function fails(input: string) {
  const result = parseExpense(input)
  assert.equal(result.ok, false, `неожиданно разобралось: ${input}`)
}

test('сумма после описания', () => {
  const e = ok('кофе 350')
  assert.equal(e.amount, 350)
  assert.equal(e.description, 'кофе')
  assert.equal(e.currency, 'TJS')
  assert.equal(e.currencyExplicit, false)
})

test('сумма перед описанием', () => {
  const e = ok('350 кофе')
  assert.equal(e.amount, 350)
  assert.equal(e.description, 'кофе')
})

test('описание из нескольких слов', () => {
  const e = ok('такси 900 работа')
  assert.equal(e.amount, 900)
  assert.equal(e.description, 'такси работа')
})

test('дробная часть через точку и через запятую', () => {
  assert.equal(ok('продукты 1250.50').amount, 1250.5)
  assert.equal(ok('продукты 1250,50').amount, 1250.5)
})

test('разряды через пробел и апостроф', () => {
  assert.equal(ok('ноутбук 12 500').amount, 12500)
  assert.equal(ok("ноутбук 12'500").amount, 12500)
})

test('множитель «к» это тысячи', () => {
  assert.equal(ok('1.5к бензин').amount, 1500)
  assert.equal(ok('2к продукты').amount, 2000)
  assert.equal(ok('3 тыс аренда').amount, 3000)
})

test('множитель «млн»', () => {
  assert.equal(ok('машина 1.2млн').amount, 1_200_000)
})

test('валюта словом', () => {
  const e = ok('обед 45 usd')
  assert.equal(e.amount, 45)
  assert.equal(e.currency, 'USD')
  assert.equal(e.currencyExplicit, true)
  assert.equal(e.description, 'обед')
})

test('валюта «сомони» словом', () => {
  const e = ok('нон 5 сомони')
  assert.equal(e.currency, 'TJS')
  assert.equal(e.description, 'нон')
})

test('«с» приклеенная к числу — это сомони', () => {
  const e = ok('такси 20с')
  assert.equal(e.amount, 20)
  assert.equal(e.currency, 'TJS')
  assert.equal(e.description, 'такси')
})

test('«с» отдельным словом в конце — тоже сомони', () => {
  const e = ok('такси 20 с')
  assert.equal(e.amount, 20)
  assert.equal(e.currency, 'TJS')
  assert.equal(e.currencyExplicit, true)
  assert.equal(e.description, 'такси')
})

test('«с» в середине — предлог, а не валюта', () => {
  const e = ok('кафе 120 с другом')
  assert.equal(e.amount, 120)
  assert.equal(e.currency, 'TJS')
  assert.equal(e.currencyExplicit, false)
  assert.equal(e.description, 'кафе с другом')
})

test('символ валюты перед числом', () => {
  const e = ok('подписка $20')
  assert.equal(e.amount, 20)
  assert.equal(e.currency, 'USD')
})

test('рубли значком', () => {
  const e = ok('перевод 1500₽')
  assert.equal(e.amount, 1500)
  assert.equal(e.currency, 'RUB')
})

test('любая валюта по коду ISO', () => {
  assert.equal(ok('такси 300 pkr').currency, 'PKR')
  assert.equal(ok('обед 45 gbp').currency, 'GBP')
  assert.equal(ok('кофе 500 jpy').currency, 'JPY')
})

test('трёхбуквенное слово, не являющееся валютой, остаётся описанием', () => {
  const e = ok('gym 500')
  assert.equal(e.amount, 500)
  assert.equal(e.currency, 'TJS')
  assert.equal(e.description, 'gym')
})

test('«вчера» сдвигает день на минус один', () => {
  const e = ok('вчера такси 30')
  assert.equal(e.dayOffset, -1)
  assert.equal(e.amount, 30)
  assert.equal(e.description, 'такси')
})

test('«позавчера» сдвигает на два дня', () => {
  assert.equal(ok('позавчера обед 90').dayOffset, -2)
})

test('дата словом «3 сентября»', () => {
  const e = ok('3 сентября обед 90')
  assert.deepEqual(e.explicitDate, { year: null, month: 9, day: 3 })
  assert.equal(e.amount, 90)
  assert.equal(e.description, 'обед')
})

test('дата цифрами «01.09»', () => {
  const e = ok('01.09 кофе 20')
  assert.deepEqual(e.explicitDate, { year: null, month: 9, day: 1 })
  assert.equal(e.amount, 20)
  assert.equal(e.description, 'кофе')
})

test('дата с годом', () => {
  const e = ok('15.08.2026 аренда 3000')
  assert.deepEqual(e.explicitDate, { year: 2026, month: 8, day: 15 })
  assert.equal(e.amount, 3000)
})

test('«20.50 кофе» — это сумма, а не 20 мая', () => {
  const e = ok('20.50 кофе')
  assert.equal(e.amount, 20.5)
  assert.equal(e.explicitDate, null)
  assert.equal(e.description, 'кофе')
})

test('арифметика сложением', () => {
  const e = ok('120+80 обед')
  assert.equal(e.amount, 200)
  assert.equal(e.description, 'обед')
})

test('арифметика умножением', () => {
  assert.equal(ok('3*150 кофе').amount, 450)
})

test('два числа: выигрывает последнее', () => {
  const e = ok('интернет 150 месяц')
  assert.equal(e.amount, 150)
  assert.equal(e.description, 'интернет месяц')
})

test('два числа: выигрывает то, что с валютой', () => {
  const e = ok('такси 2 остановки 900 смн')
  assert.equal(e.amount, 900)
  assert.equal(e.currency, 'TJS')
})

test('регистр и ё не мешают', () => {
  const e = ok('Ёлка 400')
  assert.equal(e.amount, 400)
  assert.equal(e.description, 'Елка')
})

test('без суммы — понятная ошибка', () => {
  fails('просто текст')
  const r = parseExpense('просто текст')
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'no-amount')
})

test('пустая строка', () => {
  const r = parseExpense('   ')
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'empty')
})

test('ноль отклоняется', () => {
  const r = parseExpense('кофе 0')
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'amount-not-positive')
})

test('слишком большая сумма отклоняется', () => {
  const r = parseExpense('телефон 992900000000')
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'amount-too-large')
})

test('число, приклеенное к слову, суммой не считается', () => {
  fails('автобус3')
})

test('описание может быть пустым — трата без пояснения', () => {
  const e = ok('500')
  assert.equal(e.amount, 500)
  assert.equal(e.description, '')
})

test('несколько трат разделяются точкой с запятой', () => {
  assert.deepEqual(splitEntries('кофе 20; такси 50'), ['кофе 20', 'такси 50'])
  assert.deepEqual(splitEntries('кофе 20\nтакси 50'), ['кофе 20', 'такси 50'])
})

test('запятая разделителем не считается', () => {
  assert.deepEqual(splitEntries('кафе 120, с другом'), ['кафе 120, с другом'])
})

test('хвостовая пунктуация из описания убирается', () => {
  assert.equal(ok('кофе 350.').description, 'кофе')
  assert.equal(ok('такси — 900').description, 'такси')
})

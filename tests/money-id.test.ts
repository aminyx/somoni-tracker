import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ID_TIME_LIMIT_MS, newId, newSecret } from '../src/lib/id.ts'
import {
  convertMinor,
  currencyInfo,
  formatCompact,
  formatMoney,
  fromMinor,
  isValidCurrency,
  toMinor,
} from '../src/lib/money.ts'
import { OFFLINE_RATES } from '../src/lib/rates.ts'

test('id сортируется по времени', () => {
  const a = newId(Date.UTC(2026, 0, 1))
  const b = newId(Date.UTC(2026, 8, 3))
  const c = newId(Date.UTC(2027, 0, 1))
  assert.ok(a < b, `${a} должен быть меньше ${b}`)
  assert.ok(b < c, `${b} должен быть меньше ${c}`)
})

test('префикс времени не переполнится в обозримом будущем', () => {
  // Восьми символов не хватало уже в августе 2026 — проверяем, что запас есть.
  assert.ok(ID_TIME_LIMIT_MS > Date.now() * 10)
  assert.ok(new Date(ID_TIME_LIMIT_MS).getUTCFullYear() > 3000)
})

test('id уникальны в пределах одной миллисекунды', () => {
  const at = Date.now()
  const ids = new Set(Array.from({ length: 2000 }, () => newId(at)))
  assert.ok(ids.size > 1990, `слишком много совпадений: ${2000 - ids.size}`)
})

test('секрет достаточно длинный и не повторяется', () => {
  const s = newSecret(32)
  assert.ok(s.length >= 43)
  assert.notEqual(s, newSecret(32))
})

test('минорные единицы: округление и обратное преобразование', () => {
  assert.equal(toMinor(350, 'TJS'), 35000)
  assert.equal(toMinor(1250.5, 'TJS'), 125050)
  assert.equal(toMinor(0.1 + 0.2, 'TJS'), 30) // без float-хвоста
  assert.equal(fromMinor(35000, 'TJS'), 350)
})

test('валюты без дробной части', () => {
  assert.equal(currencyInfo('JPY').exponent, 0)
  assert.equal(toMinor(500, 'JPY'), 500)
  assert.equal(currencyInfo('KWD').exponent, 3)
  assert.equal(toMinor(1.5, 'KWD'), 1500)
})

test('коды ISO 4217 распознаются, а произвольные слова — нет', () => {
  assert.equal(isValidCurrency('tjs'), true)
  assert.equal(isValidCurrency('PKR'), true)
  assert.equal(isValidCurrency('GYM'), false)
})

test('направление курса: 20 долларов дороже 20 сомони', () => {
  // Договорённость: rate — сколько base стоит ОДНА единица quote.
  const rate = OFFLINE_RATES.USD! / OFFLINE_RATES.TJS!
  assert.ok(rate > 9 && rate < 10, `курс выглядит перевёрнутым: ${rate}`)
  const inTjs = convertMinor(toMinor(20, 'USD'), 'USD', 'TJS', rate)
  assert.ok(inTjs > toMinor(180, 'TJS'), `20 долларов дали ${fromMinor(inTjs, 'TJS')} сомони`)
  assert.ok(inTjs < toMinor(190, 'TJS'))
})

test('пересчёт в ту же валюту ничего не меняет', () => {
  assert.equal(convertMinor(12345, 'TJS', 'TJS', 1), 12345)
})

test('форматирование: копейки показываются только когда они есть', () => {
  assert.match(formatMoney(35000, 'TJS'), /^350 смн$/)
  assert.match(formatMoney(35050, 'TJS'), /^350,50 смн$/)
  assert.match(formatMoney(125050, 'TJS'), /^1 250,50 смн$/)
})

test('форматирование отрицательных и без символа', () => {
  assert.match(formatMoney(-35000, 'TJS'), /^−350/)
  assert.equal(formatMoney(35000, 'TJS', { withSymbol: false }), '350')
})

test('компактная запись для подписей графика', () => {
  assert.match(formatCompact(1_250_000, 'TJS'), /12,5 тыс/)
  assert.match(formatCompact(500_000_000, 'TJS'), /5 млн/)
  assert.equal(formatCompact(35000, 'TJS'), '350')
})

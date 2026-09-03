/**
 * Ранжирование сумм с чека. Модель здесь не нужна: на вход подаётся текст,
 * какой её реально выдаёт распознаватель, включая его типичные огрехи —
 * пробел после запятой («200, 00») и слипшиеся слова.
 *
 * Самое важное проверяемое свойство: сумма НДС, сдача и внесённые наличные
 * не должны занимать первое место. Ошибиться тут — значит записать
 * пользователю не ту трату.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rankCandidates } from '../src/lib/ocr.ts'

/** Текст, снятый распознавателем с настоящего чека (итог 195,50). */
const RECEIPT = `ООО ) «ОРИЁН МАРКЕТ» !
г. Душанбе, ул. Рудаки 137
инн ( 0301024578
КАССОВЫЙ ЧЕК
ПРИХОД
Нон лаваш
2 x 5,00 10,00
Молоко 1л
1 x 12,50 12,50
Гушт мол (кг)
1,340 x 95,00 127,30
Чой кабуд
1 x 18,00 18,00
Равган і офтобпараст
1 x 32,20 32,20
подитог 200, 00
СКИДКА –4, 50
ИТОГО 195,50
НАЛИчНыМи 200 , 00
СДАЧА 4,50
ндС 18% 29,82
СМЕНА 42 ЧЕК 0117
03.09.2026 14:37
ФН 7284410700123456
СПАСИБО ЗА ПОКУПКУ`

test('итог чека оказывается первым кандидатом', () => {
  const candidates = rankCandidates(RECEIPT)
  assert.ok(candidates.length > 0, 'кандидатов не нашлось')
  assert.equal(candidates[0]!.amount, 195.5)
})

test('сумма НДС в кандидаты не попадает', () => {
  const amounts = rankCandidates(RECEIPT).map((c) => c.amount)
  assert.ok(!amounts.includes(29.82), `НДС просочился: ${amounts.join(', ')}`)
})

test('сдача в кандидаты не попадает', () => {
  const amounts = rankCandidates(RECEIPT).map((c) => c.amount)
  assert.ok(!amounts.includes(4.5))
})

test('номера документов деньгами не считаются', () => {
  const amounts = rankCandidates(RECEIPT).map((c) => c.amount)
  assert.ok(!amounts.includes(7284410700123456))
  assert.ok(!amounts.includes(301024578))
  assert.ok(!amounts.includes(117), 'номер чека 0117 — не сумма')
})

test('дата и время не считаются суммой', () => {
  const amounts = rankCandidates(RECEIPT).map((c) => c.amount)
  assert.ok(!amounts.includes(3.09))
  assert.ok(!amounts.includes(14.37))
})

test('кандидатов немного — их показывают кнопками', () => {
  assert.ok(rankCandidates(RECEIPT).length <= 4)
})

test('строка «2 x 5,00» не выигрывает у итога', () => {
  const candidates = rankCandidates(RECEIPT)
  const first = candidates[0]!
  assert.ok(!/x/.test(first.line), `наверх попала строка с количеством: ${first.line}`)
})

test('чек без слова «итого»: побеждает большая сумма снизу', () => {
  const text = `МАГАЗИН У ДОМА
хлеб 5,00
молоко 12,50
чай 18,00
35,50`
  const candidates = rankCandidates(text)
  assert.equal(candidates[0]!.amount, 35.5)
})

test('английское total тоже опознаётся', () => {
  const text = `COFFEE HOUSE
latte 18.00
croissant 12.00
TOTAL 30.00
CASH 50.00
CHANGE 20.00`
  assert.equal(rankCandidates(text)[0]!.amount, 30)
})

test('таджикское «ҳамагӣ» опознаётся', () => {
  const text = `ДӮКОН
нон 5,00
шир 12,50
ҲАМАГӢ 17,50`
  assert.equal(rankCandidates(text)[0]!.amount, 17.5)
})

test('пустой и мусорный ввод не роняет ранжирование', () => {
  assert.deepEqual(rankCandidates(''), [])
  assert.deepEqual(rankCandidates('   \n\n  '), [])
  assert.ok(Array.isArray(rankCandidates('ЖЖЖ ЩЩЩ ЭЭЭ')))
})

test('чек с одной строкой даёт эту сумму', () => {
  const candidates = rankCandidates('ИТОГО 42,00')
  assert.equal(candidates[0]!.amount, 42)
})

test('разряды с пробелом читаются как одно число', () => {
  const candidates = rankCandidates('ИТОГО 12 500,00')
  assert.equal(candidates[0]!.amount, 12500)
})

test('нулевые суммы отбрасываются', () => {
  const amounts = rankCandidates('СКИДКА 0,00\nИТОГО 100,00').map((c) => c.amount)
  assert.ok(!amounts.includes(0))
  assert.ok(amounts.includes(100))
})

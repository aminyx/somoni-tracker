/**
 * Кнопки под полем ввода отправляют боту обычный текст. Если для какой-то
 * кнопки нет обработчика, её нажатие уйдёт в разбор траты, и человек получит
 * «не нашёл сумму» вместо отчёта. Ровно это и случилось с «Последними»,
 * поэтому проверка читает исходник бота и сверяет одно с другим.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseExpense } from '../src/lib/parser.ts'

const source = readFileSync(new URL('../src/bot/index.ts', import.meta.url), 'utf8')

/** Достаёт подписи кнопок из объекта BUTTONS. */
function buttonLabels(): Record<string, string> {
  const block = /const BUTTONS = \{([\s\S]*?)\} as const/.exec(source)
  assert.ok(block, 'не нашёл объект BUTTONS в src/bot/index.ts')
  const labels: Record<string, string> = {}
  for (const m of block[1]!.matchAll(/(\w+):\s*'([^']+)'/g)) labels[m[1]!] = m[2]!
  return labels
}

test('в клавиатуре есть кнопки', () => {
  const labels = buttonLabels()
  assert.ok(Object.keys(labels).length >= 5, `кнопок мало: ${Object.keys(labels).length}`)
})

test('у каждой кнопки есть обработчик', () => {
  const labels = buttonLabels()
  const missing = Object.keys(labels).filter(
    // Простое вхождение строки, а не регулярка: скобки и точки пришлось бы
    // экранировать, а ошибка экранирования тихо ломает саму проверку.
    (key) => !source.includes(`bot.hears(BUTTONS.${key}`),
  )
  assert.deepEqual(missing, [], `кнопки без обработчика: ${missing.join(', ')}`)
})

test('каждая кнопка попадает в саму клавиатуру', () => {
  const labels = buttonLabels()
  const keyboard = /function mainKeyboard\(\)[\s\S]*?\n}/.exec(source)
  assert.ok(keyboard, 'не нашёл mainKeyboard')
  const missing = Object.keys(labels).filter((key) => !keyboard[0].includes(`BUTTONS.${key}`))
  assert.deepEqual(missing, [], `объявлены, но не показаны: ${missing.join(', ')}`)
})

test('обработчики кнопок стоят до разбора обычного текста', () => {
  const hears = source.indexOf('bot.hears(BUTTONS.')
  const text = source.indexOf("bot.on('message:text'")
  assert.ok(hears > 0 && text > 0)
  assert.ok(
    hears < text,
    'нажатие кнопки уйдёт в разбор траты: bot.hears должен быть раньше bot.on(message:text)',
  )
})

test('подпись кнопки не выглядит как трата', () => {
  // Иначе «Месяц 5» кто-то введёт руками и получит неожиданное поведение.
  for (const label of Object.values(buttonLabels())) {
    const parsed = parseExpense(label)
    assert.equal(parsed.ok, false, `подпись «${label}» разбирается как трата`)
  }
})

test('подсказка в поле ввода — рабочий пример траты', () => {
  const m = /\.placeholder\('([^']+)'\)/.exec(source)
  assert.ok(m, 'не задан input_field_placeholder')
  const parsed = parseExpense(m[1]!)
  assert.equal(parsed.ok, true, `подсказка «${m[1]}» сама не разбирается как трата`)
  if (parsed.ok) assert.ok(parsed.value.amount > 0)
})

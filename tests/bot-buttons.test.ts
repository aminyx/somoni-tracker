/**
 * Кнопки под полем ввода отправляют боту обычный текст. Если для какой-то
 * кнопки нет обработчика, её нажатие уйдёт в разбор траты, и человек получит
 * «не нашёл сумму» вместо отчёта. Ровно это и случилось с «Последними»,
 * поэтому проверка читает исходник бота и сверяет одно с другим.
 *
 * После появления языков добавилось второе условие: подписи разные на каждом
 * языке, значит слушать надо все варианты, иначе после смены языка кнопки
 * молча перестанут работать.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { EXAMPLES, LOCALES, t } from '../src/lib/i18n.ts'
import { parseExpense } from '../src/lib/parser.ts'

const source = readFileSync(new URL('../src/bot/index.ts', import.meta.url), 'utf8')

/** Ключи кнопок, объявленные в боте. */
function buttonKeys(): string[] {
  const start = source.indexOf('const BUTTON_KEYS')
  assert.notEqual(start, -1, 'не нашёл BUTTON_KEYS в src/bot/index.ts')
  const open = source.indexOf('[', start)
  const close = source.indexOf(']', open)
  return [...source.slice(open, close).matchAll(/'([a-z]+)'/g)].map((m) => m[1]!)
}

test('в клавиатуре есть кнопки', () => {
  assert.ok(buttonKeys().length >= 5, `кнопок мало: ${buttonKeys().length}`)
})

test('у каждой кнопки есть обработчик на все языки сразу', () => {
  const missing = buttonKeys().filter(
    (key) => !source.includes(`allButtonLabels('${key}')`),
  )
  assert.deepEqual(missing, [], `кнопки без обработчика: ${missing.join(', ')}`)
})

test('каждая кнопка попадает в саму клавиатуру', () => {
  const start = source.indexOf('function mainKeyboard')
  const end = source.indexOf('\n}', start)
  const body = source.slice(start, end)
  const missing = buttonKeys().filter((key) => !body.includes(`'${key}'`))
  assert.deepEqual(missing, [], `объявлены, но не показаны: ${missing.join(', ')}`)
})

test('обработчики кнопок стоят до разбора обычного текста', () => {
  const hears = source.indexOf('bot.hears(allButtonLabels(')
  const text = source.indexOf("bot.on('message:text'")
  assert.ok(hears > 0 && text > 0)
  assert.ok(
    hears < text,
    'нажатие кнопки уйдёт в разбор траты: bot.hears должен быть раньше bot.on(message:text)',
  )
})

test('у каждой кнопки есть подпись на каждом языке', () => {
  for (const key of buttonKeys()) {
    for (const locale of LOCALES) {
      const label = t(locale, `btn.${key}`)
      assert.ok(label.length > 0, `${locale}/btn.${key}: пусто`)
      assert.notEqual(label, `btn.${key}`, `${locale}/btn.${key}: нет перевода`)
    }
  }
})

test('подписи кнопок не выглядят как трата ни на одном языке', () => {
  // Иначе нажатие могло бы уйти в разбор и записаться как расход.
  for (const key of buttonKeys()) {
    for (const locale of LOCALES) {
      const label = t(locale, `btn.${key}`)
      assert.equal(parseExpense(label).ok, false, `«${label}» (${locale}) разбирается как трата`)
    }
  }
})

test('подписи кнопок не совпадают между собой внутри языка', () => {
  // Одинаковые подписи означали бы, что две кнопки неразличимы для бота.
  for (const locale of LOCALES) {
    const labels = buttonKeys().map((key) => t(locale, `btn.${key}`))
    assert.equal(new Set(labels).size, labels.length, `${locale}: подписи повторяются`)
  }
})

test('подсказка в поле ввода — рабочий пример траты на каждом языке', () => {
  for (const locale of LOCALES) {
    const hint = t(locale, 'placeholder.input')
    const parsed = parseExpense(hint)
    assert.equal(parsed.ok, true, `подсказка «${hint}» (${locale}) сама не разбирается как трата`)
    if (parsed.ok) assert.ok(parsed.value.amount > 0)
  }
})

test('примеры из справки действительно разбираются', () => {
  for (const locale of LOCALES) {
    for (const [name, example] of Object.entries(EXAMPLES[locale])) {
      const parsed = parseExpense(example)
      assert.equal(parsed.ok, true, `пример ${locale}/${name} «${example}» не разбирается`)
      if (parsed.ok) assert.ok(parsed.value.amount > 0, `${locale}/${name}: сумма не положительная`)
    }
  }
})

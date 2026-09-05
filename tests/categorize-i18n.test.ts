/**
 * Категории должны работать на всех трёх языках, а не только на русском.
 *
 * Словарь начинался как русский с горстью английских и таджикских слов,
 * и переключение языка тихо ломало главное: лента превращалась в сплошное
 * «Прочее». Хуже всего было то, что в «Прочее» попадала и подсказка в поле
 * ввода — «қаҳва 350», которую бот сам же и предлагает написать.
 *
 * Поэтому здесь проверяются не отдельные слова, а обещания продукта:
 * всё, что бот показывает человеку как пример, должно определяться.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_RULES, classify } from '../src/lib/categorize.ts'
import { CATEGORIES, KEYWORDS, OTHER_CATEGORY } from '../src/lib/categories.ts'
import { EXAMPLES, LOCALES, t } from '../src/lib/i18n.ts'
import { parseExpense } from '../src/lib/parser.ts'

/** Категория для строки траты — так же, как это делает бот. */
function categoryOf(line: string): string {
  const parsed = parseExpense(line)
  assert.equal(parsed.ok, true, `«${line}» не разбирается как трата`)
  if (!parsed.ok) return OTHER_CATEGORY
  return classify(parsed.value.description, EMPTY_RULES).category
}

test('примеры из справки не падают в «Прочее» ни на одном языке', () => {
  for (const locale of LOCALES) {
    for (const [name, example] of Object.entries(EXAMPLES[locale])) {
      const category = categoryOf(example)
      assert.notEqual(
        category,
        OTHER_CATEGORY,
        `${locale}/${name}: «${example}» → Прочее. Бот сам предлагает так писать.`,
      )
    }
  }
})

test('подсказка в поле ввода определяется на всех языках', () => {
  for (const locale of LOCALES) {
    const hint = t(locale, 'placeholder.input')
    assert.notEqual(categoryOf(hint), OTHER_CATEGORY, `${locale}: «${hint}» → Прочее`)
  }
})

/**
 * Повседневный набор — то, на что человек тратит деньги каждую неделю.
 * Если хоть треть уходит в «Прочее», продуктом на этом языке не пользуются.
 */
const EVERYDAY: Record<string, Array<[string, string]>> = {
  en: [
    ['coffee 20', 'eating_out'],
    ['lunch 60', 'eating_out'],
    ['taxi 90', 'transport'],
    ['fuel 300', 'transport'],
    ['groceries 250', 'groceries'],
    ['rent 2000', 'housing'],
    ['internet 120', 'connectivity'],
    ['pharmacy 80', 'health'],
    ['sneakers 400', 'clothing'],
    ['cinema 50', 'entertainment'],
    ['school 900', 'education'],
    ['gift 150', 'gifts_events'],
  ],
  tg: [
    ['қаҳва 20', 'eating_out'],
    ['хӯрок 60', 'eating_out'],
    ['такси 90', 'transport'],
    ['бензин 300', 'transport'],
    ['хӯрокворӣ 250', 'groceries'],
    ['кироя 2000', 'housing'],
    ['интернет 120', 'connectivity'],
    ['дорухона 80', 'health'],
    ['пойафзол 400', 'clothing'],
    ['кино 50', 'entertainment'],
    ['мактаб 900', 'education'],
    ['тӯҳфа 150', 'gifts_events'],
  ],
}

for (const [locale, cases] of Object.entries(EVERYDAY)) {
  test(`повседневные траты на «${locale}» попадают в свои категории`, () => {
    const wrong: string[] = []
    for (const [line, expected] of cases) {
      const actual = categoryOf(line)
      if (actual !== expected) wrong.push(`«${line}» → ${actual}, а не ${expected}`)
    }
    assert.deepEqual(wrong, [], wrong.join('; '))
  })
}

test('в словаре есть слова каждого языка для каждой категории', () => {
  // Грубая, но честная проверка: категория, у которой нет ни одного слова
  // латиницей, на английском не определится никогда.
  const slugs = CATEGORIES.map((c) => c.slug).filter((slug) => slug !== OTHER_CATEGORY)
  const missing = slugs.filter(
    (slug) => !(KEYWORDS[slug] ?? []).some((word) => /^[a-z]/.test(word)),
  )
  assert.deepEqual(missing, [], `нет английских слов: ${missing.join(', ')}`)
})

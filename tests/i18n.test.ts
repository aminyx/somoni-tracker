/**
 * Полнота и целостность словарей.
 *
 * Пропущенный ключ не даёт ошибки при сборке: текст просто выйдет на чужом
 * языке, а в худшем случае наружу вылезет сам ключ. Потерянная подстановка
 * или непарный тег хуже — Telegram отклоняет сообщение целиком.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  allKeys,
  dictFor,
  INTL_LOCALE,
  LOCALES,
  localeFromTelegram,
  LOCALE_NAMES,
  MONTHS_GENITIVE,
  MONTHS_NOMINATIVE,
  MONTHS_SHORT,
  plural,
  t,
  tPlural,
  WEEKDAYS_SHORT,
} from '../src/lib/i18n.ts'

const keys = allKeys()

test('в русском словаре есть ключи', () => {
  assert.ok(keys.length > 100, `ключей всего ${keys.length}`)
})

test('таджикский и английский переведены полностью', () => {
  for (const locale of LOCALES) {
    const dict = dictFor(locale)
    const missing = keys.filter((k) => !(k in dict))
    assert.deepEqual(missing, [], `${locale}: не переведено ${missing.length} — ${missing.slice(0, 5).join(', ')}`)
  }
})

test('лишних ключей в переводах нет', () => {
  const known = new Set(keys)
  for (const locale of LOCALES) {
    const extra = Object.keys(dictFor(locale)).filter((k) => !known.has(k))
    assert.deepEqual(extra, [], `${locale}: лишние ключи ${extra.join(', ')}`)
  }
})

test('подстановки совпадают во всех языках', () => {
  const ru = dictFor('ru')
  for (const locale of LOCALES) {
    if (locale === 'ru') continue
    const dict = dictFor(locale)
    for (const key of keys) {
      const a = [...ru[key]!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      const b = [...(dict[key] ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      assert.deepEqual(b, a, `${locale}/${key}: подстановки разошлись`)
    }
  }
})

test('теги HTML парные и совпадают с русским', () => {
  const ru = dictFor('ru')
  for (const locale of LOCALES) {
    const dict = dictFor(locale)
    for (const key of keys) {
      const text = dict[key] ?? ''
      for (const tag of ['b', 'i', 'code', 's', 'tg-emoji']) {
        const open = (text.match(new RegExp(`<${tag}>`, 'g')) ?? []).length
        const close = (text.match(new RegExp(`</${tag}>`, 'g')) ?? []).length
        assert.equal(open, close, `${locale}/${key}: непарный <${tag}>`)
        const ruOpen = (ru[key]!.match(new RegExp(`<${tag}>`, 'g')) ?? []).length
        assert.equal(open, ruOpen, `${locale}/${key}: число <${tag}> не как в русском`)
      }
    }
  }
})

test('формы множественного числа — ровно три части', () => {
  for (const locale of LOCALES) {
    const dict = dictFor(locale)
    for (const key of keys.filter((k) => k.startsWith('plural.'))) {
      assert.equal(dict[key]!.split('|').length, 3, `${locale}/${key}`)
    }
  }
})

test('в таджикском формы совпадают: существительное после числа не меняется', () => {
  const dict = dictFor('tg')
  for (const key of keys.filter((k) => k.startsWith('plural.'))) {
    const parts = dict[key]!.split('|')
    assert.equal(new Set(parts).size, 1, `${key}: формы разные — ${parts.join('|')}`)
  }
})

test('склонение выбирает верную форму', () => {
  const forms: [string, string, string] = ['один', 'два', 'много']
  assert.equal(plural('ru', 1, forms), 'один')
  assert.equal(plural('ru', 3, forms), 'два')
  assert.equal(plural('ru', 11, forms), 'много')
  assert.equal(plural('en', 1, forms), 'один')
  assert.equal(plural('en', 5, forms), 'два')
  assert.equal(plural('tg', 1, forms), 'один')
  assert.equal(plural('tg', 99, forms), 'один')
})

test('подстановка параметров работает', () => {
  assert.equal(t('ru', 'card.today', { total: 'X', count: 2, plural: 'траты' }), 'Сегодня: <b>X</b> · 2 траты')
  assert.match(t('tg', 'card.today', { total: 'X', count: 2, plural: 'харҷ' }), /Имрӯз/)
})

test('неизвестный ключ не роняет и возвращает сам ключ', () => {
  assert.equal(t('ru', 'нет.такого.ключа'), 'нет.такого.ключа')
})

test('нераспознанные подстановки остаются как есть', () => {
  assert.match(t('ru', 'card.today', { total: 'X' }), /\{count\}/)
})

test('язык определяется по коду Telegram', () => {
  assert.equal(localeFromTelegram('tg'), 'tg')
  assert.equal(localeFromTelegram('en-GB'), 'en')
  assert.equal(localeFromTelegram('ru'), 'ru')
  assert.equal(localeFromTelegram('uz'), 'ru')
  assert.equal(localeFromTelegram(null), 'ru')
  assert.equal(localeFromTelegram(undefined), 'ru')
})

test('у каждого языка есть название и списки дат', () => {
  for (const locale of LOCALES) {
    assert.ok(LOCALE_NAMES[locale].length > 0)
    assert.equal(MONTHS_GENITIVE[locale].length, 12, `${locale}: месяцев не 12`)
    assert.equal(MONTHS_NOMINATIVE[locale].length, 12)
    assert.equal(MONTHS_SHORT[locale].length, 12)
    assert.equal(WEEKDAYS_SHORT[locale].length, 7)
    // Intl должен принять тег, иначе форматирование чисел упадёт в бою.
    assert.doesNotThrow(() => new Intl.NumberFormat(INTL_LOCALE[locale]).format(1234.56))
  }
})

test('в таджикском словаре есть таджикские буквы', () => {
  const joined = Object.values(dictFor('tg')).join(' ')
  for (const letter of ['ӯ', 'ӣ', 'ҳ', 'ҷ']) {
    assert.ok(joined.includes(letter), `буква ${letter} не встречается — похоже на русский текст`)
  }
})

test('команды и коды валют в переводах не тронуты', () => {
  for (const locale of LOCALES) {
    const dict = dictFor(locale)
    assert.ok(dict['start.reports']!.includes('/today'), `${locale}: команда переведена`)
    assert.ok(dict['settings.pickCurrency']!.includes('GBP'), `${locale}: код валюты переведён`)
  }
})

test('формы множественного не содержат HTML и подстановок', () => {
  for (const locale of LOCALES) {
    const dict = dictFor(locale)
    for (const key of keys.filter((k) => k.startsWith('plural.'))) {
      assert.ok(!/[<>{}]/.test(dict[key]!), `${locale}/${key}: лишние символы`)
    }
  }
})

test('tPlural берёт форму из словаря', () => {
  assert.equal(tPlural('ru', 'plural.expense', 1), 'трата')
  assert.equal(tPlural('ru', 'plural.expense', 5), 'трат')
  assert.equal(tPlural('en', 'plural.expense', 2), 'expenses')
  assert.equal(tPlural('tg', 'plural.expense', 5), 'харҷ')
})

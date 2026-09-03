import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CATEGORIES, KEYWORDS } from '../src/lib/categories.ts'
import { classify, EMPTY_RULES, normalizeForMatch, type UserRules } from '../src/lib/categorize.ts'

function cat(text: string, rules: UserRules = EMPTY_RULES) {
  return classify(text, rules).category
}

test('словарь непротиворечив: слово принадлежит одной категории', () => {
  const owner = new Map<string, string>()
  const clashes: string[] = []
  for (const [slug, words] of Object.entries(KEYWORDS)) {
    for (const word of words) {
      const key = word.trim().toLowerCase()
      const already = owner.get(key)
      if (already && already !== slug) clashes.push(`${key}: ${already} / ${slug}`)
      owner.set(key, slug)
    }
  }
  assert.deepEqual(clashes, [])
})

test('у каждой категории есть слова, и наоборот', () => {
  const slugs = CATEGORIES.map((c) => c.slug).sort()
  assert.deepEqual(Object.keys(KEYWORDS).sort(), slugs)
  for (const [slug, words] of Object.entries(KEYWORDS)) {
    assert.ok(words.length >= 25, `${slug}: слишком мало слов (${words.length})`)
  }
})

test('цвета категорий уникальны', () => {
  const colors = CATEGORIES.map((c) => c.color)
  assert.equal(new Set(colors).size, colors.length)
})

test('«сомони» — валюта, а не категория', () => {
  assert.equal(normalizeForMatch('сомони 100'), '')
  const r = classify('сомони 100')
  assert.equal(r.status, 'no_signal')
  assert.equal(r.category, 'other')
})

test('сумма и валюта не мешают определению', () => {
  assert.equal(cat('кофе 350 смн'), 'eating_out')
  assert.equal(cat('такси 900 сомони'), 'transport')
})

test('базовые категории по одному слову', () => {
  assert.equal(cat('такси'), 'transport')
  assert.equal(cat('маршрутка'), 'transport')
  assert.equal(cat('аптека'), 'health')
  assert.equal(cat('нон'), 'groceries')
  assert.equal(cat('кафе'), 'eating_out')
  assert.equal(cat('интернет'), 'connectivity')
  assert.equal(cat('школа'), 'education')
  assert.equal(cat('подарок'), 'gifts_events')
  assert.equal(cat('кредит'), 'finance')
})

test('таджикские слова с диакритикой и без неё дают один результат', () => {
  assert.equal(cat('гӯшт'), 'groceries')
  assert.equal(cat('гушт'), 'groceries')
  assert.equal(cat('хӯрок'), 'eating_out')
  assert.equal(cat('хурок'), 'eating_out')
  assert.equal(cat('дорухона'), 'health')
  assert.equal(cat('нақлиёт'), 'transport')
})

test('многословная фраза важнее отдельных слов', () => {
  // «газ» сам по себе — коммуналка, но «газ на машину» — транспорт
  assert.equal(cat('за газ 45'), 'housing')
  assert.equal(cat('газ на машину 60'), 'transport')
})

test('«ремонт машины» и «ремонт дома» расходятся', () => {
  assert.equal(cat('ремонт машины 300'), 'transport')
  assert.equal(cat('ремонт дома 1200'), 'household')
})

test('«вода» и «бутылка воды» расходятся', () => {
  assert.equal(cat('вода 30'), 'housing')
  assert.equal(cat('бутылка воды 3'), 'groceries')
})

test('местные реалии Душанбе', () => {
  assert.equal(cat('оши палав в чойхоне 25'), 'eating_out')
  assert.equal(cat('бозор гушт 200'), 'groceries')
  assert.equal(cat('той брата 500'), 'gifts_events')
  assert.equal(cat('барки точик 120'), 'housing')
  assert.equal(cat('тсел 30'), 'connectivity')
  assert.equal(cat('алиф моби перевод 200'), 'finance')
})

test('опечатки распознаются', () => {
  assert.equal(cat('маршутка 2'), 'transport')
  assert.equal(cat('продкты 150'), 'groceries')
  assert.equal(cat('апетка 45'), 'health')
})

test('«одежда для дочки» не уезжает в здоровье из-за похожего слова «очки»', () => {
  assert.equal(cat('одежда для дочки 200'), 'clothing')
})

test('без сигнала — «Прочее», а не случайная категория', () => {
  const r = classify('что-то купил 15')
  assert.equal(r.category, 'other')
  assert.equal(r.status, 'no_signal')
})

test('правило пользователя перебивает словарь', () => {
  const rules: UserRules = {
    exact: new Map([['обед у фаруха', 'groceries']]),
    token: new Map(),
    prior: new Map(),
  }
  assert.equal(cat('обед у Фаруха 40', rules), 'groceries')
  // без правила это была бы еда вне дома
  assert.equal(cat('обед у Фаруха 40'), 'eating_out')
})

test('пословное правило пользователя сильнее словаря', () => {
  const rules: UserRules = {
    exact: new Map(),
    token: new Map([['бензин', 'household']]),
    prior: new Map(),
  }
  assert.equal(cat('бензин 200', rules), 'household')
})

test('уверенность выше у явного совпадения, чем у догадки', () => {
  const clear = classify('такси 900')
  const vague = classify('что-то там 900')
  assert.equal(clear.status, 'confident')
  assert.ok(clear.confidence > vague.confidence)
})

test('пустая строка не роняет классификатор', () => {
  assert.equal(classify('').category, 'other')
  assert.equal(classify('   ').status, 'no_signal')
})

test('регистр не влияет', () => {
  assert.equal(cat('ТАКСИ 900'), cat('такси 900'))
})

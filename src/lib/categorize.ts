/**
 * Автоопределение категории по описанию траты.
 *
 * Слоями, сверху вниз — первый сработавший слой сильнее следующего:
 *   1. точное правило пользователя на всю фразу («обед у Фаруха» → кафе);
 *   2. многословные фразы из словаря, самые длинные вперёд;
 *   3. пословные правила пользователя;
 *   4. глобальный словарь: точное слово → основа → опечатка;
 *   5. привычки пользователя как добавка к весу при ничьей.
 *
 * Итог — не «категория», а три исхода: уверенно, неоднозначно (показываем
 * две кнопки исправления) и «сигнала нет» (пишем «Прочее»). Ставить «Прочее»
 * там, где сигнал был, но слабый, — значит терять информацию.
 */
import { CATEGORIES, KEYWORDS, OTHER_CATEGORY } from './categories'

export type ClassifyStatus = 'confident' | 'ambiguous' | 'no_signal'

export interface ClassifyResult {
  category: string
  /** 0…1 — насколько можно доверять */
  confidence: number
  status: ClassifyStatus
  /** до двух вариантов для кнопок исправления, если категория спорная */
  suggestions: string[]
}

/** Правила, выученные у конкретного пользователя. */
export interface UserRules {
  /** нормализованная фраза целиком → слаг категории */
  exact: Map<string, string>
  /** отдельное слово → слаг категории */
  token: Map<string, string>
  /** как часто пользователь вообще пользуется категорией, 0…1 */
  prior: Map<string, number>
}

export const EMPTY_RULES: UserRules = {
  exact: new Map(),
  token: new Map(),
  prior: new Map(),
}

const W = {
  phrase: 3.0,
  phraseWordBonus: 0.6,
  exact: 2.0,
  stem: 1.4,
  fuzzyD1: 1.6,
  fuzzyD2: 1.0,
  userToken: 6.0,
  headBoost: 1.15,
}
const AMBIG_PENALTY = 0.5
const K_MARGIN = 0.5
const S_FULL = 2.5
const CONF_MIN = 0.55
const SCORE_MIN = 1.2

/** Свёртка таджикских букв: «хӯрок» и «хурок» должны совпадать. */
const TJ_FOLD: Record<string, string> = {
  ӯ: 'у', ӣ: 'и', ҳ: 'х', қ: 'к', ғ: 'г', ҷ: 'ч', ё: 'е',
  Ӯ: 'у', Ӣ: 'и', Ҳ: 'х', Қ: 'к', Ғ: 'г', Ҷ: 'ч', Ё: 'е',
}

/**
 * Служебные слова: их присутствие ничего не говорит о категории,
 * а вес они бы оттягивали.
 */
const STOPWORDS = new Set([
  'за', 'на', 'в', 'во', 'для', 'и', 'с', 'со', 'по', 'у', 'от', 'до', 'из', 'к', 'о', 'об',
  'купил', 'купила', 'купили', 'потратил', 'потратила', 'оплатил', 'оплатила',
  'заплатил', 'заплатила', 'дал', 'дала', 'взял', 'взяла', 'отдал', 'отдала',
  'сегодня', 'вчера', 'позавчера', 'утром', 'днем', 'вечером', 'ночью',
  'ба', 'аз', 'ва', 'ро', 'бо', 'дар', 'хариди',
  'the', 'a', 'for', 'on', 'paid', 'bought', 'my',
])

/** Лёгкий стеммер: режем только очевидные окончания и только у длинных слов. */
const SUFFIXES = [
  'ами', 'ями', 'ого', 'ему', 'ыми', 'ими',
  'ой', 'ей', 'ом', 'ем', 'ах', 'ях', 'ов', 'ев', 'ий', 'ый', 'ая', 'ое', 'ые', 'ие', 'ью', 'ия', 'ии',
  'у', 'ю', 'а', 'я', 'ы', 'и', 'е', 'о', 'ь',
]

/** Валюты и числа выкидываются до классификации. */
const AMOUNT_RE =
  /(?:^|\s)[+-]?\d[\d\s.,'’]*\s*(?:сомони|сомонӣ|смн|somoni|tjs|руб(?:лей|ля|ль)?|₽|rub|\$|usd|доллар\w*|€|eur|евро|сум|uzs|₸|kzt|тенге)?/gi

const CURRENCY_WORDS_RE =
  /(?:^|\s)(?:сомони|сомонӣ|смн|somoni|tjs|руб|рублей|рубля|рубль|₽|rub|usd|доллар\w*|€|eur|евро|сум|uzs|kgs|₸|kzt|тенге)(?=\s|$)/gi

export function foldTajik(text: string): string {
  let out = ''
  for (const ch of text) out += TJ_FOLD[ch] ?? ch
  return out
}

/** Приводит строку к виду, в котором её сравнивает словарь. */
export function normalizeForMatch(raw: string): string {
  let s = foldTajik((raw ?? '').normalize('NFC').toLowerCase())
  s = s.replace(AMOUNT_RE, ' ')
  s = s.replace(CURRENCY_WORDS_RE, ' ')
  s = s.replace(/[^\p{L}\p{N}-]+/gu, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

export function stem(token: string): string {
  if (token.length < 5) return token
  for (const suffix of SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      return token.slice(0, -suffix.length)
    }
  }
  return token
}

interface Phrase {
  text: string
  category: string
  words: number
}

interface Index {
  phrases: Phrase[]
  tokens: Map<string, Set<string>>
  stems: Map<string, Set<string>>
  stemList: string[]
}

let index: Index | null = null

function buildIndex(): Index {
  const phrases: Phrase[] = []
  const tokens = new Map<string, Set<string>>()
  const stems = new Map<string, Set<string>>()

  const put = (map: Map<string, Set<string>>, key: string, category: string) => {
    let set = map.get(key)
    if (!set) map.set(key, (set = new Set()))
    set.add(category)
  }

  for (const [category, words] of Object.entries(KEYWORDS)) {
    for (const word of words) {
      const key = normalizeForMatch(word)
      if (!key) continue
      if (key.includes(' ')) {
        phrases.push({ text: key, category, words: key.split(' ').length })
        continue
      }
      put(tokens, key, category)
      // Слова через дефис индексируем и как одно слово: «бизнес-ланч».
      if (key.includes('-')) put(tokens, key.replace(/-/g, ''), category)
      const st = stem(key)
      if (st.length >= 4) put(stems, st, category)
    }
  }

  phrases.sort((a, b) => b.words - a.words || b.text.length - a.text.length)
  return { phrases, tokens, stems, stemList: [...stems.keys()] }
}

function getIndex(): Index {
  if (!index) index = buildIndex()
  return index
}

/** Расстояние Дамерау — Левенштейна с ранним выходом. */
function editDistance(a: string, b: string, max: number): number {
  const n = a.length
  const m = b.length
  if (Math.abs(n - m) > max) return max + 1

  let prev2: number[] = []
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j)
  let curr: number[] = new Array(m + 1)

  for (let i = 1; i <= n; i++) {
    curr[0] = i
    let rowMin = curr[0]!
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
      // перестановка соседних букв — «продкуты» вместо «продукты»
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2]! + 1)
      }
      curr[j] = value
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    prev2 = prev
    prev = curr
    curr = new Array(m + 1)
  }
  return prev[m]!
}

/**
 * Определяет категорию. Функция чистая: правила пользователя передаются
 * снаружи, поэтому её легко тестировать без базы.
 */
export function classify(raw: string, rules: UserRules = EMPTY_RULES): ClassifyResult {
  const norm = normalizeForMatch(raw)
  if (!norm) {
    return { category: OTHER_CATEGORY, confidence: 0, status: 'no_signal', suggestions: [] }
  }

  // Слой 1: пользователь уже поправил ровно эту фразу.
  const exact = rules.exact.get(norm)
  if (exact) {
    return { category: exact, confidence: 1, status: 'confident', suggestions: [] }
  }

  const { phrases, tokens, stems, stemList } = getIndex()
  const scores = new Map<string, number>()
  const order: string[] = []

  const add = (category: string, weight: number) => {
    if (!scores.has(category)) order.push(category)
    scores.set(category, (scores.get(category) ?? 0) + weight)
  }

  // Слой 2: многословные фразы. Совпавший кусок вычёркивается, чтобы его
  // отдельные слова не начислили вес второй раз.
  let work = ' ' + norm + ' '
  for (const phrase of phrases) {
    const needle = ' ' + phrase.text + ' '
    if (work.includes(needle)) {
      add(phrase.category, W.phrase + W.phraseWordBonus * (phrase.words - 1))
      work = work.split(needle).join('  ')
    }
  }

  const words = work.split(/\s+/).filter((w) => w && !STOPWORDS.has(w))

  // Слой 3: пословные правила пользователя — сильнее любого словаря.
  for (const word of words) {
    const own = rules.token.get(word) ?? rules.token.get(stem(word))
    if (own) add(own, W.userToken)
  }

  // Слой 4: словарь.
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    // Первое слово — тема строки, ему небольшой перевес.
    const boost = i === 0 ? W.headBoost : 1

    const direct = tokens.get(word)
    if (direct) {
      const penalty = direct.size > 1 ? AMBIG_PENALTY : 1
      for (const c of direct) add(c, W.exact * boost * penalty)
      continue
    }

    const wordStem = stem(word)
    const hits = new Set<string>(stems.get(wordStem) ?? [])
    for (const key of stemList) {
      if (key.length >= 4 && word.startsWith(key)) {
        for (const c of stems.get(key)!) hits.add(c)
      }
    }
    if (hits.size > 0) {
      const penalty = hits.size > 1 ? AMBIG_PENALTY : 1
      for (const c of hits) add(c, W.stem * boost * penalty)
      continue
    }

    // Опечатки. Ограничители тут несущие: без якоря по первым двум буквам
    // «дочки» цеплялось за «очки» и уводило одежду в здоровье.
    if (word.length >= 6) {
      const maxDistance = word.length >= 9 ? 2 : 1
      let best: { category: string; distance: number } | null = null
      let bestTied = false
      for (const [key, cats] of tokens) {
        if (Math.abs(key.length - word.length) > maxDistance) continue
        if (key.slice(0, 2) !== word.slice(0, 2)) continue
        const distance = editDistance(word, key, maxDistance)
        if (distance > maxDistance) continue
        if (distance / key.length > 0.25) continue
        if (cats.size !== 1) continue
        const category = [...cats][0]!
        if (!best || distance < best.distance) {
          best = { category, distance }
          bestTied = false
        } else if (distance === best.distance && category !== best.category) {
          bestTied = true
        }
      }
      if (best && !bestTied) {
        add(best.category, (best.distance === 1 ? W.fuzzyD1 : W.fuzzyD2) * boost)
      }
    }
  }

  if (scores.size === 0) {
    return { category: OTHER_CATEGORY, confidence: 0, status: 'no_signal', suggestions: [] }
  }

  // Слой 5: привычки пользователя решают только ничью.
  for (const [category, prior] of rules.prior) {
    if (scores.has(category)) scores.set(category, scores.get(category)! + 0.15 * prior)
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const top = ranked[0]![1]
  // Внутри верхней полосы побеждает та категория, что сработала раньше:
  // «порошок и шампунь» — это хозтовары (первое слово), а не подбрасывание монеты.
  const band = ranked.filter(([, v]) => v >= top * 0.85).map(([c]) => c)
  const winner = band.reduce((a, b) => (order.indexOf(a) <= order.indexOf(b) ? a : b))
  const s1 = scores.get(winner)!
  const s2 = ranked.filter(([c]) => c !== winner).reduce((max, [, v]) => Math.max(max, v), 0)

  const margin = s1 / (s1 + s2 + K_MARGIN)
  const absolute = Math.min(1, s1 / S_FULL)
  const confidence = Math.min(margin, absolute)

  const suggestions = ranked
    .map(([c]) => c)
    .filter((c) => c !== winner)
    .slice(0, 2)

  if (s1 < SCORE_MIN) {
    return { category: OTHER_CATEGORY, confidence, status: 'no_signal', suggestions }
  }
  if (confidence < CONF_MIN) {
    return {
      category: winner,
      confidence: Math.max(0.5, confidence),
      status: 'ambiguous',
      suggestions: [winner, ...suggestions].slice(0, 2),
    }
  }
  return { category: winner, confidence, status: 'confident', suggestions }
}

/** Категория, названная прямо в сообщении: «продукты 300 #дом». */
export function explicitCategory(raw: string): string | null {
  const norm = normalizeForMatch(raw)
  for (const category of CATEGORIES) {
    const name = normalizeForMatch(category.name)
    if (norm === name || norm.startsWith(name + ' ') || norm.endsWith(' ' + name)) {
      return category.slug
    }
  }
  return null
}

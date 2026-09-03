/**
 * Разбор строки траты: «кофе 350», «такси 900 работа», «вчера 1.5к продукты»,
 * «обед 45 usd», «нон 5 сомони», «01.09 кофе 20».
 *
 * Принципы:
 *  • Сумма может стоять до или после описания.
 *  • Разделитель дробной части — и точка, и запятая.
 *  • «к» после числа означает тысячи; «смн» — сомони.
 *  • Дата в тексте («вчера», «01.09», «3 сентября») вырезается из описания.
 *  • Если разобрать не удалось, возвращается причина, а не молчаливый ноль.
 */
import { CURRENCIES, DEFAULT_CURRENCY, isValidCurrency } from './money'

export type ParseFailure =
  | 'empty'
  | 'no-amount'
  | 'amount-not-positive'
  | 'amount-too-large'

export interface ParsedExpense {
  /** сумма в основных единицах, всегда > 0 */
  amount: number
  currency: string
  /** описание без суммы, валюты и даты */
  description: string
  /** сдвиг дня относительно сегодняшнего: 0 — сегодня, −1 — вчера */
  dayOffset: number
  /** явная дата из текста, если была; год может отсутствовать */
  explicitDate: { year: number | null; month: number; day: number } | null
  /** валюта была указана словом, а не подставлена по умолчанию */
  currencyExplicit: boolean
  /** нормализованная исходная строка */
  raw: string
}

export type ParseResult =
  | { ok: true; value: ParsedExpense }
  | { ok: false; reason: ParseFailure; raw: string }

/** Верхняя граница: защищает от «телефон 992900000000». */
const MAX_AMOUNT = 100_000_000

/** Пробельные символы, которыми разделяют разряды: NBSP, узкий пробел, апострофы. */
const THIN_SPACES = /[    '’]/g

const MONTHS: Array<[RegExp, number]> = [
  [/^янв(ар[ьяе])?$/, 1],
  [/^фев(рал[ьяе])?$/, 2],
  [/^мар(та?|те)?$/, 3],
  [/^апр(ел[ьяе])?$/, 4],
  [/^ма[йяе]$/, 5],
  [/^июн[ьяе]?$/, 6],
  [/^июл[ьяе]?$/, 7],
  [/^авг(уста?|усте)?$/, 8],
  [/^сен(т|тябр[ьяе])?$/, 9],
  [/^окт(ябр[ьяе])?$/, 10],
  [/^ноя(бр[ьяе])?$/, 11],
  [/^дек(абр[ьяе])?$/, 12],
]

/** Множители сразу после числа: 2к = 2000. Сверяются по началу остатка. */
const MULTIPLIERS: Array<[RegExp, number]> = [
  [/^(кк|kk|млн|мио)/i, 1_000_000],
  [/^(тыс\.?|к|k|т)/i, 1000],
]

/** Алиас валюты → код. Длинные алиасы проверяются первыми. */
const CURRENCY_ALIASES: Array<[string, string]> = Object.values(CURRENCIES)
  .flatMap((info) => info.aliases.map((a) => [a.toLowerCase(), info.code] as [string, string]))
  .sort((a, b) => b[0].length - a[0].length)

/**
 * «с» — это сомони: так пишут в Душанбе. Но «с» ещё и предлог, поэтому
 * отдельным словом оно считается валютой только в конце строки:
 *   «такси 20 с»        → 20 сомони
 *   «кафе 120 с другом» → 120 сомони, описание «кафе с другом»
 * Приклеенное к числу («20с») — всегда валюта.
 */
const SHORT_ALIASES: Array<[string, string]> = [
  ['с', 'TJS'],
  ['c', 'TJS'],
  ['сом', 'TJS'],
  ['сомон', 'TJS'],
  ['сн', 'TJS'],
  ['р', 'RUB'],
  ['руб', 'RUB'],
  ['е', 'EUR'],
]

function aliasToCode(value: string, allowShort: boolean): string | null {
  const lower = value.toLowerCase().replace(/\.$/, '')
  if (!lower) return null
  for (const [alias, code] of CURRENCY_ALIASES) {
    if (lower === alias) return code
  }
  if (allowShort) {
    for (const [alias, code] of SHORT_ALIASES) {
      if (lower === alias) return code
    }
  }
  // Любой действующий код ISO 4217: «обед 45 gbp», «такси 300 pkr».
  // Проверка по списку, а не по маске «три латинские буквы», иначе
  // «gym 500» превратилось бы в валюту GYM.
  if (/^[a-z]{3}$/.test(lower) && isValidCurrency(lower)) return lower.toUpperCase()
  return null
}

/** ё → е, лишние пробелы прочь. */
export function normalize(text: string): string {
  return text.replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim()
}

/**
 * Склеивает то, что человек разделил пробелом, но имел в виду одно число:
 *   «12 500»    → «12500»   (разряды)
 *   «3 тыс»     → «3тыс»    (множитель словом)
 *
 * Однобуквенные множители («к», «т») отдельным словом сознательно не клеим:
 * в «такси 900 к дому» это предлог, и склейка дала бы 900 000.
 *
 * Граница слова пишется как (?![\p{L}\p{N}]), а не :  в JavaScript
 * опирается на ASCII-класс \w и после кириллицы не срабатывает.
 */
function glueNumbers(text: string): string {
  return text
    .replace(/(?<=\d)\s+(?=\d{3}\b)/g, '')
    .replace(/(\d)\s+(тыс\.?|тысяч[иа]?|млн|мио|кк)(?![\p{L}\p{N}])/giu, '$1$2')
}

interface Token {
  text: string
  start: number
  end: number
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  }
  return tokens
}

/** Убирает обрамляющую пунктуацию, оставляя знаки внутри слова. */
function trimPunct(value: string): string {
  return value
    .replace(/^[^\p{L}\p{N}+$€₽₸¥₺]+/u, '')
    .replace(/[^\p{L}\p{N}%$€₽₸¥₺]+$/u, '')
}

interface AmountMatch {
  value: number
  currency: string | null
  /** индексы токенов, которые нужно вырезать из описания */
  tokenIndexes: number[]
  /** сумма записана вместе с валютой или множителем — сильный признак */
  strong: boolean
}

/**
 * Превращает «1 250,50», «1'250.5», «2к», «120+80», «3*150» в число.
 * Возвращает null, если это не число.
 */
function parseNumeric(chunk: string): { value: number; strong: boolean } | null {
  const cleaned = chunk.replace(THIN_SPACES, '')

  // Арифметика: только + и *, только между числами.
  if (/^\d+(?:[.,]\d+)?(?:[+*]\d+(?:[.,]\d+)?)+$/.test(cleaned)) {
    const parts = cleaned.split(/([+*])/)
    let acc = Number(parts[0]!.replace(',', '.'))
    for (let i = 1; i < parts.length; i += 2) {
      const next = Number(parts[i + 1]!.replace(',', '.'))
      if (!Number.isFinite(next)) return null
      acc = parts[i] === '+' ? acc + next : acc * next
    }
    return Number.isFinite(acc) ? { value: acc, strong: true } : null
  }

  const m = /^(\d+(?:[.,]\d+)?)(.*)$/.exec(cleaned)
  if (!m) return null
  let value = Number(m[1]!.replace(',', '.'))
  if (!Number.isFinite(value)) return null

  let rest = m[2] ?? ''
  let strong = false

  for (const [re, factor] of MULTIPLIERS) {
    const cut = re.exec(rest)
    if (cut) {
      value *= factor
      rest = rest.slice(cut[0].length)
      strong = true
      break
    }
  }

  // Остаток обязан быть пустым или алиасом валюты — иначе это не сумма,
  // а что-то вроде «20кофе» или куска номера телефона.
  if (rest.length > 0) {
    if (!aliasToCode(rest, true)) return null
    strong = true
  }
  return { value, strong }
}

/**
 * Валюта отдельным словом. Короткое «с» принимается, только если после него
 * ничего нет — иначе это предлог.
 */
function currencyFromToken(raw: string, isLastToken: boolean): string | null {
  return aliasToCode(trimPunct(raw), isLastToken)
}

/** Хвост числа: «20с», «45usd», «1250смн». */
function currencySuffix(raw: string): string | null {
  const cleaned = raw.replace(THIN_SPACES, '')
  const m = /^\d+(?:[.,]\d+)?(?:кк|kk|млн|мио|тыс\.?|к|k|т)?(.+)$/i.exec(cleaned)
  if (!m) return null
  return aliasToCode(m[1]!, true)
}

/** Символ валюты перед числом в одном токене: «$20», «₽1500». */
function splitCurrencyPrefix(raw: string): { currency: string; rest: string } | null {
  const m = /^([^\d\s]{1,5})(\d.*)$/u.exec(raw)
  if (!m) return null
  const code = aliasToCode(m[1]!, false)
  return code ? { currency: code, rest: m[2]! } : null
}

interface DateMatch {
  dayOffset: number
  explicit: { year: number | null; month: number; day: number } | null
  tokenIndexes: number[]
}

/**
 * Ищет дату. Числовые форматы принимаются только если после их изъятия
 * в строке остаётся другое число: иначе «20.50 кофе» (двадцать сомони
 * пятьдесят дирам) превратилось бы в 20 мая.
 */
function findDate(tokens: Token[], numericTokenCount: number): DateMatch | null {
  const lower = tokens.map((t) => trimPunct(t.text).toLowerCase())

  const relative: Record<string, number> = { сегодня: 0, вчера: -1, позавчера: -2 }
  for (let i = 0; i < lower.length; i++) {
    const offset = relative[lower[i]!]
    if (offset !== undefined) {
      return { dayOffset: offset, explicit: null, tokenIndexes: [i] }
    }
  }

  // «3 сентября», «3 сен»
  for (let i = 0; i < lower.length - 1; i++) {
    const day = /^(\d{1,2})$/.exec(lower[i]!)
    if (!day) continue
    const found = MONTHS.find(([re]) => re.test(lower[i + 1]!))
    if (!found) continue
    const d = Number(day[1])
    if (d < 1 || d > 31) continue
    return { dayOffset: 0, explicit: { year: null, month: found[1], day: d }, tokenIndexes: [i, i + 1] }
  }

  // «01.09», «1/9», «01.09.2026» — только при наличии второго числа
  if (numericTokenCount >= 2) {
    for (let i = 0; i < lower.length; i++) {
      const m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/.exec(lower[i]!)
      if (!m) continue
      const day = Number(m[1])
      const month = Number(m[2])
      if (day < 1 || day > 31 || month < 1 || month > 12) continue
      let year: number | null = null
      if (m[3]) {
        const y = Number(m[3])
        year = y < 100 ? 2000 + y : y
      }
      return { dayOffset: 0, explicit: { year, month, day }, tokenIndexes: [i] }
    }
  }

  return null
}

/** Разбирает одну строку. Валюта по умолчанию — валюта пользователя. */
export function parseExpense(input: string, defaultCurrency = DEFAULT_CURRENCY): ParseResult {
  const raw = input ?? ''
  const text = glueNumbers(normalize(raw))
  if (!text) return { ok: false, reason: 'empty', raw }

  const tokens = tokenize(text)
  const consumed = new Set<number>()

  const numericLike = tokens.filter((t) => /\d/.test(t.text)).length
  const date = findDate(tokens, numericLike)
  if (date) for (const i of date.tokenIndexes) consumed.add(i)

  // --- поиск суммы ---------------------------------------------------------
  const candidates: AmountMatch[] = []

  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue
    const bare = trimPunct(tokens[i]!.text)
    if (!bare || !/\d/.test(bare)) continue

    // «$20» — валюта приклеена спереди
    const prefixed = splitCurrencyPrefix(bare)
    const body = prefixed ? prefixed.rest : bare

    const numeric = parseNumeric(body)
    if (!numeric) continue

    let currency = prefixed?.currency ?? currencySuffix(body)
    const indexes = [i]
    let strong = numeric.strong || Boolean(prefixed)

    // Валюта отдельным словом справа: «45 usd», «5 сомони», «20 с».
    if (!currency && i + 1 < tokens.length && !consumed.has(i + 1)) {
      const next = currencyFromToken(tokens[i + 1]!.text, i + 1 === tokens.length - 1)
      if (next) {
        currency = next
        indexes.push(i + 1)
        strong = true
      }
    }
    // Валюта отдельным словом слева: «usd 45».
    if (!currency && i > 0 && !consumed.has(i - 1)) {
      const prev = currencyFromToken(tokens[i - 1]!.text, false)
      if (prev) {
        currency = prev
        indexes.push(i - 1)
        strong = true
      }
    }

    candidates.push({ value: numeric.value, currency, tokenIndexes: indexes, strong })
  }

  if (candidates.length === 0) return { ok: false, reason: 'no-amount', raw }

  // Из нескольких чисел берём «сильное» (с валютой или множителем),
  // при равной силе — последнее: «интернет 150 месяц» → 150, а не «месяц».
  let chosen = candidates[0]!
  for (const candidate of candidates) {
    if (candidate.strong || !chosen.strong) chosen = candidate
  }

  if (!(chosen.value > 0)) return { ok: false, reason: 'amount-not-positive', raw }
  if (chosen.value > MAX_AMOUNT) return { ok: false, reason: 'amount-too-large', raw }

  for (const i of chosen.tokenIndexes) consumed.add(i)

  // --- описание ------------------------------------------------------------
  const description = tokens
    .filter((_, i) => !consumed.has(i))
    .map((t) => t.text)
    .join(' ')
    .replace(/[\s,;.:—–-]+$/u, '')
    .replace(/^[\s,;.:—–-]+/u, '')
    .trim()

  return {
    ok: true,
    value: {
      amount: Math.round(chosen.value * 100) / 100,
      currency: chosen.currency ?? defaultCurrency,
      currencyExplicit: chosen.currency !== null,
      description,
      dayOffset: date?.dayOffset ?? 0,
      explicitDate: date?.explicit ?? null,
      raw: text,
    },
  }
}

/**
 * Делит сообщение на несколько трат по явным разделителям — точке с запятой
 * и переводу строки. Запятая разделителем НЕ считается: «кафе 120, с другом»
 * это одна трата с уточнением, а не две.
 */
export function splitEntries(input: string): string[] {
  return input
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Человеческое объяснение, почему не разобралось. */
export function explainFailure(reason: ParseFailure): string {
  switch (reason) {
    case 'empty':
      return 'Пустое сообщение.'
    case 'no-amount':
      return 'Не нашёл сумму. Напишите, например: «кофе 350».'
    case 'amount-not-positive':
      return 'Сумма должна быть больше нуля.'
    case 'amount-too-large':
      return 'Сумма слишком большая — похоже на опечатку.'
  }
}

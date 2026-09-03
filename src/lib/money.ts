/**
 * Деньги. Все суммы — целые числа в минорных единицах
 * (1 сомони = 100 дирамов). Ни одного float в арифметике.
 */

export interface CurrencyInfo {
  code: string
  /** сколько знаков после запятой */
  exponent: number
  /** как показываем в интерфейсе */
  symbol: string
  /** родительный падеж для текста бота */
  name: string
  /** слова, по которым валюта узнаётся во входящем сообщении */
  aliases: string[]
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  TJS: {
    code: 'TJS',
    exponent: 2,
    symbol: 'смн',
    name: 'сомони',
    aliases: ['сомони', 'смн', 'somoni', 'tjs', 'сомонӣ'],
  },
  USD: {
    code: 'USD',
    exponent: 2,
    symbol: '$',
    name: 'долларов',
    aliases: ['$', 'usd', 'долл', 'доллар', 'долларов', 'бакс', 'баксов', 'дол'],
  },
  EUR: {
    code: 'EUR',
    exponent: 2,
    symbol: '€',
    name: 'евро',
    aliases: ['€', 'eur', 'евро'],
  },
  RUB: {
    code: 'RUB',
    exponent: 2,
    symbol: '₽',
    name: 'рублей',
    aliases: ['₽', 'rub', 'рубль', 'рублей', 'рубля'],
  },
  UZS: {
    code: 'UZS',
    exponent: 2,
    symbol: 'сум',
    name: 'сумов',
    aliases: ['uzs', 'сум', 'сумов', 'сумм'],
  },
  KGS: {
    code: 'KGS',
    exponent: 2,
    // Не «сом»: это сокращение занято сомони («такси 20 сом»),
    // и два разных символа «сом» в одной ленте сбивали бы с толку.
    symbol: 'KGS',
    name: 'киргизских сомов',
    aliases: ['kgs', 'кгс'],
  },
  KZT: {
    code: 'KZT',
    exponent: 2,
    symbol: '₸',
    name: 'тенге',
    aliases: ['kzt', '₸', 'тенге'],
  },
  CNY: {
    code: 'CNY',
    exponent: 2,
    symbol: '¥',
    name: 'юаней',
    aliases: ['cny', '¥', 'юань', 'юаней'],
  },
  TRY: {
    code: 'TRY',
    exponent: 2,
    symbol: '₺',
    name: 'лир',
    aliases: ['try', '₺', 'лир', 'лира'],
  },
  AED: {
    code: 'AED',
    exponent: 2,
    symbol: 'AED',
    name: 'дирхамов',
    aliases: ['aed', 'дирхам', 'дирхамов'],
  },
}

export const DEFAULT_CURRENCY = 'TJS'

/**
 * Действующие коды ISO 4217. Нужны, чтобы принимать любую валюту
 * («обед 45 gbp», «такси 300 pkr»), но не считать валютой случайное
 * трёхбуквенное слово вроде «gym» или «for».
 */
export const ISO_4217 = new Set<string>(
  (
    'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN ' +
    'BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD ' +
    'FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD ' +
    'JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT ' +
    'MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG ' +
    'QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS ' +
    'TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ' +
    'ZMW ZWG'
  ).split(' '),
)

/** Валюты без дробной части — у них 0 знаков после запятой. */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
])
/** Валюты с тремя знаками. */
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'])

export function currencyInfo(code: string): CurrencyInfo {
  const upper = code.toUpperCase()
  const known = CURRENCIES[upper]
  if (known) return known
  return {
    code: upper,
    exponent: ZERO_DECIMAL.has(upper) ? 0 : THREE_DECIMAL.has(upper) ? 3 : 2,
    symbol: upper,
    name: upper,
    aliases: [],
  }
}

/** Валюта из нашего справочника — для неё есть символ и склонение. */
export function isKnownCurrency(code: string): boolean {
  return Object.hasOwn(CURRENCIES, code.toUpperCase())
}

/** Валюта вообще существует по ISO 4217. */
export function isValidCurrency(code: string): boolean {
  return ISO_4217.has(code.toUpperCase())
}

/** Множитель минорных единиц: 100 для двух знаков. */
export function minorFactor(code: string): number {
  return 10 ** currencyInfo(code).exponent
}

/**
 * Переводит «человеческое» число в минорные единицы.
 * Округление — банковское не нужно, деньги вводит человек: обычный round.
 */
export function toMinor(amount: number, code: string): number {
  return Math.round(amount * minorFactor(code))
}

export function fromMinor(minor: number, code: string): number {
  return minor / minorFactor(code)
}

const NBSP = '\u00A0'

/**
 * Форматирование суммы для интерфейса и бота.
 * Копейки/дирамы показываем только если они есть — «350 смн», а не «350,00 смн».
 */
export function formatMoney(
  minor: number,
  code: string,
  opts: { withSymbol?: boolean; forceFraction?: boolean; sign?: boolean } = {},
): string {
  const { withSymbol = true, forceFraction = false, sign = false } = opts
  const info = currencyInfo(code)
  const factor = minorFactor(code)
  const negative = minor < 0
  const abs = Math.abs(minor)
  const hasFraction = abs % factor !== 0
  const digits = forceFraction || hasFraction ? info.exponent : 0

  const value = (abs / factor).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  // toLocaleString в ru-RU разделяет разряды узким пробелом — заменяем на NBSP,
  // он одинаково выглядит и в Telegram, и в браузере.
  const normalized = value.replace(/[\u202F\u2009\s]/g, NBSP)

  const prefix = negative ? '−' : sign ? '+' : ''
  return withSymbol ? `${prefix}${normalized}${NBSP}${info.symbol}` : `${prefix}${normalized}`
}

/** Компактная запись для подписей на графике: 12,4 тыс. */
export function formatCompact(minor: number, code: string): string {
  const info = currencyInfo(code)
  const value = Math.abs(minor) / minorFactor(code)
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}${NBSP}млн`
  }
  if (value >= 100_000) {
    return `${(value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 0 })}${NBSP}тыс`
  }
  if (value >= 1000) {
    // До сотни тысяч оставляем десятую долю: «12,5 тыс» точнее, чем «13 тыс»,
    // и разница в один символ.
    return `${(value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}${NBSP}тыс`
  }
  return value.toLocaleString('ru-RU', { maximumFractionDigits: info.exponent })
}

/**
 * Пересчёт между валютами по курсу «1 from = rate to».
 * Учитывает разную точность валют.
 */
export function convertMinor(minor: number, from: string, to: string, rate: number): number {
  if (from.toUpperCase() === to.toUpperCase()) return minor
  const value = fromMinor(minor, from) * rate
  return toMinor(value, to)
}

/** Доля в процентах, безопасная к нулевому знаменателю. */
export function percentOf(part: number, total: number): number {
  if (!total) return 0
  return (part / total) * 100
}

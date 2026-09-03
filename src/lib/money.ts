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
    aliases: ['сомони', 'смн', 'somoni', 'tjs', 'сом.', 'с.'],
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
    aliases: ['₽', 'rub', 'руб', 'рубль', 'рублей', 'рубля', 'р.'],
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
    symbol: 'сом',
    name: 'сомов',
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

export function currencyInfo(code: string): CurrencyInfo {
  return (
    CURRENCIES[code.toUpperCase()] ?? {
      code: code.toUpperCase(),
      exponent: 2,
      symbol: code.toUpperCase(),
      name: code.toUpperCase(),
      aliases: [],
    }
  )
}

export function isKnownCurrency(code: string): boolean {
  return Object.hasOwn(CURRENCIES, code.toUpperCase())
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
  if (value >= 10_000) {
    return `${(value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 0 })}${NBSP}тыс`
  }
  if (value >= 1000) {
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

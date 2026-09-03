/**
 * Курсы валют.
 *
 * Договорённость о направлении курса одна на весь проект:
 *   rate(base, quote) — сколько единиц `base` стоит ОДНА единица `quote`.
 *   Пример: base=TJS, quote=USD, rate≈9.24 → 1 доллар = 9,24 сомони.
 *
 * Источник — open.er-api.com: бесплатный, без ключа и регистрации, обновляется
 * раз в сутки. Если сети нет, берётся встроенная таблица: трата всё равно
 * сохранится, а курс потом можно пересчитать. Молча подставлять 1:1 нельзя —
 * это испортило бы все итоги.
 */
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { rates } from './db/schema'

/**
 * Снимок курсов к сомони на 2026-09-03 (open.er-api.com).
 * Используется, когда нет сети. Значения — «сколько сомони за единицу валюты».
 */
export const OFFLINE_RATES: Record<string, number> = {
  TJS: 1,
  USD: 9.2382,
  EUR: 10.6826,
  RUB: 0.1066,
  UZS: 0.00078,
  KGS: 0.1056,
  KZT: 0.02029,
  CNY: 1.3714,
  TRY: 0.1910,
  AED: 2.5152,
  GBP: 12.4419,
  JPY: 0.0623,
  INR: 0.1051,
  PKR: 0.0334,
  AFN: 0.1338,
  TMT: 2.6395,
  AZN: 5.4342,
  GEL: 3.4179,
  AMD: 0.0241,
  BYN: 3.0917,
  UAH: 0.2236,
  CHF: 11.5217,
  CAD: 6.6980,
  AUD: 6.0576,
  KRW: 0.0067,
  THB: 0.2871,
  SAR: 2.4635,
  MYR: 2.1898,
  SGD: 7.1878,
  HKD: 1.1861,
  PLN: 2.5121,
  CZK: 0.4361,
  SEK: 0.9683,
  NOK: 0.9184,
  DKK: 1.4317,
}

const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000

/** Курс из кэша базы; null, если его там нет или он протух. */
function cachedRate(base: string, quote: string, maxAgeMs = 7 * 24 * 60 * 60 * 1000): number | null {
  const row = db
    .select()
    .from(rates)
    .where(and(eq(rates.base, base), eq(rates.quote, quote)))
    .get()
  if (!row) return null
  if (Date.now() - row.fetchedAt > maxAgeMs) return null
  return row.rate
}

/**
 * Курс для пересчёта. Порядок: та же валюта → кэш → встроенная таблица.
 * Функция синхронная: бот и панель не должны ждать сети, чтобы записать трату.
 */
export function getRate(base: string, quote: string): { rate: number; source: 'same' | 'cache' | 'offline' | 'unknown' } {
  const b = base.toUpperCase()
  const q = quote.toUpperCase()
  if (b === q) return { rate: 1, source: 'same' }

  const cached = cachedRate(b, q)
  if (cached !== null && cached > 0) return { rate: cached, source: 'cache' }

  const offlineBase = OFFLINE_RATES[b]
  const offlineQuote = OFFLINE_RATES[q]
  if (offlineBase && offlineQuote) {
    return { rate: offlineQuote / offlineBase, source: 'offline' }
  }

  // Курс неизвестен: возвращаем 1, но помечаем источник — вызывающий код
  // обязан предупредить пользователя, а не делать вид, что всё сошлось.
  return { rate: 1, source: 'unknown' }
}

let lastRefresh = 0

/**
 * Тянет свежие курсы и складывает их в базу.
 * Вызывается ботом при старте и раз в 12 часов; ошибка сети не критична.
 */
export async function refreshRates(base = 'TJS', url?: string): Promise<number> {
  const now = Date.now()
  if (now - lastRefresh < REFRESH_INTERVAL_MS) return 0
  lastRefresh = now

  const endpoint = url ?? `https://open.er-api.com/v6/latest/${base}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)

  try {
    const response = await fetch(endpoint, { signal: controller.signal })
    if (!response.ok) throw new Error(`курсы недоступны: HTTP ${response.status}`)
    const payload = (await response.json()) as {
      result?: string
      base_code?: string
      rates?: Record<string, number>
    }
    if (payload.result !== 'success' || !payload.rates) {
      throw new Error('ответ сервиса курсов в неожиданном формате')
    }

    const baseCode = (payload.base_code ?? base).toUpperCase()
    const entries = Object.entries(payload.rates).filter(
      ([, value]) => Number.isFinite(value) && value > 0,
    )

    db.transaction((tx) => {
      for (const [quote, perBase] of entries) {
        // API отдаёт «сколько quote за одну base»; нам нужно наоборот.
        const rate = 1 / perBase
        tx.insert(rates)
          .values({ base: baseCode, quote: quote.toUpperCase(), rate, fetchedAt: now })
          .onConflictDoUpdate({
            target: [rates.base, rates.quote],
            set: { rate, fetchedAt: now },
          })
          .run()
      }
    })
    return entries.length
  } catch (error) {
    // Молча живём на встроенной таблице — трату важнее сохранить, чем курс.
    console.warn('[курсы] обновить не удалось:', (error as Error).message)
    return 0
  } finally {
    clearTimeout(timer)
  }
}

/** Сбрасывает троттлинг — нужно в тестах и в ручной команде обновления. */
export function resetRefreshThrottle(): void {
  lastRefresh = 0
}

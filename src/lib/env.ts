import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(20, 'нужен токен от @BotFather'),
  TELEGRAM_BOT_USERNAME: z.string().min(1).default('SomoniTrackerBot'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET слишком короткий'),
  DATABASE_PATH: z.string().default('./data/tracker.db'),
  DEFAULT_TIMEZONE: z.string().default('Asia/Dushanbe'),
  DEFAULT_CURRENCY: z.string().default('TJS'),
  EXCHANGE_RATES_URL: z.string().optional(),
  ENABLE_RECEIPT_OCR: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  ADMIN_TELEGRAM_IDS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

/**
 * Читает и валидирует переменные окружения. Падает с понятным текстом,
 * а не с `undefined is not a function` где-то в глубине.
 */
export function env(): Env {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`)
    throw new Error(
      'Не хватает переменных окружения:\n' +
        lines.join('\n') +
        '\n\nСкопируйте .env.example в .env и заполните значения.',
    )
  }
  cached = parsed.data
  return cached
}

/** Мягкая версия: для мест, где приложение должно работать и без токена. */
export function optionalEnv<K extends keyof Env>(key: K): Env[K] | undefined {
  try {
    return env()[key]
  } catch {
    return undefined
  }
}

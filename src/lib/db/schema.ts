/**
 * Схема базы. SQLite: все денежные суммы хранятся в минорных единицах
 * (целые числа), все временные метки — epoch-миллисекунды в UTC.
 * Никаких float для денег.
 */
import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

const now = sql`(unixepoch() * 1000)`

/** Пользователь = аккаунт Telegram. Отдельной регистрации нет. */
export const users = sqliteTable('users', {
  /** telegram user id */
  id: integer('id').primaryKey(),
  firstName: text('first_name').notNull().default(''),
  lastName: text('last_name'),
  username: text('username'),
  photoUrl: text('photo_url'),
  languageCode: text('language_code'),
  /** IANA-зона: от неё зависит, что такое «сегодня» */
  timezone: text('timezone').notNull().default('Asia/Dushanbe'),
  /** валюта отчётов; траты в других валютах пересчитываются в неё */
  baseCurrency: text('base_currency').notNull().default('TJS'),
  /** день начала недели: 1 = понедельник */
  weekStart: integer('week_start').notNull().default(1),
  createdAt: integer('created_at').notNull().default(now),
  lastSeenAt: integer('last_seen_at').notNull().default(now),
  /** первая успешно записанная трата — используется для онбординга */
  firstExpenseAt: integer('first_expense_at'),
})

/** Трата. Мягкое удаление, чтобы работала кнопка «Отменить». */
export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** сумма в валюте ввода, минорные единицы */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    /** та же сумма в базовой валюте пользователя */
    baseMinor: integer('base_minor').notNull(),
    /** курс на момент ввода: 1 currency = rate * baseCurrency */
    rate: real('rate').notNull().default(1),
    category: text('category').notNull(),
    description: text('description').notNull().default(''),
    /** момент траты в UTC (может отличаться от createdAt: «вчера такси 30») */
    spentAt: integer('spent_at').notNull(),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
    deletedAt: integer('deleted_at'),
    /** bot | web | ocr | seed */
    source: text('source').notNull().default('bot'),
    /** исходный текст сообщения — нужен для «почему такая категория» */
    rawText: text('raw_text'),
    chatId: integer('chat_id'),
    /** id сообщения-подтверждения бота: по нему правим карточку после изменения */
    messageId: integer('message_id'),
  },
  (t) => [
    index('expenses_user_spent_idx').on(t.userId, t.spentAt),
    index('expenses_user_alive_idx').on(t.userId, t.deletedAt),
    index('expenses_user_cat_idx').on(t.userId, t.category, t.spentAt),
  ],
)

/** Персональное обучение категориям: правка пользователя важнее словаря. */
export const categoryOverrides = sqliteTable(
  'category_overrides',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** нормализованная фраза-описание */
    phrase: text('phrase').notNull(),
    category: text('category').notNull(),
    hits: integer('hits').notNull().default(1),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.phrase] })],
)

/** Лимит по категории на календарный месяц. */
export const limits = sqliteTable(
  'limits',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    /** какой порог уже отправлен в этом периоде: 0 | 80 | 100 */
    notifiedLevel: integer('notified_level').notNull().default(0),
    /** ключ периода вида 2026-09 — при смене месяца пороги сбрасываются */
    periodKey: text('period_key').notNull().default(''),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('limits_user_category_idx').on(t.userId, t.category)],
)

/** Одноразовый токен входа: бот выдаёт ссылку, панель меняет её на сессию. */
export const authTokens = sqliteTable(
  'auth_tokens',
  {
    /** SHA-256 от токена, сам токен в базе не лежит */
    tokenHash: text('token_hash').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (t) => [index('auth_tokens_user_idx').on(t.userId)],
)

/** Серверная сессия панели. Cookie хранит только случайный id. */
export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 от значения cookie */
    idHash: text('id_hash').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now),
    expiresAt: integer('expires_at').notNull(),
    lastUsedAt: integer('last_used_at').notNull().default(now),
    /** magic-link | webapp | widget */
    origin: text('origin').notNull().default('magic-link'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

/** Кэш курсов валют к базовой. Пустая таблица = офлайн-таблица из кода. */
export const rates = sqliteTable(
  'rates',
  {
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    rate: real('rate').notNull(),
    fetchedAt: integer('fetched_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.base, t.quote] })],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Expense = typeof expenses.$inferSelect
export type NewExpense = typeof expenses.$inferInsert
export type Limit = typeof limits.$inferSelect
export type Session = typeof sessions.$inferSelect

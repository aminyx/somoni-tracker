import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

type Client = ReturnType<typeof create>

/**
 * Подключение создаётся при первом обращении, а не при импорте модуля.
 *
 * Это не оптимизация, а требование сборки: Next во время `next build`
 * загружает модули маршрутов, чтобы собрать метаданные. Если бы файл базы
 * открывался на импорте, сборка зависела бы от наличия и прав каталога
 * data/ — а в образе его на этом шаге ещё нет.
 *
 * В режиме разработки клиент живёт на globalThis: Next перезагружает модули
 * при каждой правке, и без этого на каждый hot-reload открывался бы новый
 * файловый дескриптор.
 */
const globalForDb = globalThis as unknown as { __trackerDb?: Client }

function create() {
  // Путь берётся из окружения, статически его не проследить —
  // сборщику это и не нужно, файл открывается во время работы.
  const path = resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH ?? './data/tracker.db')
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const sqlite = new Database(path)
  // WAL: панель читает, пока бот пишет, и никто никого не блокирует.
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('synchronous = NORMAL')

  return drizzle(sqlite, { schema })
}

function client(): Client {
  if (!globalForDb.__trackerDb) globalForDb.__trackerDb = create()
  return globalForDb.__trackerDb
}

/**
 * Клиент базы. Обёртка нужна, чтобы `db.select()` работал как обычно,
 * но само подключение появлялось только в момент первого запроса.
 */
export const db = new Proxy({} as Client, {
  get(_target, property, receiver) {
    const value = Reflect.get(client(), property, receiver)
    return typeof value === 'function' ? value.bind(client()) : value
  },
  has(_target, property) {
    return Reflect.has(client(), property)
  },
})

export { schema }
export * from './schema'

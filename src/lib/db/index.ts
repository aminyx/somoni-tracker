import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

/**
 * Единственный экземпляр подключения на процесс.
 * В dev-режиме Next перезагружает модули — держим клиент на globalThis,
 * иначе на каждый hot-reload открывается новый файловый дескриптор.
 */
const globalForDb = globalThis as unknown as {
  __trackerDb?: ReturnType<typeof create>
}

function create() {
  const path = resolve(process.env.DATABASE_PATH ?? './data/tracker.db')
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

export const db = globalForDb.__trackerDb ?? create()
if (process.env.NODE_ENV !== 'production') globalForDb.__trackerDb = db

export { schema }
export * from './schema'

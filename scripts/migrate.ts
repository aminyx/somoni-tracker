/**
 * Применяет миграции из каталога drizzle/.
 * Вызывается при старте бота и вручную: npm run db:migrate
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import 'dotenv/config'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export function runMigrations(databasePath?: string): string {
  const path = resolve(databasePath ?? process.env.DATABASE_PATH ?? './data/tracker.db')
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: resolve('./drizzle') })
  sqlite.close()
  return path
}

/**
 * Запущен ли файл напрямую, а не импортирован.
 *
 * Сравнивать import.meta.url со строкой `file://${argv[1]}` нельзя: на Windows
 * argv[1] это «D:\путь\migrate.ts», а import.meta.url — «file:///D:/путь%20с%20пробелом/…».
 * Они не совпадут никогда, и команда молча ничего не сделает.
 */
function isDirectRun(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(entry).href
  } catch {
    return false
  }
}

if (isDirectRun()) {
  const path = runMigrations()
  console.log(`База готова: ${path}`)
}

/**
 * Применяет миграции из каталога drizzle/.
 * Запускается при старте бота и вручную: npm run db:migrate
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import 'dotenv/config'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export function runMigrations(databasePath?: string): void {
  const path = resolve(databasePath ?? process.env.DATABASE_PATH ?? './data/tracker.db')
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: resolve('./drizzle') })
  sqlite.close()
}

// Запуск напрямую: node/tsx scripts/migrate.ts
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const path = resolve(process.env.DATABASE_PATH ?? './data/tracker.db')
  runMigrations(path)
  console.log(`База готова: ${path}`)
}

/**
 * Наполняет базу примерами для локального просмотра панели.
 *   npm run seed            — пользователь 1, «Демо»
 *   npm run seed -- 12345   — конкретный telegram id
 */
import 'dotenv/config'
import { runMigrations } from './migrate'
import { seedDemo, clearDemo } from '../src/lib/demo'
import { ensureUser } from '../src/lib/expenses'
import { issueLoginToken } from '../src/lib/auth'

runMigrations()

const id = Number(process.argv[2] ?? 1)
const user = ensureUser(
  { id, first_name: 'Демо', username: 'demo' },
  { timezone: process.env.DEFAULT_TIMEZONE, currency: process.env.DEFAULT_CURRENCY },
)

const removed = clearDemo(user.id)
const added = seedDemo(user)

const { token } = issueLoginToken(user.id)
const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')

console.log(`Пользователь ${user.id}: убрано ${removed}, добавлено ${added} трат.`)
console.log(`Ссылка для входа (10 минут, один раз):\n${base}/enter?t=${token}`)

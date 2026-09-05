/**
 * Панель и бот в одном контейнере.
 *
 * Нужно площадкам вроде Railway, Fly и Render: там постоянный том
 * подключается только к одной службе, а база — общий файл SQLite.
 * Два процесса в одном контейнере делят том без всяких ухищрений.
 *
 * Правила:
 *  • сначала миграции — оба процесса стартуют на готовой базе;
 *  • упал любой из двух — контейнер завершается с ошибкой, и площадка
 *    перезапускает его целиком: полуживой контейнер хуже мёртвого;
 *  • SIGTERM пересылается детям, чтобы бот успел закрыть long polling.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import 'dotenv/config'
import { runMigrations } from './migrate'

const require = createRequire(import.meta.url)
const nextBin = require.resolve('next/dist/bin/next')

const path = runMigrations()
console.log(`[запуск] база готова: ${path}`)

const children: ChildProcess[] = []
let shuttingDown = false

function launch(name: string, args: string[]): ChildProcess {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: process.env,
  })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.error(`[запуск] ${name} завершился (${signal ?? code}) — останавливаю всё`)
    shutdown(1)
  })
  children.push(child)
  console.log(`[запуск] ${name} pid=${child.pid}`)
  return child
}

function shutdown(exitCode: number): void {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  // Даём детям время закрыться, потом выходим в любом случае.
  setTimeout(() => process.exit(exitCode), 8000).unref()
  Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null) resolve()
          else child.once('exit', () => resolve())
        }),
    ),
  ).then(() => process.exit(exitCode))
}

process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))

launch('панель', [nextBin, 'start'])
launch('бот', ['--import', 'tsx', 'src/bot/index.ts'])

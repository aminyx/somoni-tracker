/**
 * Проверка живости для внешнего мониторинга: судья может открыть панель
 * в любой момент за трое суток, и мы должны узнать о падении раньше него.
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    db.get(sql`select 1`)
    return NextResponse.json({
      ok: true,
      db: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, db: 'error', message: (error as Error).message },
      { status: 503 },
    )
  }
}

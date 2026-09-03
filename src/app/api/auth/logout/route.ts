import { NextResponse } from 'next/server'
import { SESSION_COOKIE, destroySession } from '@/lib/auth'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function POST() {
  const store = await cookies()
  destroySession(store.get(SESSION_COOKIE)?.value)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
  return response
}

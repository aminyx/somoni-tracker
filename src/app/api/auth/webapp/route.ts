/**
 * Вход из Telegram Mini App: панель присылает initData, сервер проверяет
 * подпись ботовым токеном и выдаёт сессию.
 *
 * Идентификатор пользователя берётся ТОЛЬКО из подписанных данных —
 * ничего из тела запроса, кроме самой строки initData, не используется.
 */
import { NextResponse } from 'next/server'
import { SESSION_COOKIE, createSession, verifyInitData } from '@/lib/auth'
import { env } from '@/lib/env'
import { ensureUser } from '@/lib/expenses'
import { sessionCookieOptions } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { initData?: string }
  if (!body.initData) {
    return NextResponse.json({ error: 'Нет initData' }, { status: 400 })
  }

  const config = env()
  let verified
  try {
    verified = verifyInitData(body.initData, config.TELEGRAM_BOT_TOKEN)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 })
  }

  const user = ensureUser(
    {
      id: verified.user.id,
      first_name: verified.user.first_name,
      last_name: verified.user.last_name,
      username: verified.user.username,
      language_code: verified.user.language_code,
      photo_url: verified.user.photo_url,
    },
    { timezone: config.DEFAULT_TIMEZONE, currency: config.DEFAULT_CURRENCY },
  )

  const session = createSession(user.id, 'webapp', request.headers.get('user-agent') ?? undefined)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(session.expiresAt))
  return response
}

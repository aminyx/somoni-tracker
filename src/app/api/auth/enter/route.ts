/**
 * Обмен одноразового токена из бота на сессию панели.
 *
 * Только POST. Краулер превью ссылок Telegram открывает адрес GET-запросом
 * раньше человека — если бы токен сгорал на GET, пользователь получал бы
 * «ссылка уже использована» ещё до того, как нажал на неё.
 */
import { NextResponse } from 'next/server'
import { SESSION_COOKIE, consumeLoginToken, createSession } from '@/lib/auth'
import { getUser } from '@/lib/expenses'
import { sessionCookieOptions } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let token: string | null = null

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as { token?: string }
    token = body.token ?? null
  } else {
    const form = await request.formData().catch(() => null)
    token = (form?.get('token') as string | null) ?? null
  }

  if (!token) {
    return NextResponse.json({ error: 'Нет токена' }, { status: 400 })
  }

  const userId = consumeLoginToken(token)
  // Одна формулировка на все случаи: истёк, уже использован, не существует.
  // Подсказывать, какая именно причина, — значит помогать подбирать.
  if (!userId) {
    return NextResponse.json({ error: 'Ссылка недействительна' }, { status: 401 })
  }

  const user = getUser(userId)
  if (!user) {
    return NextResponse.json({ error: 'Ссылка недействительна' }, { status: 401 })
  }

  const session = createSession(userId, 'magic-link', request.headers.get('user-agent') ?? undefined)

  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(session.expiresAt))
  // Токен был в адресной строке: не отдаём его дальше через Referer.
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

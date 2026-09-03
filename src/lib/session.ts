import 'server-only'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, resolveSession } from './auth'
import type { User } from './db/schema'

/** Сессия из cookie. null — значит не вошёл. */
export async function currentUser(): Promise<User | null> {
  const store = await cookies()
  return resolveSession(store.get(SESSION_COOKIE)?.value)
}

/**
 * Параметры cookie сессии.
 *
 * sameSite: 'lax' — ссылка входа открывается переходом верхнего уровня
 * из Telegram, и при 'lax' cookie доходит. 'none' здесь хуже, а не лучше:
 * WKWebView на iOS 18 всё равно понижает 'none' до 'lax', так что в Mini App
 * полагаться на cookie нельзя — там работает свой путь через initData.
 *
 * secure включается только на https: иначе локальный запуск на
 * http://localhost не смог бы поставить cookie вовсе.
 */
export function sessionCookieOptions(expiresAt: number) {
  const https = (process.env.APP_URL ?? '').startsWith('https://')
  return {
    httpOnly: true,
    secure: https,
    sameSite: 'lax' as const,
    path: '/',
    expires: new Date(expiresAt),
  }
}

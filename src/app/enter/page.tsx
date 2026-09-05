/**
 * Страница подтверждения входа по ссылке из бота.
 *
 * Токен забирается только по нажатию кнопки, то есть POST-запросом.
 * Краулер превью ссылок Telegram ходит сюда GET-запросом раньше человека,
 * и если бы токен сгорал на GET, пользователь получал бы «ссылка уже
 * использована», ни разу по ней не перейдя.
 */
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { CommandText } from '@/components/CommandText'
import { localeFromHeader, t } from '@/lib/i18n'
import { SESSION_COOKIE, consumeLoginToken, createSession, peekLoginToken } from '@/lib/auth'
import { env } from '@/lib/env'
import { sessionCookieOptions } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Вход — Трекер расходов' }

async function enter(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const userId = consumeLoginToken(token)
  if (!userId) redirect('/enter?e=1')

  const session = createSession(userId, 'magic-link')
  const store = await cookies()
  store.set(SESSION_COOKIE, session.value, sessionCookieOptions(session.expiresAt))
  redirect('/app')
}

export default async function EnterPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; e?: string }>
}) {
  const params = await searchParams
  const token = params.t ?? ''
  const failed = params.e === '1'
  const valid = token ? peekLoginToken(token) : false
  const botUrl = `https://t.me/${env().TELEGRAM_BOT_USERNAME}`
  // Пользователь ещё не вошёл — язык берём из браузера.
  const L = localeFromHeader((await headers()).get('accept-language'))

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8">
        <div className="num text-[40px] leading-none text-[var(--text-3)]">смн</div>
      </div>

      {valid && !failed ? (
        <>
          <h1 className="mb-3 text-[22px] font-semibold leading-tight text-[var(--text-1)]">
            {t(L, 'enter.title')}
          </h1>
          <p className="mb-8 text-[15px] leading-relaxed text-[var(--text-2)]">
            {t(L, 'enter.body')}
          </p>
          <form action={enter}>
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="h-12 w-full rounded-[var(--r-sm)] bg-[var(--accent)] text-[15px] font-semibold text-[var(--on-accent)] transition-opacity active:opacity-80"
            >
              {t(L, 'enter.button')}
            </button>
          </form>
        </>
      ) : (
        <>
          <h1 className="mb-3 text-[22px] font-semibold leading-tight text-[var(--text-1)]">
            {t(L, 'enter.deadTitle')}
          </h1>
          <p className="mb-8 text-[15px] leading-relaxed text-[var(--text-2)]">
            <CommandText
              text={t(L, 'enter.deadBody', { command: '\u0000' })}
              command="/panel"
            />
          </p>
          <a
            href={botUrl}
            className="flex h-12 w-full items-center justify-center rounded-[var(--r-sm)] border border-[var(--border-strong)] text-[15px] font-medium text-[var(--text-1)]"
          >
            {t(L, 'landing.openBot')}
          </a>
        </>
      )}
    </main>
  )
}

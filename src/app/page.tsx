import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { env } from '@/lib/env'
import { EXAMPLES, localeFromHeader, t } from '@/lib/i18n'
import { CommandText } from '@/components/CommandText'
import { TelegramBridge } from '@/components/TelegramBridge'
import { currentUser } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Трекер расходов' }

export default async function HomePage() {
  const user = await currentUser()
  if (user) redirect('/app')

  const botUrl = `https://t.me/${env().TELEGRAM_BOT_USERNAME}`
  // Языка пользователя ещё нет — берём его из браузера.
  const L = localeFromHeader((await headers()).get('accept-language'))

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <TelegramBridge authenticated={false} />
      <div className="num mb-8 text-[40px] leading-none text-[var(--text-3)]">смн</div>

      <h1 className="mb-3 text-[26px] font-semibold leading-tight text-[var(--text-1)]">
        {t(L, 'landing.title')}
      </h1>
      <p className="mb-2 text-[15px] leading-relaxed text-[var(--text-2)]">
        {t(L, 'landing.body1', { example: EXAMPLES[L].one })}
      </p>
      <p className="mb-8 text-[15px] leading-relaxed text-[var(--text-2)]">
        <CommandText
          text={t(L, 'landing.body2', { command: '\u0000' })}
          command="/panel"
        />
      </p>

      <a
        href={botUrl}
        className="flex h-12 w-full items-center justify-center rounded-[var(--r-sm)] bg-[var(--accent)] text-[15px] font-semibold text-[var(--on-accent)] transition-opacity active:opacity-80"
      >
        {t(L, 'landing.openBot')}
      </a>

      <p className="mt-6 text-[13px] leading-relaxed text-[var(--text-3)]">
        {t(L, 'landing.privacy')}
      </p>
    </main>
  )
}

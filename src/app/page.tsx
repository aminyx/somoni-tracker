import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { env } from '@/lib/env'
import { TelegramBridge } from '@/components/TelegramBridge'
import { currentUser } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Трекер расходов' }

export default async function HomePage() {
  const user = await currentUser()
  if (user) redirect('/app')

  const botUrl = `https://t.me/${env().TELEGRAM_BOT_USERNAME}`

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <TelegramBridge authenticated={false} />
      <div className="num mb-8 text-[40px] leading-none text-[var(--text-3)]">смн</div>

      <h1 className="mb-3 text-[26px] font-semibold leading-tight text-[var(--text-1)]">
        Траты — одной строкой
      </h1>
      <p className="mb-2 text-[15px] leading-relaxed text-[var(--text-2)]">
        Пишете боту «кофе 350» — трата записана. Здесь видно, куда уходят
        деньги: по дням, по категориям, за неделю и месяц.
      </p>
      <p className="mb-8 text-[15px] leading-relaxed text-[var(--text-2)]">
        Отдельной регистрации нет. Вход — через того же бота: он пришлёт
        ссылку по команде <code className="rounded-[4px] bg-[var(--surface-2)] px-1.5 py-0.5 text-[13px]">/panel</code>.
      </p>

      <a
        href={botUrl}
        className="flex h-12 w-full items-center justify-center rounded-[var(--r-sm)] bg-[var(--accent)] text-[15px] font-semibold text-[var(--on-accent)] transition-opacity active:opacity-80"
      >
        Открыть бота
      </a>

      <p className="mt-6 text-[13px] leading-relaxed text-[var(--text-3)]">
        Данные каждого пользователя видны только ему.
      </p>
    </main>
  )
}

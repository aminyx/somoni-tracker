import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { JetBrains_Mono, Onest } from 'next/font/google'
import './globals.css'

// Шрифты подключаются через next/font: файлы отдаются с нашего домена,
// без запроса к Google на каждый визит и без скачка вёрстки при загрузке.
const onest = Onest({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-onest',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['cyrillic', 'latin'],
  weight: ['500', '700'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Трекер расходов',
  description:
    'Личные расходы одной строкой в Telegram: «кофе 350» — и трата уже в отчёте.',
  applicationName: 'Somoni Tracker',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
}

export const viewport: Viewport = {
  themeColor: '#0D0D0C',
  colorScheme: 'dark light',
  width: 'device-width',
  initialScale: 1,
  // maximumScale не ставим: запрет пинч-зума — нарушение WCAG 1.4.4,
  // а панель оценивают именно на телефоне. Случайный зум от двойного тапа
  // лечится через touch-action: manipulation на строках, а не запретом.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Переменные шрифтов вешаются на <html>, а не на <body>: font-family
    // объявлен на html, и пустая переменная сделала бы всё объявление
    // недействительным — страница уехала бы в Times New Roman.
    <html lang="ru" className={`${onest.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        {/* Скрипт Telegram нужен, только когда панель открыта как Mini App.
            beforeInteractive: объект WebApp должен существовать до того,
            как мост попробует развернуть окно. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  )
}

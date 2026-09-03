import type { Metadata, Viewport } from 'next'
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
  // Панель открывается внутри Telegram: запрет масштабирования убирает
  // случайный зум при двойном тапе по строке траты.
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${onest.variable} ${mono.variable} antialiased`}>{children}</body>
    </html>
  )
}

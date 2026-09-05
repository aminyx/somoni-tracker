'use client'

import { useEffect } from 'react'

/**
 * Мост с Telegram, когда панель открыта как Mini App.
 *
 * Делает три вещи и ничего больше:
 *  • разворачивает окно на всю высоту и отключает свайп-закрытие, иначе
 *    вертикальная прокрутка ленты вырывает приложение из чата;
 *  • красит шапку и фон Telegram в цвет панели, чтобы не было шва;
 *  • подхватывает светлую/тёмную тему клиента.
 *
 * Вход через initData здесь НЕ делается: панель открывается по ссылке из
 * бота, и сессия уже стоит. Если Mini App открыли без сессии, этим займётся
 * MiniAppLogin ниже.
 */

interface TelegramWebApp {
  initData: string
  colorScheme: 'light' | 'dark'
  expand(): void
  ready(): void
  disableVerticalSwipes?: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  onEvent?: (event: string, handler: () => void) => void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

const BG_DARK = '#0D0D0C'
const BG_LIGHT = '#FBFAF7'

export function TelegramBridge({ authenticated }: { authenticated: boolean }) {
  // Часовой пояс браузера. Telegram его не сообщает, поэтому новому
  // пользователю стоит зона по умолчанию — а «сегодня» у судьи из другого
  // пояса из-за этого считалось бы не за те сутки.
  useEffect(() => {
    if (!authenticated) return
    let zone: string
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return
    }
    if (!zone) return

    void fetch('/api/settings/timezone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: zone }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((result: { changed?: boolean } | null) => {
        // Зона поменялась — цифры на экране посчитаны за другие сутки.
        // Перезагружаем, чтобы не показывать неверный итог.
        if (result?.changed) window.location.reload()
      })
      .catch(() => undefined)
  }, [authenticated])

  useEffect(() => {
    const app = window.Telegram?.WebApp
    if (!app) return

    app.ready()
    app.expand()
    app.disableVerticalSwipes?.()

    const applyTheme = () => {
      const scheme = app.colorScheme === 'light' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', scheme)
      const color = scheme === 'light' ? BG_LIGHT : BG_DARK
      app.setHeaderColor?.(color)
      app.setBackgroundColor?.(color)
    }
    applyTheme()
    app.onEvent?.('themeChanged', applyTheme)

    // Панель открыли внутри Telegram, но сессии нет — например, через
    // кнопку меню. Меняем подписанные initData на сессию и перезагружаем.
    if (!authenticated && app.initData) {
      void fetch('/api/auth/webapp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData: app.initData }),
      }).then((response) => {
        if (response.ok) window.location.replace('/app')
      })
    }
  }, [authenticated])

  return null
}

'use client'

import { useEffect, useState } from 'react'
import { t, type Locale } from '@/lib/i18n'

/**
 * Переключатель темы.
 *
 * Основная тема продукта — тёмная, и системная настройка её больше не
 * перебивает: у человека со светлой системой панель раньше открывалась
 * светлой, хотя рисовалась она как «ночная касса». Светлая осталась —
 * но только как явный выбор, и он запоминается в localStorage.
 *
 * Выбор применяется не здесь, а inline-скриптом в <head>: если ставить
 * атрибут в useEffect, страница успевает мигнуть чужой темой.
 */
export const THEME_KEY = 'tracker-theme'

/** Ставится до первой отрисовки — иначе выбранная тема мигает. */
export const THEME_BOOTSTRAP = `try{var v=localStorage.getItem('${THEME_KEY}');if(v==='light'||v==='dark')document.documentElement.dataset.theme=v}catch(e){}`

export function ThemeToggle({ locale }: { locale: Locale }) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  // Читаем уже проставленный атрибут, а не localStorage: так состояние
  // кнопки совпадает с тем, что человек видит, даже если хранилище
  // недоступно (приватный режим, отключённые куки).
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  }, [])

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Приватный режим: тема продержится до перезагрузки — это лучше,
      // чем уронить панель на записи в недоступное хранилище.
    }
    setTheme(next)
  }

  const label = t(locale, theme === 'dark' ? 'web.themeLight' : 'web.themeDark')

  return (
    <button
      type="button"
      onClick={toggle}
      className="text-[var(--text-3)]"
      style={{ touchAction: 'manipulation' }}
      aria-label={label}
      title={label}
    >
      <span aria-hidden>{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  )
}

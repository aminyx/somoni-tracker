/**
 * Тёмная тема — основная, и системная настройка её не отменяет.
 *
 * До этого в globals.css стоял `@media (prefers-color-scheme: light)`, и у
 * человека со светлой системой панель открывалась светлой — тёмного варианта
 * он не видел вообще. То же делал и мост с Telegram: он навязывал панели тему
 * клиента и отменял ручное переключение следующим событием themeChanged.
 * Обе ошибки тихие: сборка проходит, тесты проходят, а продукт выглядит не так,
 * как задуман. Поэтому проверка читает исходники.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { LOCALES, allKeys, t } from '../src/lib/i18n.ts'

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const css = read('src/app/globals.css')

/** Строки без комментариев: в комментариях медиазапрос упомянут намеренно. */
function cssCode(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

test('светлая тема не включается системной настройкой', () => {
  assert.ok(
    !cssCode(css).includes('prefers-color-scheme: light'),
    'вернулся медиазапрос светлой темы: у судьи со светлой системой панель будет светлой',
  )
})

test('светлая тема доступна явным выбором', () => {
  assert.ok(
    css.includes("[data-theme='light']"),
    'светлая тема пропала совсем — переключателю нечего включать',
  )
})

test('тёмные значения объявлены на голом :root', () => {
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
  for (const token of ['--bg', '--text-1', '--accent', '--border']) {
    assert.ok(root.includes(token), `${token} не объявлен в базовой теме`)
  }
})

test('мост с Telegram не навязывает панели тему клиента', () => {
  const bridge = read('src/components/TelegramBridge.tsx')
  const code = bridge.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(
    !code.includes("setAttribute('data-theme'"),
    'мост снова перекрашивает панель под Telegram — ручной выбор темы будет отменяться',
  )
  assert.ok(
    code.includes('setHeaderColor'),
    'шапка Telegram перестала краситься под панель — над экраном появится чужая полоса',
  )
})

test('выбранная тема применяется до первой отрисовки', () => {
  const layout = read('src/app/layout.tsx')
  assert.ok(
    layout.includes('THEME_BOOTSTRAP'),
    'без inline-скрипта в <head> страница мигает тёмной, прежде чем станет светлой',
  )
})

test('переключатель темы подписан на всех языках', () => {
  for (const locale of LOCALES) {
    for (const key of ['web.themeLight', 'web.themeDark']) {
      const value = t(locale, key)
      assert.notEqual(value, key, `${locale}/${key}: нет перевода`)
    }
  }
})

test('компоненты панели принимают язык, а не берут русский по умолчанию', () => {
  for (const file of ['DayRail', 'CategoryBlock', 'ExpenseList']) {
    const source = read(`src/components/${file}.tsx`)
    assert.ok(
      source.includes('locale: Locale'),
      `${file}: не принимает язык — останется русским после переключения`,
    )
  }
})

test('в панели не осталось зашитых русских названий месяцев', () => {
  // Массивы месяцев жили копиями в трёх файлах; после перевода они должны
  // остаться только в словаре.
  for (const file of ['Dashboard', 'DayRail', 'ExpenseList']) {
    const source = read(`src/components/${file}.tsx`)
    assert.ok(
      !source.includes("'января'") && !source.includes("'янв'"),
      `${file}: локальная копия месяцев переживёт смену языка`,
    )
  }
})

test('ключи страниц до входа переведены во все языки', () => {
  const pageKeys = allKeys().filter((key) => key.startsWith('landing.') || key.startsWith('enter.'))
  assert.ok(pageKeys.length >= 8, `ключей лендинга и входа подозрительно мало: ${pageKeys.length}`)
  for (const locale of LOCALES) {
    for (const key of pageKeys) {
      assert.notEqual(t(locale, key), key, `${locale}/${key}: нет перевода`)
    }
  }
})

test('строка с командой оставляет место под саму команду', () => {
  // CommandText режет перевод по плейсхолдеру: если переводчик его потеряет,
  // команда просто не покажется, и человек не узнает, что писать боту.
  for (const locale of LOCALES) {
    for (const key of ['landing.body2', 'enter.deadBody']) {
      assert.ok(t(locale, key).includes('{command}'), `${locale}/${key}: потерян {command}`)
    }
  }
})

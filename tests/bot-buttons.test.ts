/**
 * Кнопки под полем ввода отправляют боту обычный текст. Если для какой-то
 * кнопки нет обработчика, её нажатие уйдёт в разбор траты, и человек получит
 * «не нашёл сумму» вместо отчёта. Ровно это и случилось с «Последними»,
 * поэтому проверка читает исходник бота и сверяет одно с другим.
 *
 * После появления языков добавилось второе условие: подписи разные на каждом
 * языке, значит слушать надо все варианты, иначе после смены языка кнопки
 * молча перестанут работать.
 *
 * Часть проверок строит клавиатуру по-настоящему — из src/bot/keyboard.ts.
 * Греп по исходнику ломался от любого переноса строк и при этом не видел
 * ни цвета кнопки, ни иконки.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { mainKeyboard } from '../src/bot/keyboard.ts'
import { EXAMPLES, LOCALES, t } from '../src/lib/i18n.ts'
import { parseExpense } from '../src/lib/parser.ts'

const source = readFileSync(new URL('../src/bot/index.ts', import.meta.url), 'utf8')
const keyboardSource = readFileSync(new URL('../src/bot/keyboard.ts', import.meta.url), 'utf8')

/** Ключи кнопок, объявленные в боте. */
function buttonKeys(): string[] {
  const start = keyboardSource.indexOf('const BUTTON_KEYS')
  assert.notEqual(start, -1, 'не нашёл BUTTON_KEYS в src/bot/keyboard.ts')
  const open = keyboardSource.indexOf('[', start)
  const close = keyboardSource.indexOf(']', open)
  return [...keyboardSource.slice(open, close).matchAll(/'([a-z]+)'/g)].map((m) => m[1]!)
}

/** Подписи кнопок так, как их увидит человек. */
function labels(locale: (typeof LOCALES)[number]): string[] {
  return mainKeyboard(locale)
    .keyboard.flat()
    .map((button) => (typeof button === 'string' ? button : button.text))
}

test('в клавиатуре есть кнопки', () => {
  assert.ok(buttonKeys().length >= 5, `кнопок мало: ${buttonKeys().length}`)
})

test('у каждой кнопки есть обработчик на все языки сразу', () => {
  const missing = buttonKeys().filter((key) => !source.includes(`allButtonLabels('${key}')`))
  assert.deepEqual(missing, [], `кнопки без обработчика: ${missing.join(', ')}`)
})

test('каждая кнопка попадает в саму клавиатуру', () => {
  for (const locale of LOCALES) {
    const shown = new Set(labels(locale))
    const missing = buttonKeys().filter((key) => !shown.has(t(locale, `btn.${key}`)))
    assert.deepEqual(missing, [], `${locale}: объявлены, но не показаны: ${missing.join(', ')}`)
    assert.equal(shown.size, buttonKeys().length, `${locale}: в панели лишние кнопки`)
  }
})

test('выделена ровно одна кнопка нижней панели', () => {
  // Выделено всё — не выделено ничего. Синей должна быть только «Панель»:
  // это главное действие после того, как трата записана.
  for (const locale of LOCALES) {
    const buttons = mainKeyboard(locale).keyboard.flat() as Array<
      string | { text: string; style?: string }
    >
    const styled = buttons.filter(
      (b): b is { text: string; style?: string } => typeof b !== 'string' && Boolean(b.style),
    )
    assert.equal(styled.length, 1, `${locale}: подсвечено кнопок ${styled.length}`)
    assert.equal(styled[0]!.style, 'primary')
    assert.equal(styled[0]!.text, t(locale, 'btn.panel'))
  }
})

test('у каждой кнопки панели есть иконка из настоящего каталога', () => {
  const raw = readFileSync(new URL('../assets/premium-emoji.txt', import.meta.url), 'utf8')
  const known = new Set(
    raw
      .split('\n')
      .map((line) => line.trim().split(' ')[0])
      .filter(Boolean),
  )
  for (const locale of LOCALES) {
    for (const button of mainKeyboard(locale).keyboard.flat()) {
      assert.notEqual(typeof button, 'string', `${locale}: кнопка без объекта — иконку не поставить`)
      if (typeof button === 'string') continue
      const icon = (button as { icon_custom_emoji_id?: string }).icon_custom_emoji_id
      assert.ok(icon, `${locale}/${button.text}: кнопка без иконки`)
      assert.ok(known.has(icon!), `${locale}/${button.text}: иконки ${icon} нет в каталоге`)
    }
  }
})

test('подпись кнопки помещается в ряд из трёх', () => {
  // На экране 360 dp кнопка занимает около 96 dp под текст, иконка съедает
  // ещё примерно двадцать. Отсюда потолок в восемь знаков. «Тарзи навиштан»
  // его нарушала — и на скриншоте у владельца была обрезана многоточием.
  const LIMIT = 8
  for (const locale of LOCALES) {
    for (const key of buttonKeys()) {
      const label = t(locale, `btn.${key}`)
      assert.ok(
        label.length <= LIMIT,
        `${locale}/btn.${key}: «${label}» — ${label.length} знаков, обрежется`,
      )
    }
  }
})

test('обработчики кнопок стоят до разбора обычного текста', () => {
  const hears = source.indexOf('bot.hears(allButtonLabels(')
  const text = source.indexOf("bot.on('message:text'")
  assert.ok(hears > 0 && text > 0)
  assert.ok(
    hears < text,
    'нажатие кнопки уйдёт в разбор траты: bot.hears должен быть раньше bot.on(message:text)',
  )
})

/** Подписи, которые кнопки носили до переименования. */
const LEGACY = ['Как писать', 'Тарзи навиштан', 'Последние', 'Охиринҳо', 'Dashboard']

test('старые подписи всё ещё слушаются', () => {
  // Нижняя панель persistent: она висит в чате, пока бот не пришлёт новую.
  // У человека, который после обновления не получит сообщения с
  // клавиатурой, останутся прежние надписи, и без синонимов его нажатие
  // ушло бы в разбор траты.
  const start = keyboardSource.indexOf('LEGACY_LABELS')
  assert.notEqual(start, -1, 'исчез список старых подписей')
  const body = keyboardSource.slice(start, start + 600)
  for (const old of LEGACY) {
    assert.ok(body.includes(`'${old}'`), `подпись «${old}» перестала слушаться`)
  }
})

test('старые подписи не разбираются как трата', () => {
  for (const old of LEGACY) {
    assert.equal(parseExpense(old).ok, false, `«${old}» разбирается как трата`)
  }
})

test('у каждой кнопки есть подпись на каждом языке', () => {
  for (const key of buttonKeys()) {
    for (const locale of LOCALES) {
      const label = t(locale, `btn.${key}`)
      assert.ok(label.length > 0, `${locale}/btn.${key}: пусто`)
      assert.notEqual(label, `btn.${key}`, `${locale}/btn.${key}: нет перевода`)
    }
  }
})

test('подписи кнопок не выглядят как трата ни на одном языке', () => {
  // Иначе нажатие могло бы уйти в разбор и записаться как расход.
  // Проверяем то, что реально уходит в клавиатуру, а не только словарь.
  for (const locale of LOCALES) {
    for (const label of labels(locale)) {
      assert.equal(parseExpense(label).ok, false, `«${label}» (${locale}) разбирается как трата`)
    }
  }
})

test('в подписях нет цифровых эмодзи', () => {
  // «1️⃣ Сегодня» разбирается как трата на одну единицу: нажатие кнопки
  // создало бы расход. Иконка кнопки живёт отдельным полем, в тексте
  // эмодзи вообще быть не должно.
  for (const locale of LOCALES) {
    for (const label of labels(locale)) {
      assert.ok(!/[0-9#*]️?⃣/.test(label), `${locale}: цифровая эмодзи в «${label}»`)
    }
  }
})

test('подписи кнопок не совпадают между собой внутри языка', () => {
  // Одинаковые подписи означали бы, что две кнопки неразличимы для бота.
  for (const locale of LOCALES) {
    const list = labels(locale)
    assert.equal(new Set(list).size, list.length, `${locale}: подписи повторяются`)
  }
})

test('подсказка в поле ввода — рабочий пример траты на каждом языке', () => {
  for (const locale of LOCALES) {
    const hint = t(locale, 'placeholder.input')
    const parsed = parseExpense(hint)
    assert.equal(parsed.ok, true, `подсказка «${hint}» (${locale}) сама не разбирается как трата`)
    if (parsed.ok) assert.ok(parsed.value.amount > 0)
  }
})

test('примеры из справки действительно разбираются', () => {
  for (const locale of LOCALES) {
    for (const [name, example] of Object.entries(EXAMPLES[locale])) {
      const parsed = parseExpense(example)
      assert.equal(parsed.ok, true, `пример ${locale}/${name} «${example}» не разбирается`)
      if (parsed.ok) assert.ok(parsed.value.amount > 0, `${locale}/${name}: сумма не положительная`)
    }
  }
})

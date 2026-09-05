/**
 * Списки городов и валют в настройках. Проверка читает исходник бота:
 * опечатка в названии зоны или валюты не даст ошибки при сборке, но кнопка
 * молча перестанет работать, а человек этого не поймёт.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { isValidCurrency } from '../src/lib/money.ts'
import { safeTimeZone, zoneOffsetMs } from '../src/lib/time.ts'

const source = readFileSync(new URL('../src/bot/index.ts', import.meta.url), 'utf8')

/**
 * Вырезает содержимое массива по имени. Границы ищутся поиском подстроки,
 * а не регулярным выражением: собирать регулярку в шаблонной строке —
 * значит экранировать скобки дважды, и одна потерянная косая черта тихо
 * превращает `[string, string]` в класс символов, а проверку — в ничто.
 */
function arrayBody(name: string): string {
  const start = source.indexOf(`const ${name}`)
  assert.notEqual(start, -1, `не нашёл ${name} в src/bot/index.ts`)
  const open = source.indexOf('[', source.indexOf('=', start))
  const close = source.indexOf('\n]', open)
  assert.ok(open > 0 && close > open, `не разобрал границы ${name}`)
  return source.slice(open, close)
}

function pairs(name: string): Array<[string, string]> {
  const body = arrayBody(name)
  return [...body.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => [m[1]!, m[2]!])
}

interface City {
  zone: string
  currency: string
  names: Record<string, string>
}

/**
 * Города описаны объектами: зона, валюта страны и название на каждом языке.
 * Разбираем сам исходник — так проверка ловит и то, чего нет в типах:
 * забытый язык в названии или несуществующую валюту.
 */
function cities(): City[] {
  const body = arrayBody('TIMEZONE_CHOICES')
  const out: City[] = []
  for (const entry of body.split('{ zone:').slice(1)) {
    const zone = /^\s*'([^']+)'/.exec(entry)?.[1]
    const currency = /currency:\s*'([^']+)'/.exec(entry)?.[1]
    assert.ok(zone && currency, `не разобрал город: ${entry.slice(0, 60)}`)
    const names: Record<string, string> = {}
    const namesPart = entry.slice(entry.indexOf('name:'))
    for (const m of namesPart.matchAll(/([a-z]{2}):\s*'([^']+)'/g)) names[m[1]!] = m[2]!
    out.push({ zone: zone!, currency: currency!, names })
  }
  return out
}

test('города в списке — настоящие зоны IANA', () => {
  const list = cities()
  assert.ok(list.length >= 8, `городов мало: ${list.length}`)
  const broken = list.filter((c) => safeTimeZone(c.zone, '') !== c.zone)
  assert.deepEqual(broken, [], `неизвестные зоны: ${broken.map((c) => c.zone).join(', ')}`)
})

test('Душанбе есть и стоит первым', () => {
  assert.equal(cities()[0]!.zone, 'Asia/Dushanbe', 'продукт для Таджикистана — Душанбе первым')
})

test('у каждого города есть название на всех трёх языках', () => {
  for (const city of cities()) {
    for (const locale of ['ru', 'tg', 'en']) {
      assert.ok(city.names[locale], `${city.zone}: нет названия на ${locale}`)
    }
  }
})

test('английские названия городов написаны латиницей', () => {
  // Иначе в английском интерфейсе список выглядит как «Moscow, Душанбе».
  for (const city of cities()) {
    assert.ok(
      /^[A-Za-z][A-Za-z '-]*$/.test(city.names.en!),
      `${city.zone}: английское название «${city.names.en}» не латиницей`,
    )
  }
})

test('валюта страны у каждого города существует', () => {
  // Мастер первого запуска ставит её без спроса: ошибка здесь означает
  // отчёты в валюте, которой нет.
  for (const city of cities()) {
    assert.ok(isValidCurrency(city.currency), `${city.zone}: валюта ${city.currency} неизвестна`)
  }
})

test('смещение считается для каждого города', () => {
  for (const city of cities()) {
    const offset = zoneOffsetMs(Date.now(), city.zone)
    assert.ok(Number.isFinite(offset), `${city.zone}: смещение не посчиталось`)
    assert.ok(Math.abs(offset) <= 14 * 3600_000, `${city.zone}: неправдоподобное смещение`)
  }
})

test('валюты в списке существуют по ISO 4217', () => {
  const list = pairs('CURRENCY_CHOICES')
  assert.ok(list.length >= 6)
  const broken = list.filter(([, code]) => !isValidCurrency(code))
  assert.deepEqual(broken, [], `неизвестные валюты: ${broken.map((c) => c[1]).join(', ')}`)
})

test('сомони предлагается первым', () => {
  assert.equal(pairs('CURRENCY_CHOICES')[0]![1], 'TJS')
})

test('callback_data кнопок укладывается в лимит Telegram', () => {
  for (const city of cities()) {
    assert.ok(Buffer.byteLength(`tz:${city.zone}`, 'utf8') <= 64, `длинное: tz:${city.zone}`)
    assert.ok(Buffer.byteLength(`wtz:${city.zone}`, 'utf8') <= 64, `длинное: wtz:${city.zone}`)
  }
  for (const [, code] of pairs('CURRENCY_CHOICES')) {
    assert.ok(Buffer.byteLength(`cur:${code}`, 'utf8') <= 64)
  }
})

test('у каждой кнопки настроек есть обработчик', () => {
  for (const cb of ['settz', 'setcur', 'setlang']) {
    assert.ok(source.includes(`bot.callbackQuery('${cb}'`), `нет обработчика для ${cb}`)
  }
  assert.ok(source.includes('bot.callbackQuery(/^tz:'), 'нет обработчика выбора зоны')
  assert.ok(source.includes('bot.callbackQuery(/^cur:'), 'нет обработчика выбора валюты')
})

test('у мастера первого запуска есть оба шага', () => {
  // Мастер живёт на своих префиксах: если обработчик потеряется, кнопка
  // в приветствии будет нажиматься вхолостую и первый экран станет тупиком.
  assert.ok(source.includes('bot.callbackQuery(/^wlang:'), 'нет шага выбора языка')
  assert.ok(source.includes('bot.callbackQuery(/^wtz:'), 'нет шага выбора города')
  assert.ok(source.includes('wizardLanguageKeyboard'), 'приветствие не показывает выбор языка')
})

test('регулярка зоны принимает все зоны из списка', () => {
  // Литерал вырезается по границам «bot.callbackQuery(» … «, async»:
  // искать его выражением нельзя — внутри есть экранированная косая черта,
  // и поиск «до первого /» обрывает шаблон на середине.
  for (const prefix of ['tz:', 'wtz:']) {
    const start = source.indexOf(`bot.callbackQuery(/^${prefix}`)
    assert.notEqual(start, -1, `не нашёл обработчик ${prefix}`)
    const open = source.indexOf('/', start + 'bot.callbackQuery('.length - 1) + 1
    const end = source.indexOf(', async', start)
    const literal = source.slice(open, end).trim()
    const re = new RegExp(literal.replace(/\/$/, ''))

    for (const city of cities()) {
      assert.ok(re.test(`${prefix}${city.zone}`), `${prefix}${city.zone} не подходит под регулярку`)
    }
    assert.ok(!re.test(`${prefix}`), `${prefix}: пустая зона проходит`)
  }
})

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
function pairs(name: string): Array<[string, string]> {
  const start = source.indexOf(`const ${name}`)
  assert.notEqual(start, -1, `не нашёл ${name} в src/bot/index.ts`)
  const open = source.indexOf('[', source.indexOf('=', start))
  const close = source.indexOf('\n]', open)
  assert.ok(open > 0 && close > open, `не разобрал границы ${name}`)
  const body = source.slice(open, close)
  return [...body.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => [m[1]!, m[2]!])
}

test('города в списке — настоящие зоны IANA', () => {
  const zones = pairs('TIMEZONE_CHOICES')
  assert.ok(zones.length >= 8, `городов мало: ${zones.length}`)
  const broken = zones.filter(([, zone]) => safeTimeZone(zone, '') !== zone)
  assert.deepEqual(broken, [], `неизвестные зоны: ${broken.map((z) => z[1]).join(', ')}`)
})

test('Душанбе есть и стоит первым', () => {
  const zones = pairs('TIMEZONE_CHOICES')
  assert.equal(zones[0]![1], 'Asia/Dushanbe', 'продукт для Таджикистана — Душанбе первым')
})

test('смещение считается для каждого города', () => {
  for (const [city, zone] of pairs('TIMEZONE_CHOICES')) {
    const offset = zoneOffsetMs(Date.now(), zone)
    assert.ok(Number.isFinite(offset), `${city}: смещение не посчиталось`)
    assert.ok(Math.abs(offset) <= 14 * 3600_000, `${city}: неправдоподобное смещение`)
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
  for (const [, zone] of pairs('TIMEZONE_CHOICES')) {
    assert.ok(Buffer.byteLength(`tz:${zone}`, 'utf8') <= 64, `длинное: tz:${zone}`)
  }
  for (const [, code] of pairs('CURRENCY_CHOICES')) {
    assert.ok(Buffer.byteLength(`cur:${code}`, 'utf8') <= 64)
  }
})

test('у каждой кнопки настроек есть обработчик', () => {
  for (const cb of ['settz', 'setcur']) {
    assert.ok(source.includes(`bot.callbackQuery('${cb}'`), `нет обработчика для ${cb}`)
  }
  assert.ok(source.includes('bot.callbackQuery(/^tz:'), 'нет обработчика выбора зоны')
  assert.ok(source.includes('bot.callbackQuery(/^cur:'), 'нет обработчика выбора валюты')
})

test('регулярка зоны принимает все зоны из списка', () => {
  // Литерал вырезается по границам «bot.callbackQuery(» … «, async»:
  // искать его выражением нельзя — внутри есть экранированная косая черта,
  // и поиск «до первого /» обрывает шаблон на середине.
  const start = source.indexOf('bot.callbackQuery(/^tz:')
  assert.notEqual(start, -1, 'не нашёл обработчик выбора зоны')
  const open = source.indexOf('/', start + 'bot.callbackQuery('.length - 1) + 1
  const end = source.indexOf(', async', start)
  const literal = source.slice(open, end).trim()
  const body = literal.replace(/\/$/, '')
  const re = new RegExp(body)

  for (const [city, zone] of pairs('TIMEZONE_CHOICES')) {
    assert.ok(re.test(`tz:${zone}`), `${city}: зона ${zone} не подходит под регулярку`)
  }
  // И наоборот: мусор не должен проходить.
  assert.ok(!re.test('tz:../../etc/passwd'))
  assert.ok(!re.test('tz:'))
})

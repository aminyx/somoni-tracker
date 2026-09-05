/**
 * Проверка подписи initData из Telegram Mini App.
 *
 * Тест написан после настоящей поломки: панель внутри Telegram отдавала 401
 * на каждый запуск, потому что из строки проверки выбрасывалось поле
 * `signature`. Из HMAC исключается только `hash`; `signature` — обычное
 * полученное поле и в подсчёт входит. Оба поля исключаются лишь в другой
 * проверке, по открытому ключу Ed25519, которая здесь не используется.
 */
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { verifyInitData } from '../src/lib/auth.ts'

const BOT_TOKEN = '123456789:TEST-TOKEN-FOR-SIGNATURE-CHECKS-ONLY'

/** Собирает initData так же, как это делает Telegram. */
function makeInitData(fields: Record<string, string>): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex')

  const params = new URLSearchParams({ ...fields, hash })
  return params.toString()
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

const USER = JSON.stringify({ id: 7768016686, first_name: 'Судья', language_code: 'ru' })

test('обычная initData проходит проверку', () => {
  const initData = makeInitData({ auth_date: String(nowSeconds()), user: USER })
  const result = verifyInitData(initData, BOT_TOKEN)
  assert.equal(result.user.id, 7768016686)
  assert.equal(result.user.first_name, 'Судья')
})

test('initData с полем signature тоже проходит — оно входит в подпись', () => {
  const initData = makeInitData({
    auth_date: String(nowSeconds()),
    // Так его присылает Telegram начиная с Bot API 8.0.
    signature: 'aBcDeF_ephemeral-ed25519-signature-value',
    user: USER,
  })
  const result = verifyInitData(initData, BOT_TOKEN)
  assert.equal(result.user.id, 7768016686)
})

test('query_id и chat_instance не мешают', () => {
  const initData = makeInitData({
    auth_date: String(nowSeconds()),
    chat_instance: '-1234567890123456789',
    chat_type: 'private',
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    signature: 'signature-value',
    user: USER,
  })
  assert.equal(verifyInitData(initData, BOT_TOKEN).user.id, 7768016686)
})

test('подделанные данные не проходят', () => {
  const initData = makeInitData({ auth_date: String(nowSeconds()), user: USER })
  const tampered = initData.replace('7768016686', '111111111')
  assert.throws(() => verifyInitData(tampered, BOT_TOKEN), /не сходится/)
})

test('чужой токен не проходит', () => {
  const initData = makeInitData({ auth_date: String(nowSeconds()), user: USER })
  assert.throws(() => verifyInitData(initData, '999:ДРУГОЙ-ТОКЕН'), /не сходится/)
})

test('устаревшая initData отклоняется', () => {
  const old = String(nowSeconds() - 7200)
  const initData = makeInitData({ auth_date: old, user: USER })
  assert.throws(() => verifyInitData(initData, BOT_TOKEN), /устарела/)
})

test('initData из будущего отклоняется', () => {
  const future = String(nowSeconds() + 600)
  const initData = makeInitData({ auth_date: future, user: USER })
  assert.throws(() => verifyInitData(initData, BOT_TOKEN), /устарела/)
})

test('без hash — отказ', () => {
  assert.throws(() => verifyInitData('auth_date=1&user=%7B%7D', BOT_TOKEN), /без подписи/)
})

test('без пользователя — отказ', () => {
  const initData = makeInitData({ auth_date: String(nowSeconds()) })
  assert.throws(() => verifyInitData(initData, BOT_TOKEN), /без пользователя/)
})

test('мусорный hash не роняет проверку', () => {
  const initData = makeInitData({ auth_date: String(nowSeconds()), user: USER })
  const broken = initData.replace(/hash=[0-9a-f]+/, 'hash=не-шестнадцатеричное')
  assert.throws(() => verifyInitData(broken, BOT_TOKEN))
})

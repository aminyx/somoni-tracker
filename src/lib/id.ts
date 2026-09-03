import { randomBytes, randomUUID } from 'node:crypto'

const ALPHABET = '0123456789abcdefghijkmnpqrstuvwxyz' // без l и o — не путаются в логах

/** Короткий сортируемый по времени id: 8 символов времени + 6 случайных. */
export function newId(at: number = Date.now()): string {
  let time = ''
  let n = at
  for (let i = 0; i < 8; i++) {
    time = ALPHABET[n % ALPHABET.length]! + time
    n = Math.floor(n / ALPHABET.length)
  }
  const rand = randomBytes(6)
  let tail = ''
  for (const byte of rand) tail += ALPHABET[byte % ALPHABET.length]!
  return time + tail
}

/** Криптостойкий секрет для ссылок входа и cookie сессии. */
export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export { randomUUID }

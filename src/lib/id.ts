import { randomBytes, randomUUID } from 'node:crypto'

/** Без «l» и «o»: в логах их путают с единицей и нулём. */
const ALPHABET = '0123456789abcdefghijkmnpqrstuvwxyz'

/**
 * Длина префикса времени. Алфавит из 34 символов: 34^9 ≈ 6,07e13 мс,
 * то есть до 3894 года. Восьми символов не хватало — 34^8 ≈ 1,79e12
 * меньше текущего Date.now(), счётчик переполнялся и id переставали
 * сортироваться по времени.
 */
const TIME_CHARS = 9

/** Короткий id, сортируемый по времени: 9 символов метки + 6 случайных. */
export function newId(at: number = Date.now()): string {
  let time = ''
  let n = Math.max(0, Math.floor(at))
  for (let i = 0; i < TIME_CHARS; i++) {
    time = ALPHABET[n % ALPHABET.length]! + time
    n = Math.floor(n / ALPHABET.length)
  }
  const rand = randomBytes(6)
  let tail = ''
  for (const byte of rand) tail += ALPHABET[byte % ALPHABET.length]!
  return time + tail
}

/** Момент, до которого префикс времени остаётся монотонным. */
export const ID_TIME_LIMIT_MS = ALPHABET.length ** TIME_CHARS

/** Криптостойкий секрет для ссылок входа и cookie сессии. */
export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export { randomUUID }

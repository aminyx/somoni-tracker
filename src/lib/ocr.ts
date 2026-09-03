/**
 * Распознавание сумм с фотографии чека.
 *
 * Работает офлайн: модели PaddleOCR (ONNX) скачиваются один раз и лежат
 * в кэше, никаких ключей и внешних сервисов.
 *
 * Модель взята кириллическая (PP-OCRv5 cyrillic), а не универсальная v6:
 * у v6 в словаре нет кириллицы, и «ИТОГО» превращается в «HTOTO». Числа
 * она читает верно, но именно слово-якорь нужно, чтобы отличить итог
 * от суммы НДС и от сдачи.
 *
 * ГЛАВНОЕ ПРАВИЛО: модуль НЕ решает, какая сумма правильная. Он возвращает
 * несколько кандидатов с оценками, а выбирает человек одним касанием.
 * Трекер, который уверенно назвал неправильную сумму, хуже трекера
 * без распознавания вовсе.
 */

/** Кандидат в сумму траты. */
export interface AmountCandidate {
  /** сумма в основных единицах */
  amount: number
  /** строка чека, из которой она взята */
  line: string
  /** оценка правдоподобия, больше — лучше */
  score: number
}

export interface OcrResult {
  candidates: AmountCandidate[]
  /** весь распознанный текст — попадает в описание при отладке */
  text: string
  /** уверенность распознавания в целом, 0…1 */
  confidence: number
  elapsedMs: number
}

const MODEL_BASE = 'https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main'

const MODEL = {
  detection: `${MODEL_BASE}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE}/recognition/multi/cyrillic/v5/cyrillic_PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${MODEL_BASE}/recognition/multi/cyrillic/v5/ppocrv5_cyrillic_dict.txt`,
}

/** Слова, рядом с которыми стоит настоящий итог. */
const TOTAL_WORDS = [
  'итого', 'итог', 'всего', 'к оплате', 'коплате', 'сумма', '总', 'total',
  'хамаги', 'ҳамагӣ', 'умуми', 'ҷамъ', 'джами', 'сумма чека',
]

/** Слова, рядом с которыми стоит НЕ итог. Это главная защита от ошибки. */
const NOT_TOTAL_WORDS = [
  'ндс', 'налог', 'nds', 'vat', 'сдача', 'сдачи', 'change',
  'наличными', 'наличные', 'картой', 'безналичными', 'оплачено', 'внесено',
  'скидка', 'бонус', 'кэшбэк', 'инн', 'фн ', 'фп ', 'смена', 'чек',
]

/** Подитог — тоже не итог, но ошибиться на нём не страшно: штраф мягче. */
const SOFT_NOT_TOTAL = ['подитог', 'под итог', 'подытог', 'subtotal']

/** Свёртка таджикских букв, как в классификаторе категорий. */
function fold(text: string): string {
  const map: Record<string, string> = { ӯ: 'у', ӣ: 'и', ҳ: 'х', қ: 'к', ғ: 'г', ҷ: 'ч', ё: 'е' }
  let out = ''
  for (const ch of text.toLowerCase()) out += map[ch] ?? ch
  return out
}

/**
 * Достаёт числа, похожие на деньги.
 * Пробелы внутри числа («200, 00») распознаватель вставляет регулярно,
 * поэтому дробная часть разрешена с пробелом после запятой.
 */
function numbersIn(line: string): number[] {
  const found: number[] = []
  const re = /(?<![\d.,])(\d{1,3}(?:[  ]\d{3})*|\d+)\s*[.,]\s*(\d{2})(?![\d])|(?<![\d.,])(\d{1,7})(?![\d.,])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m[1] !== undefined && m[2] !== undefined) {
      const whole = m[1].replace(/[  ]/g, '')
      found.push(Number(`${whole}.${m[2]}`))
    } else if (m[3] !== undefined) {
      // Целое без копеек. Длинные числа — это ИНН, ФН, номер чека, не деньги.
      if (m[3].length <= 6) found.push(Number(m[3]))
    }
  }
  return found.filter((n) => Number.isFinite(n) && n > 0 && n < 10_000_000)
}

/** Строка вида «2 x 5,00 10,00» — цена за штуку, а не итог. */
function isQuantityLine(line: string): boolean {
  return /\d\s*[x×хX*]\s*\d/.test(line)
}

/** Дата или время в строке. */
function looksLikeDate(line: string): boolean {
  return /\d{2}[.:/]\d{2}([.:/]\d{2,4})?/.test(line)
}

/**
 * Ранжирует кандидатов. Веса подобраны так, чтобы при сомнении наверх
 * поднималась большая сумма из нижней трети чека — там обычно итог.
 */
export function rankCandidates(text: string): AmountCandidate[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const byAmount = new Map<number, AmountCandidate>()
  const maxAmount = Math.max(
    0,
    ...lines.flatMap((l) => (isQuantityLine(l) ? [] : numbersIn(l))),
  )

  lines.forEach((line, index) => {
    const folded = fold(line)
    const position = lines.length > 1 ? index / (lines.length - 1) : 1

    for (const amount of numbersIn(line)) {
      let score = 0

      if (TOTAL_WORDS.some((w) => folded.includes(w))) score += 6
      if (NOT_TOTAL_WORDS.some((w) => folded.includes(w))) score -= 5
      if (SOFT_NOT_TOTAL.some((w) => folded.includes(w))) score -= 2

      // Итог почти всегда в нижней половине чека.
      score += position * 2

      // Самая большая сумма — частый и неплохой ответ по умолчанию.
      if (maxAmount > 0 && amount === maxAmount) score += 2

      // «2 x 5,00 10,00»: цена и количество, а не итог.
      if (isQuantityLine(line)) score -= 3
      if (looksLikeDate(line)) score -= 4

      // Копейки — признак денег, круглые целые чаще оказываются номерами.
      if (!Number.isInteger(amount)) score += 1
      if (amount < 1) score -= 3

      const existing = byAmount.get(amount)
      if (!existing || score > existing.score) {
        byAmount.set(amount, { amount, line, score })
      }
    }
  })

  const ranked = [...byAmount.values()].sort(
    (a, b) => b.score - a.score || b.amount - a.amount,
  )
  // Порог отсекает числа из адреса и названий товаров. Если после него
  // ничего не осталось, лучше показать двух лучших, чем ничего:
  // человек всё равно выбирает сам.
  const strong = ranked.filter((c) => c.score >= 1.5)
  return (strong.length > 0 ? strong : ranked.slice(0, 2)).slice(0, 4)
}

/* ------------------------------------------------------------------ */
/*  Сервис распознавания                                               */
/* ------------------------------------------------------------------ */

type Service = { recognize: (b: ArrayBuffer) => Promise<{ text: string; confidence: number }> }

let servicePromise: Promise<Service> | null = null

/** Включено ли распознавание. Тяжёлые модули не грузятся, пока выключено. */
export function isOcrEnabled(): boolean {
  return process.env.ENABLE_RECEIPT_OCR === 'true'
}

/**
 * Готовит распознаватель. Первый вызов скачивает модели (около 12 МБ)
 * и кэширует их; повторный запуск обходится в полсекунды.
 */
async function getService(): Promise<Service> {
  if (!servicePromise) {
    servicePromise = (async () => {
      // Динамический импорт: без включённого распознавания onnxruntime
      // (около 280 МБ) вообще не попадает в память процесса.
      const { PaddleOcrService } = await import('ppu-paddle-ocr')
      const service = new PaddleOcrService({ model: MODEL })
      await service.initialize()
      return service as unknown as Service
    })().catch((error) => {
      // Сбрасываем обещание, чтобы следующая попытка началась заново.
      servicePromise = null
      throw error
    })
  }
  return servicePromise
}

/** Прогрев на старте бота, чтобы первый пользователь не ждал загрузку моделей. */
export async function warmupOcr(): Promise<boolean> {
  if (!isOcrEnabled()) return false
  try {
    await getService()
    return true
  } catch (error) {
    console.warn('[чек] распознавание недоступно:', (error as Error).message)
    return false
  }
}

/**
 * Распознаёт чек и возвращает кандидатов в сумму.
 * Бросает исключение, если распознавание выключено или не поднялось —
 * вызывающий код обязан предложить ввести сумму текстом.
 */
export async function recognizeReceipt(image: Buffer, timeoutMs = 25_000): Promise<OcrResult> {
  if (!isOcrEnabled()) throw new Error('Распознавание чеков выключено')

  const started = Date.now()
  const service = await getService()
  const buffer = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength)

  const recognition = await Promise.race([
    service.recognize(buffer as ArrayBuffer),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Распознавание заняло слишком долго')), timeoutMs),
    ),
  ])

  return {
    candidates: rankCandidates(recognition.text),
    text: recognition.text,
    confidence: recognition.confidence,
    elapsedMs: Date.now() - started,
  }
}

/**
 * Отправка сообщений в Telegram из процесса панели.
 *
 * Бот и веб — два отдельных процесса, общего объекта Bot у них нет. Когда
 * пользователь правит трату в панели, карточка в чате должна перестать врать.
 * Ходить за этим в Bot API напрямую проще и надёжнее, чем заводить очередь:
 * один HTTP-запрос, токен и так лежит в окружении.
 *
 * Все функции «мягкие»: ошибка Telegram не должна ронять запрос панели —
 * трата уже сохранена, а карточка в чате вторична.
 */

const API = 'https://api.telegram.org'

function token(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null
}

interface TelegramResponse {
  ok: boolean
  description?: string
  error_code?: number
}

async function call(method: string, payload: Record<string, unknown>): Promise<TelegramResponse | null> {
  const botToken = token()
  if (!botToken) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${API}/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const data = (await response.json()) as TelegramResponse
    if (!data.ok) {
      console.warn(`[telegram] ${method}: ${data.error_code} ${data.description}`)
    }
    return data
  } catch (error) {
    console.warn(`[telegram] ${method} не выполнен:`, (error as Error).message)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Переписывает карточку траты в чате.
 *
 * Именно правка, а не удаление с пересылкой: Bot API разрешает удалять
 * сообщения не старше 48 часов, а редактировать собственные сообщения бота
 * можно без ограничения по времени.
 */
export async function editExpenseCard(
  chatId: number | null,
  messageId: number | null,
  text: string,
  replyMarkup?: unknown,
): Promise<boolean> {
  if (!chatId || !messageId) return false
  const result = await call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
  return Boolean(result?.ok)
}

/** Сообщение пользователю в личку. */
export async function sendMessage(chatId: number, text: string): Promise<boolean> {
  const result = await call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  })
  return Boolean(result?.ok)
}

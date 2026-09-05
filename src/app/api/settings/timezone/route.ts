/**
 * Панель сообщает часовой пояс браузера.
 *
 * Telegram зону не передаёт, поэтому новому пользователю ставится зона
 * по умолчанию. Судья из Москвы иначе увидел бы «сегодня» со сдвигом
 * в два часа и решил бы, что цифры врут.
 *
 * Выбор человека важнее: если зона задана командой /settings, автоподмена
 * больше не срабатывает.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { applyBrowserTimezone } from '@/lib/expenses'
import { currentUser } from '@/lib/session'
import { safeTimeZone } from '@/lib/time'

export const dynamic = 'force-dynamic'

const schema = z.object({ timezone: z.string().min(1).max(64) })

export async function POST(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Нужна зона' }, { status: 400 })

  // Проверяем, что зона существует: пустой запасной вариант означает мусор.
  const zone = safeTimeZone(parsed.data.timezone, '')
  if (!zone) return NextResponse.json({ error: 'Неизвестная зона' }, { status: 400 })

  const changed = applyBrowserTimezone(user, zone)
  return NextResponse.json({ ok: true, changed, timezone: changed ? zone : user.timezone })
}

/**
 * Правка и удаление траты из панели.
 *
 * Все операции идут через сервис, где userId стоит внутри WHERE: чужую
 * строку нельзя изменить, даже зная её id. Ответ на чужой id — 404,
 * а не 403: иначе перебором можно было бы узнать, какие id существуют.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isCategorySlug } from '@/lib/categories'
import { deleteExpense, getExpense, restoreExpense, updateExpense } from '@/lib/expenses'
import { isValidCurrency } from '@/lib/money'
import { editExpenseCard } from '@/lib/notify'
import { currentUser } from '@/lib/session'
import { deletedCard, expenseCard } from '@/bot/ui'
import { totalFor } from '@/lib/stats'
import { rangeFor } from '@/lib/time'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  amount: z.number().positive().max(100_000_000).optional(),
  currency: z
    .string()
    .refine((value) => isValidCurrency(value), 'неизвестная валюта')
    .optional(),
  category: z.string().refine((value) => isCategorySlug(value), 'неизвестная категория').optional(),
  description: z.string().max(200).optional(),
  spentAt: z.number().int().positive().optional(),
  restore: z.boolean().optional(),
})

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { id } = await context.params
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 400 },
    )
  }

  if (parsed.data.restore) {
    const restored = restoreExpense(user.id, id)
    if (!restored) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })
    return NextResponse.json({ expense: restored })
  }

  const updated = updateExpense(user, id, parsed.data)
  if (!updated) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })

  // Переписываем карточку в чате: бот и панель — разные процессы, поэтому
  // идём в Bot API напрямую. Ответа не ждём, трата уже сохранена.
  const today = totalFor(user.id, rangeFor('day', Date.now(), user.timezone, user.weekStart))
  void editExpenseCard(
    updated.chatId,
    updated.messageId,
    expenseCard(
      updated,
      user.timezone,
      today.totalMinor,
      today.count,
      user.baseCurrency,
      'Изменено в панели.',
    ),
  )

  return NextResponse.json({ expense: updated })
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { id } = await context.params
  const deleted = deleteExpense(user.id, id)
  if (!deleted) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })

  // Карточка в чате не должна врать после удаления в панели.
  // Не ждём ответа Telegram: трата уже удалена, а сообщение вторично.
  void editExpenseCard(deleted.chatId, deleted.messageId, deletedCard(deleted))

  return NextResponse.json({ expense: deleted })
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const { id } = await context.params
  const expense = getExpense(user.id, id)
  if (!expense) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })
  return NextResponse.json({ expense })
}

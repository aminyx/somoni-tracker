/**
 * Премиум-эмодзи: сверка с настоящим каталогом Telegram.
 *
 * Выдуманный идентификатор — самая коварная ошибка в этой теме: Bot API
 * его принимает, тесты на формат проходят, и пустой квадрат появляется
 * только на экране у человека. Поэтому каждый идентификатор сверяется
 * с `assets/premium-emoji.txt` — выгрузкой набора RestrictedEmoji,
 * полученной у Telegram методом getStickerSet.
 *
 * Вторая проверка не менее важна: запасная эмодзи внутри тега обязана
 * совпадать с той, что лежит в каталоге под этим идентификатором. Иначе
 * человек с Premium и человек без него видят в одном месте разные значки,
 * и заметить это на своём телефоне невозможно — там всегда одна версия.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  BUTTON_ICON,
  CATEGORY_ICON,
  MARK,
  buttonIcon,
  categoryIcon,
  disablePremium,
  isPremiumEmojiError,
  mark,
  premiumEnabled,
  resetPremium,
  stripPremium,
  stripTags,
} from '../src/bot/emoji.ts'
import { CATEGORIES } from '../src/lib/categories.ts'

/** Каталог: идентификатор → эмодзи. */
function catalog(): Map<string, string> {
  const raw = readFileSync(new URL('../assets/premium-emoji.txt', import.meta.url), 'utf8')
  const out = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const space = trimmed.indexOf(' ')
    out.set(trimmed.slice(0, space), trimmed.slice(space + 1))
  }
  return out
}

/** Все объявленные пары «слот → идентификатор + запасная эмодзи». */
function allGlyphs(): Array<[string, { id: string; fallback: string }]> {
  return [
    ...Object.entries(BUTTON_ICON).map(([k, v]) => [`btn.${k}`, v] as const),
    ...Object.entries(MARK).map(([k, v]) => [`mark.${k}`, v] as const),
    ...Object.entries(CATEGORY_ICON).map(([k, v]) => [`cat.${k}`, v] as const),
  ] as Array<[string, { id: string; fallback: string }]>
}

test('каталог загружается и не пуст', () => {
  const cat = catalog()
  assert.ok(cat.size > 900, `в каталоге всего ${cat.size} эмодзи — похоже, файл обрезан`)
})

test('каждый идентификатор есть в каталоге Telegram', () => {
  const cat = catalog()
  const missing = allGlyphs()
    .filter(([, glyph]) => !cat.has(glyph.id))
    .map(([slot, glyph]) => `${slot} (${glyph.id})`)
  assert.deepEqual(missing, [], `нет в каталоге: ${missing.join(', ')}`)
})

test('запасная эмодзи совпадает с той, что в каталоге', () => {
  const cat = catalog()
  const wrong: string[] = []
  for (const [slot, glyph] of allGlyphs()) {
    const real = cat.get(glyph.id)
    if (real && real !== glyph.fallback) {
      wrong.push(`${slot}: заявлено ${glyph.fallback}, в каталоге ${real}`)
    }
  }
  assert.deepEqual(wrong, [], wrong.join('; '))
})

test('идентификаторы выглядят как настоящие', () => {
  for (const [slot, glyph] of allGlyphs()) {
    assert.match(glyph.id, /^\d{15,}$/, `${slot}: непохожий идентификатор`)
    assert.ok(glyph.fallback.trim().length > 0, `${slot}: пустая запасная эмодзи`)
  }
})

test('у каждой категории есть премиум-значок', () => {
  // Без него одна категория в списке выглядит иначе остальных, и это
  // читается как ошибка вёрстки, а не как «для неё не нашлось значка».
  const missing = CATEGORIES.filter((c) => !CATEGORY_ICON[c.slug]).map((c) => c.slug)
  assert.deepEqual(missing, [], `нет премиум-значка: ${missing.join(', ')}`)
})

test('значок категории совпадает с обычной эмодзи категории', () => {
  // categoryMark подставляет category.emoji внутрь тега: если они разные,
  // получатель с Premium и без него видят разные значки.
  const wrong: string[] = []
  for (const category of CATEGORIES) {
    const glyph = CATEGORY_ICON[category.slug]
    if (glyph && glyph.fallback !== category.emoji) {
      wrong.push(`${category.slug}: категория ${category.emoji}, значок ${glyph.fallback}`)
    }
  }
  assert.deepEqual(wrong, [], wrong.join('; '))
})

test('периоды в нижней панели различаются на вид', () => {
  const periods = [BUTTON_ICON.today, BUTTON_ICON.week, BUTTON_ICON.month].map((g) => g.fallback)
  assert.equal(new Set(periods).size, 3, `три кнопки периодов с одинаковым значком: ${periods}`)
})

test('тег собирается в том виде, который ждут остальные проверки', () => {
  resetPremium()
  const html = mark('saved')
  assert.match(html, /^<tg-emoji emoji-id="\d+">.+<\/tg-emoji>$/)
})

test('выключенный премиум оставляет обычную эмодзи, а не пустоту', () => {
  resetPremium()
  const before = mark('saved')
  assert.ok(before.includes('<tg-emoji'))

  disablePremium('проверка')
  assert.equal(premiumEnabled(), false)
  assert.equal(mark('saved'), MARK.saved.fallback, 'без премиума должна остаться обычная эмодзи')
  assert.equal(buttonIcon('today'), undefined, 'иконку кнопки ставить нельзя')
  assert.equal(categoryIcon('groceries'), undefined)
  resetPremium()
})

test('премиум-теги снимаются с текста без потери эмодзи', () => {
  const text = `${'<tg-emoji emoji-id="5427009714745517609">✅</tg-emoji>'} Готово`
  assert.equal(stripTags(text), '✅ Готово')
})

test('повторная отправка чистит и текст, и иконки кнопок', () => {
  // Это путь, по которому уходит сообщение, когда Telegram отверг эмодзи.
  // Если он не сработает, человек не получит ничего — а причина будет
  // видна только в логах.
  const payload = {
    chat_id: 1,
    text: '<tg-emoji emoji-id="5427009714745517609">✅</tg-emoji> Трата',
    caption: '<tg-emoji emoji-id="5375296873982604963">💰</tg-emoji> Итог',
    reply_markup: {
      keyboard: [[{ text: 'Сегодня', icon_custom_emoji_id: '5469947168523558652' }]],
      inline_keyboard: [[{ text: 'Удалить', icon_custom_emoji_id: '5465665476971471368', style: 'danger' }]],
    },
  }
  const plain = stripPremium(payload) as typeof payload

  assert.equal(plain.text, '✅ Трата')
  assert.equal(plain.caption, '💰 Итог')
  const reply = plain.reply_markup.keyboard[0]![0]!
  assert.equal(reply.text, 'Сегодня', 'подпись кнопки терять нельзя')
  assert.equal('icon_custom_emoji_id' in reply, false, 'иконка осталась — Telegram снова откажет')
  const inline = plain.reply_markup.inline_keyboard[0]![0]! as { style?: string }
  assert.equal(inline.style, 'danger', 'цвет кнопки не связан с эмодзи и должен остаться')
  assert.equal('icon_custom_emoji_id' in inline, false)

  // Исходный запрос не тронут: повтор не должен зависеть от порядка вызовов.
  assert.ok(payload.text.includes('<tg-emoji'))
})

test('отказ из-за эмодзи отличается от любого другого', () => {
  assert.equal(isPremiumEmojiError('Bad Request: CUSTOM_EMOJI_INVALID'), true)
  assert.equal(isPremiumEmojiError('Bad Request: custom emoji is not allowed'), true)
  assert.equal(isPremiumEmojiError('Bad Request: EMOJI_INVALID'), true)
  // А это обычные ошибки, гасить из-за них эмодзи нельзя.
  assert.equal(isPremiumEmojiError('Bad Request: message is not modified'), false)
  assert.equal(isPremiumEmojiError('Too Many Requests: retry after 5'), false)
  assert.equal(isPremiumEmojiError('Bad Request: chat not found'), false)
})

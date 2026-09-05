/**
 * Языки интерфейса: русский, таджикский, английский.
 *
 * Устройство простое намеренно: словарь плоских ключей и функция подстановки.
 * Библиотека здесь была бы тяжелее самой задачи — строк меньше трёхсот,
 * склонения решаются одной функцией на язык.
 *
 * Правило: русский — источник истины. Если ключа нет в таджикском или
 * английском, показывается русский, а не пустая строка и не сам ключ.
 * Тест сверяет полноту словарей, чтобы «а вдруг забыли» не дожило до
 * пользователя.
 */

export const LOCALES = ['ru', 'tg', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'ru'

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/** Как язык называется на себе самом — так его и показываем в выборе. */
export const LOCALE_NAMES: Record<Locale, string> = {
  ru: '🇷🇺 Русский',
  tg: '🇹🇯 Тоҷикӣ',
  en: '🇬🇧 English',
}

/**
 * Язык по коду от Telegram. Таджикский Telegram отдаёт как `tg`;
 * всё, что не распознали, — русский: продукт для Таджикистана,
 * где русский понимают почти все.
 */
export function localeFromTelegram(code: string | null | undefined): Locale {
  const value = (code ?? '').toLowerCase()
  if (value.startsWith('tg')) return 'tg'
  if (value.startsWith('en')) return 'en'
  if (value.startsWith('fa')) return 'tg' // персидский ближе к таджикскому, чем английский
  return 'ru'
}

/* ------------------------------------------------------------------ */
/*  Склонение числительных                                             */
/* ------------------------------------------------------------------ */

/**
 * Выбор формы слова при числе.
 *
 * Русский: три формы (трата / траты / трат).
 * Таджикский: существительное после числа не меняется — форма всегда одна,
 * поэтому во всех трёх ячейках стоит одно и то же слово.
 * Английский: две формы, третья дублирует вторую.
 */
export function plural(locale: Locale, count: number, forms: [string, string, string]): string {
  if (locale === 'tg') return forms[0]
  if (locale === 'en') return Math.abs(count) === 1 ? forms[0] : forms[1]

  const n = Math.abs(count) % 100
  const n1 = n % 10
  if (n > 10 && n < 20) return forms[2]
  if (n1 > 1 && n1 < 5) return forms[1]
  if (n1 === 1) return forms[0]
  return forms[2]
}

/* ------------------------------------------------------------------ */
/*  Словари                                                            */
/* ------------------------------------------------------------------ */

type Dict = Record<string, string>

/**
 * Формы множественного числа лежат в словаре через вертикальную черту,
 * чтобы переводчик видел их рядом, а не искал по коду.
 */
const ru: Dict = {
  'plural.expense': 'трата|траты|трат',
  'plural.day': 'день|дня|дней',
  'plural.category': 'категория|категории|категорий',
  'plural.example': 'пример|примера|примеров',

  'btn.today': 'Сегодня',
  'btn.week': 'Неделя',
  'btn.month': 'Месяц',
  'btn.panel': 'Панель',
  'btn.last': 'Последние',
  'btn.help': 'Как писать',
  'btn.openPanel': 'Открыть панель',
  'btn.category': 'Категория',
  'btn.delete': 'Удалить',
  'btn.restore': 'Вернуть',
  'btn.back': '← назад',
  'btn.changeTimezone': 'Сменить часовой пояс',
  'btn.changeCurrency': 'Сменить валюту',
  'btn.changeLanguage': 'Сменить язык',

  'placeholder.input': 'кофе 350',

  'start.greeting': 'Привет{name}. Я записываю траты.',
  'start.howto':
    'Просто напишите строку — например <code>{example1}</code> или <code>{example2}</code>.\nСумму и категорию разберу сам.',
  'start.reports': 'Итоги — кнопками ниже или командами /today, /week, /month.',
  'start.panel': 'Графики по дням и категориям — в панели, вход через того же бота, без пароля.',
  'start.buttons': 'Кнопки ниже — то же самое, что команды.',

  'panel.link': '\n\nПанель: {url}\nСсылка действует 10 минут и открывается один раз.',
  'panel.once': 'Ссылка действует 10 минут и открывается один раз — так её нельзя переслать и войти чужим.',

  'card.today': 'Сегодня: <b>{total}</b> · {count} {plural}',
  'card.converted': '≈ {amount} по курсу {rate}',
  'card.noDescription': 'Без описания',
  'card.deleted': 'Удалено.',
  'card.remembered': 'Запомнил: в следующий раз определю так же.',
  'card.restored': 'Вернул.',
  'card.editedInPanel': 'Изменено в панели.',
  'card.editedByYou': 'Обновил по вашей правке.',
  'card.fromReceipt': 'Сумма с чека. Категорию можно поправить кнопкой.',

  'first.done': 'Готово — первая трата записана.',
  'first.reports': 'Итоги: /today, /week, /month.',
  'first.panel': 'Графики по дням и категориям — в панели.',

  'report.empty': 'Пока пусто.',
  'report.emptyHint': 'Напишите «{example}» — и трата появится здесь и в панели.',
  'report.same': '≈ столько же · {tail}',
  'report.delta': '{arrow} {percent}% · {tail}',
  'report.tail': '<i>за те же {days} до этого — {amount}</i>',
  'report.more': '📦 ещё {count} — {amount}',
  'report.average': 'в среднем {amount} в день',
  'report.charts': 'Графики по дням — в панели.',

  'last.title': '<b>Последние траты</b>',
  'last.empty': 'Пока ни одной траты. Напишите «{example}».',
  'last.noDescription': 'без описания',
  'last.hint': 'Чтобы поправить или удалить — нажмите ссылку под тратой.',
  'last.notFound': 'Такой траты нет.',

  'time.today': 'сегодня {time}',
  'time.yesterday': 'вчера {time}',
  'time.date': '{day} {month}, {time}',

  'settings.title': '<b>Настройки</b>',
  'settings.timezone': '🌍 Часовой пояс: <b>{zone}</b> ({offset})',
  'settings.currency': '💰 Валюта отчётов: <b>{code}</b>',
  'settings.language': '🗣 Язык: <b>{name}</b>',
  'settings.whyTimezone': 'От часового пояса зависит, что считать «сегодня».',
  'settings.pickTimezone': '<b>Часовой пояс</b>\n\nВыберите город — по нему считаются «сегодня», неделя и месяц.',
  'settings.pickCurrency':
    '<b>Валюта отчётов</b>\n\nТраты в других валютах пересчитываются в неё по курсу на день траты.\nНужной нет? Напишите код: <code>/settings GBP</code>',
  'settings.pickLanguage': '<b>Язык</b>\n\nНа каком языке отвечать?',
  'settings.timezoneSet': '🌍 Часовой пояс: <b>{city}</b> ({offset})\n\nТеперь «сегодня», неделя и месяц считаются по нему.',
  'settings.currencySet':
    '💰 Валюта отчётов: <b>{code}</b>\n\nУже записанные траты остаются в валюте ввода — пересчёт идёт по курсу на день траты.',
  'settings.languageSet': '🗣 Язык: <b>{name}</b>',
  'settings.unknownZone': 'Неизвестная зона',
  'settings.unknownCurrency': 'Неизвестная валюта',

  'limit.title': '<b>Лимиты по категориям</b>',
  'limit.intro': 'Задайте месячный потолок — предупрежу на 80% и когда он будет исчерпан.',
  'limit.example': 'Например: <code>/limit продукты 2000</code>\nСнять: <code>/limit продукты 0</code>',
  'limit.categories': 'Категории: {list}',
  'limit.current': '<b>Лимиты на этот месяц</b>',
  'limit.row': '{mark} {emoji} {name} — {spent} из {limit} ({percent}%)',
  'limit.format': 'Формат: <code>/limit продукты 2000</code>',
  'limit.unknownCategory': 'Не знаю категорию «{name}». Список — в /limit без аргументов.',
  'limit.removed': 'Лимит на «{name}» снят.',
  'limit.absent': 'Такого лимита не было.',
  'limit.set': '{emoji} Лимит на «{name}»: {amount} в месяц.',
  'limit.warn80': '🟡 {emoji} <b>{name}</b>: потрачено {spent} из {limit}.\nОсталось {left}.',
  'limit.warn100': '🔴 {emoji} <b>{name}</b>: лимит исчерпан.\nПотрачено {spent} из {limit}.',

  'export.empty': 'За этот месяц трат нет — выгружать нечего.',
  'export.caption': '{count} {plural} за текущий месяц.',

  'demo.already': 'Примеры уже добавлены. Убрать их — /demo_clear.',
  'demo.added': 'Добавил {count} {plural} за последние полтора месяца.',
  'demo.yours': 'Это ваши собственные записи — их видно только вам.',
  'demo.next': 'Посмотрите /month, а потом откройте панель.',
  'demo.clearHint': 'Убрать примеры одной командой: /demo_clear',
  'demo.cleared': 'Убрал {count} {plural}. Ваши настоящие траты не тронуты.',
  'demo.nothing': 'Примеров не было.',

  'receipt.off': 'Распознавание чеков выключено. Напишите трату текстом: «{example}».',
  'receipt.reading': 'Читаю чек…',
  'receipt.failed': 'Сумму на чеке разобрать не вышло. Напишите её текстом: «{example}».',
  'receipt.error': 'Не получилось прочитать чек. Напишите трату текстом: «{example}».',
  'receipt.question': 'Нашёл на чеке. Какая сумма — трата?',
  'receipt.hint': 'Если ни одна не подходит — просто напишите сумму текстом.',

  'error.notFound': 'Трата не найдена',
  'error.alreadyDeleted': 'Уже удалено',
  'error.cannotRestore': 'Не получилось вернуть',
  'error.strangeAmount': 'Странная сумма',
  'error.cannotSave': 'Не удалось сохранить',
  'toast.deleted': 'Удалено',
  'toast.restored': 'Вернул',
  'toast.saved': 'Записал',

  'parse.empty': 'Пустое сообщение.',
  'parse.noAmount': 'Не нашёл сумму. Напишите, например: «{example}».',
  'parse.notPositive': 'Сумма должна быть больше нуля.',
  'parse.tooLarge': 'Сумма слишком большая — похоже на опечатку.',
  'parse.examples': 'Примеры: <code>{e1}</code>, <code>{e2}</code>, <code>{e3}</code>.',

  'rate.offline': 'Курс взят из встроенной таблицы: сети не было.',
  'rate.unknown': 'Курс {currency} неизвестен — сумма учтена как есть. Поправьте в панели.',

  'web.spent': 'Потрачено',
  'web.spentDay': 'Потрачено за день',
  'web.categories': 'Категории',
  'web.byDays': 'По дням',
  'web.max': 'макс. {amount} · {day}',
  'web.average': 'ср. {amount}',
  'web.today': 'Сегодня',
  'web.yesterday': 'Вчера',
  'web.showAll': 'показать весь период',
  'web.moreCategories': 'ещё {count} {plural}',
  'web.collapse': 'свернуть',
  'web.emptyTitle': 'Здесь появятся траты',
  'web.emptyBody': 'Напишите боту «{example}» — и она окажется на этом экране через секунду.',
  'web.emptyPeriod': 'За период трат нет.',
  'web.emptyCategory': 'В этой категории пока пусто.',
  'web.amount': 'Сумма',
  'web.description': 'Описание',
  'web.category': 'Категория',
  'web.saving': 'сохраняю…',
  'web.autosave': 'изменения сохраняются сразу',
  'web.delete': 'Удалить',
  'web.deletedToast': 'Удалено: {label}',
  'web.restore': 'Вернуть',
  'web.downloadCsv': 'Скачать CSV',
  'web.logout': 'Выйти',
  'web.prevPeriod': 'Предыдущий период',
  'web.nextPeriod': 'Следующий период',
  'web.day': 'День',
  'web.week': 'Неделя',
  'web.month': 'Месяц',
  'web.expense': 'Трата',

  'landing.title': 'Траты — одной строкой',
  'landing.body1':
    'Пишете боту «{example}» — трата записана. Здесь видно, куда уходят деньги: по дням, по категориям, за неделю и месяц.',
  'landing.body2': 'Отдельной регистрации нет. Вход — через того же бота: он пришлёт ссылку по команде {command}.',
  'landing.openBot': 'Открыть бота',
  'landing.privacy': 'Данные каждого пользователя видны только ему.',

  'enter.title': 'Вход в панель',
  'enter.body': 'Отдельного пароля нет: вы уже опознаны через Telegram. Ссылка сработает один раз.',
  'enter.button': 'Войти',
  'enter.deadTitle': 'Ссылка больше не работает',
  'enter.deadBody':
    'Ссылки живут десять минут и открываются один раз — так их бесполезно пересылать. Попросите у бота новую командой {command}.',
}

/** Заполняются переводом; пустой ключ означает «взять русский». */
const tg: Dict = {}
const en: Dict = {}

const DICTS: Record<Locale, Dict> = { ru, tg, en }

/** Подставляет {параметры} в строку. */
function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.hasOwn(params, key) ? String(params[key]) : whole,
  )
}

/**
 * Строка на нужном языке. Если перевода нет — русский: показать понятный
 * текст на чужом языке лучше, чем ключ или пустоту.
 */
export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const value = DICTS[locale]?.[key] ?? ru[key]
  if (value === undefined) {
    // Ключ, которого нет вообще: в разработке это ошибка, в бою — не повод падать.
    if (process.env.NODE_ENV !== 'production') console.warn(`[i18n] нет ключа: ${key}`)
    return key
  }
  return interpolate(value, params)
}

/** Формы множественного числа из словаря: «трата|траты|трат». */
export function tPlural(locale: Locale, key: string, count: number): string {
  const raw = DICTS[locale]?.[key] ?? ru[key] ?? ''
  const parts = raw.split('|')
  const forms: [string, string, string] = [
    parts[0] ?? '',
    parts[1] ?? parts[0] ?? '',
    parts[2] ?? parts[1] ?? parts[0] ?? '',
  ]
  return plural(locale, count, forms)
}

/** Примеры ввода зависят от языка: в них живые слова, а не заглушки. */
export const EXAMPLES: Record<Locale, { one: string; two: string; three: string }> = {
  ru: { one: 'кофе 350', two: 'такси 900 работа', three: 'вчера продукты 1.5к' },
  tg: { one: 'қаҳва 350', two: 'такси 900 кор', three: 'дирӯз хӯрокворӣ 1.5к' },
  en: { one: 'coffee 350', two: 'taxi 900 work', three: 'yesterday groceries 1.5k' },
}

/** Все ключи русского словаря — по ним тест проверяет полноту переводов. */
export function allKeys(): string[] {
  return Object.keys(ru)
}

export function dictFor(locale: Locale): Dict {
  return DICTS[locale]
}

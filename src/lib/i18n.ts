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
/**
 * Язык для страниц, которые открываются до входа: лендинг и /enter.
 * Пользователя там ещё нет, а заголовок Accept-Language есть всегда.
 *
 * Разбор нарочно грубый: берём первый тег и смотрим на его основу. Полный
 * разбор с q-весами дал бы другой ответ только там, где человек перечислил
 * несколько языков и понизил вес первого — редкость, ради которой не стоит
 * держать лишний код на странице входа.
 */
export function localeFromHeader(header: string | null | undefined): Locale {
  const first = (header ?? '').split(',')[0]?.trim() ?? ''
  return localeFromTelegram(first)
}

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
  'btn.last': 'История',
  'btn.help': 'Помощь',
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
  'report.more': 'ещё {count} — {amount}',
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
  'settings.timezone': '{icon} Часовой пояс: <b>{zone}</b> ({offset})',
  'settings.currency': '{icon} Валюта отчётов: <b>{code}</b>',
  'settings.language': '{icon} Язык: <b>{name}</b>',
  'settings.whyTimezone': 'От часового пояса зависит, что считать «сегодня».',
  'settings.pickTimezone': '<b>Часовой пояс</b>\n\nВыберите город — по нему считаются «сегодня», неделя и месяц.',
  'settings.pickCurrency':
    '<b>Валюта отчётов</b>\n\nТраты в других валютах пересчитываются в неё по курсу на день траты.\nНужной нет? Напишите код: <code>/settings GBP</code>',
  'settings.pickLanguage': '<b>Язык</b>\n\nНа каком языке отвечать?',
  'settings.timezoneSet': '{icon} Часовой пояс: <b>{city}</b> ({offset})\n\nТеперь «сегодня», неделя и месяц считаются по нему.',
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
  'receipt.question': '{icon} Нашёл на чеке. Какая сумма — трата?',
  'receipt.hint': 'Если ни одна не подходит — просто напишите сумму текстом.',

  'error.notFound': 'Трата не найдена',
  'error.alreadyDeleted': 'Уже удалено',
  'error.cannotRestore': 'Не получилось вернуть',
  'error.strangeAmount': 'Странная сумма',
  'error.cannotSave': 'Не удалось сохранить',
  'toast.deleted': 'Удалено',
  'toast.restored': 'Вернул',
  'toast.saved': 'Записал',
  'toast.notFound': 'Трата не найдена',
  'export.filename': 'траты',
  'settings.usage': 'Не понял. Пример: <code>/settings Asia/Dushanbe</code>, <code>/settings USD</code> или <code>/settings tg</code>',

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
  'web.themeLight': 'Светлая тема',
  'web.themeDark': 'Тёмная тема',
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

  'help.title': '{icon} <b>Как пользоваться</b>',
  'help.intro': 'Просто напишите трату одной строкой:',
  'help.exampleCurrency': 'обед 45 usd',
  'help.category': 'Категорию определю сам — если ошибусь, поправьте кнопкой под карточкой, и в следующий раз я запомню.',
  'help.commands': '<b>Команды</b>',
  'help.list': '/today — итог за сегодня\n/week — за неделю (с понедельника)\n/month — за месяц\n/last — последние траты\n/panel — открыть веб-панель\n/limit — лимит по категории\n/export — выгрузить CSV\n/settings — язык, часовой пояс и валюта\n/demo — заполнить примерами\n/help — эта справка',
  'receipt.word': 'Чек',
  'start.pickLanguage': 'Язык можно сменить сразу — или писать траты прямо сейчас.',
  'wizard.language': '<b>Язык</b>\nНа каком языке говорить?',
  'wizard.city': '<b>Город</b>\nПо нему считаются «сегодня», неделя и месяц.',
  'wizard.done': '{icon} <b>Готово</b>\n{city} · {offset} · {currency}\n\nТеперь просто напишите трату: <code>{example}</code>',
  'wizard.skip': 'Пропустить',
  'wizard.changeCurrency': 'Другая валюта',
  'cmd.today': 'Итог за сегодня',
  'cmd.week': 'Итог за неделю',
  'cmd.month': 'Итог за месяц',
  'cmd.last': 'Последние траты',
  'cmd.panel': 'Открыть веб-панель',
  'cmd.limit': 'Лимит по категории',
  'cmd.export': 'Выгрузить CSV',
  'cmd.settings': 'Язык, часовой пояс, валюта',
  'cmd.demo': 'Заполнить примерами',
  'cmd.help': 'Как пользоваться',
  'web.sameDaysMonth': 'за те же {days} {month}',
  'web.sameDaysPeriod': 'за те же {days} прошлого периода',
  'web.almostSame': '≈ так же',
}

/**
 * Таджикский. Существительное после числа не меняется, поэтому во всех
 * трёх формах множественного стоит одно слово — это правильно, а не небрежность.
 */
const tg: Dict = {
  'plural.expense': 'харҷ|харҷ|харҷ',
  'plural.day': 'рӯз|рӯз|рӯз',
  'plural.category': 'категория|категория|категория',
  'plural.example': 'мисол|мисол|мисол',
  'btn.today': 'Имрӯз',
  'btn.week': 'Ҳафта',
  'btn.month': 'Моҳ',
  'btn.panel': 'Панел',
  'btn.last': 'Охирин',
  'btn.help': 'Кӯмак',
  'btn.openPanel': 'Кушодани панел',
  'btn.category': 'Категория',
  'btn.delete': 'Нест кардан',
  'btn.restore': 'Баргардондан',
  'btn.back': '← бозгашт',
  'btn.changeTimezone': 'Иваз кардани минтақаи вақт',
  'btn.changeCurrency': 'Иваз кардани асъор',
  'btn.changeLanguage': 'Иваз кардани забон',
  'placeholder.input': 'қаҳва 350',
  'start.greeting': 'Салом{name}. Ман харҷҳоро сабт мекунам.',
  'start.howto': 'Танҳо як сатр нависед — масалан <code>{example1}</code> ё <code>{example2}</code>.\nМаблағ ва категорияро худам муайян мекунам.',
  'start.reports': 'Ҷамъбаст — бо тугмаҳои поён ё фармонҳои /today, /week, /month.',
  'start.panel': 'Графикҳо аз рӯи рӯзҳо ва категорияҳо — дар панел, вуруд тавассути ҳамин бот, бе парол.',
  'start.buttons': 'Тугмаҳои поён ҳамон кореро мекунанд, ки фармонҳо мекунанд.',
  'panel.link': '\n\nПанел: {url}\nПайванд 10 дақиқа эътибор дорад ва танҳо як бор кушода мешавад.',
  'panel.once': 'Пайванд 10 дақиқа эътибор дорад ва танҳо як бор кушода мешавад — бинобар ин онро фиристодан ва бо он ба ҳисоби шумо даромадан мумкин нест.',
  'card.today': 'Имрӯз: <b>{total}</b> · {count} {plural}',
  'card.converted': '≈ {amount} бо қурби {rate}',
  'card.noDescription': 'Бе тавсиф',
  'card.deleted': 'Нест карда шуд.',
  'card.remembered': 'Дар хотир гирифтам: дафъаи оянда ҳамин тавр муайян мекунам.',
  'card.restored': 'Баргардондам.',
  'card.editedInPanel': 'Дар панел тағйир дода шуд.',
  'card.editedByYou': 'Аз рӯи ислоҳи шумо навсозӣ кардам.',
  'card.fromReceipt': 'Маблағ аз чек. Категорияро бо тугма ислоҳ кардан мумкин аст.',
  'first.done': 'Тайёр — харҷи аввал сабт шуд.',
  'first.reports': 'Ҷамъбаст: /today, /week, /month.',
  'first.panel': 'Графикҳо аз рӯи рӯзҳо ва категорияҳо — дар панел.',
  'report.empty': 'Ҳоло холӣ.',
  'report.emptyHint': '«{example}» нависед — ва харҷ дар ин ҷо ва дар панел пайдо мешавад.',
  'report.same': '≈ ҳамон қадар · {tail}',
  'report.delta': '{arrow} {percent}% · {tail}',
  'report.tail': '<i>дар ҳамон {days} пеш аз ин — {amount}</i>',
  'report.more': 'боз {count} — {amount}',
  'report.average': 'ба ҳисоби миёна {amount} дар як рӯз',
  'report.charts': 'Графикҳо аз рӯи рӯзҳо — дар панел.',
  'last.title': '<b>Харҷҳои охирин</b>',
  'last.empty': 'Ҳоло ягон харҷ нест. «{example}» нависед.',
  'last.noDescription': 'бе тавсиф',
  'last.hint': 'Барои ислоҳ ё нест кардан — пайванди зери харҷро пахш кунед.',
  'last.notFound': 'Чунин харҷ нест.',
  'time.today': 'имрӯз {time}',
  'time.yesterday': 'дирӯз {time}',
  'time.date': '{day} {month}, {time}',
  'settings.title': '<b>Танзимот</b>',
  'settings.timezone': '{icon} Минтақаи вақт: <b>{zone}</b> ({offset})',
  'settings.currency': '{icon} Асъори ҳисобот: <b>{code}</b>',
  'settings.language': '{icon} Забон: <b>{name}</b>',
  'settings.whyTimezone': 'Аз минтақаи вақт вобаста аст, ки чиро «имрӯз» ҳисоб кунем.',
  'settings.pickTimezone': '<b>Минтақаи вақт</b>\n\nШаҳрро интихоб кунед — аз рӯи он «имрӯз», ҳафта ва моҳ ҳисоб мешаванд.',
  'settings.pickCurrency': '<b>Асъори ҳисобот</b>\n\nХарҷҳо бо асъори дигар бо қурби рӯзи харҷ ба он гардонда мешаванд.\nАсъори лозимӣ нест? Кодашро нависед: <code>/settings GBP</code>',
  'settings.pickLanguage': '<b>Забон</b>\n\nБо кадом забон ҷавоб диҳам?',
  'settings.timezoneSet': '{icon} Минтақаи вақт: <b>{city}</b> ({offset})\n\nАкнун «имрӯз», ҳафта ва моҳ аз рӯи он ҳисоб мешаванд.',
  'settings.currencySet': '💰 Асъори ҳисобот: <b>{code}</b>\n\nХарҷҳои аллакай сабтшуда бо асъори воридшуда мемонанд — гардониш бо қурби рӯзи харҷ меравад.',
  'settings.languageSet': '🗣 Забон: <b>{name}</b>',
  'settings.unknownZone': 'Минтақаи номаълум',
  'settings.unknownCurrency': 'Асъори номаълум',
  'limit.title': '<b>Маҳдудиятҳо аз рӯи категорияҳо</b>',
  'limit.intro': 'Ҳадди моҳонаро таъин кунед — дар 80% ва ҳангоми тамом шудани он огоҳ мекунам.',
  'limit.example': 'Масалан: <code>/limit хӯрокворӣ 2000</code>\nБардоштан: <code>/limit хӯрокворӣ 0</code>',
  'limit.categories': 'Категорияҳо: {list}',
  'limit.current': '<b>Маҳдудиятҳо барои ин моҳ</b>',
  'limit.row': '{mark} {emoji} {name} — {spent} аз {limit} ({percent}%)',
  'limit.format': 'Формат: <code>/limit хӯрокворӣ 2000</code>',
  'limit.unknownCategory': 'Категорияи «{name}»-ро намедонам. Рӯйхат — дар /limit бе аргумент.',
  'limit.removed': 'Маҳдудият барои «{name}» бардошта шуд.',
  'limit.absent': 'Чунин маҳдудият набуд.',
  'limit.set': '{emoji} Маҳдудият барои «{name}»: {amount} дар як моҳ.',
  'limit.warn80': '🟡 {emoji} <b>{name}</b>: аз {limit} маблағи {spent} харҷ шуд.\n{left} мондааст.',
  'limit.warn100': '🔴 {emoji} <b>{name}</b>: маҳдудият тамом шуд.\nАз {limit} маблағи {spent} харҷ шуд.',
  'export.empty': 'Дар ин моҳ харҷ нест — чизе барои баровардан нест.',
  'export.caption': '{count} {plural} барои моҳи ҷорӣ.',
  'demo.already': 'Намунаҳо аллакай илова шудаанд. Барои бардоштани онҳо — /demo_clear.',
  'demo.added': '{count} {plural} барои якуним моҳи охир илова кардам.',
  'demo.yours': 'Инҳо навиштаҳои худи шумоанд — онҳоро танҳо шумо мебинед.',
  'demo.next': '/month-ро бинед, баъд панелро кушоед.',
  'demo.clearHint': 'Намунаҳоро бо як фармон бардоред: /demo_clear',
  'demo.cleared': '{count} {plural} бардоштам. Харҷҳои ҳақиқии шумо даст нахӯрданд.',
  'demo.nothing': 'Намуна набуд.',
  'receipt.off': 'Хондани чек хомӯш аст. Харҷро бо матн нависед: «{example}».',
  'receipt.reading': 'Чекро мехонам…',
  'receipt.failed': 'Маблағи чекро муайян карда натавонистам. Онро бо матн нависед: «{example}».',
  'receipt.error': 'Чекро хонда натавонистам. Харҷро бо матн нависед: «{example}».',
  'receipt.question': '{icon} Дар чек ёфтам. Кадом маблағ харҷ аст?',
  'receipt.hint': 'Агар ҳеҷ кадомаш мувофиқ набошад — маблағро бо матн нависед.',
  'error.notFound': 'Харҷ ёфт нашуд',
  'error.alreadyDeleted': 'Аллакай нест карда шуд',
  'error.cannotRestore': 'Баргардондан нашуд',
  'error.strangeAmount': 'Маблағи аҷиб',
  'error.cannotSave': 'Нигоҳ дошта нашуд',
  'toast.deleted': 'Нест карда шуд',
  'toast.restored': 'Баргардондам',
  'toast.saved': 'Сабт кардам',
  'toast.notFound': 'Харҷ ёфт нашуд',
  'export.filename': 'харҷҳо',
  'settings.usage': 'Нафаҳмидам. Мисол: <code>/settings Asia/Dushanbe</code>, <code>/settings USD</code> ё <code>/settings tg</code>',
  'parse.empty': 'Паём холӣ аст.',
  'parse.noAmount': 'Маблағро наёфтам. Масалан ҳамин тавр нависед: «{example}».',
  'parse.notPositive': 'Маблағ бояд аз сифр зиёд бошад.',
  'parse.tooLarge': 'Маблағ хеле калон — ба хатои чоп монанд аст.',
  'parse.examples': 'Мисолҳо: <code>{e1}</code>, <code>{e2}</code>, <code>{e3}</code>.',
  'rate.offline': 'Қурб аз ҷадвали дохилӣ гирифта шуд: шабака набуд.',
  'rate.unknown': 'Қурби {currency} номаълум аст — маблағ ҳамон тавр ба ҳисоб гирифта шуд. Дар панел ислоҳ кунед.',
  'web.spent': 'Харҷ шуд',
  'web.spentDay': 'Харҷи рӯз',
  'web.categories': 'Категорияҳо',
  'web.byDays': 'Аз рӯи рӯзҳо',
  'web.max': 'макс. {amount} · {day}',
  'web.average': 'миёна {amount}',
  'web.today': 'Имрӯз',
  'web.yesterday': 'Дирӯз',
  'web.showAll': 'тамоми давраро нишон додан',
  'web.moreCategories': 'боз {count} {plural}',
  'web.collapse': 'ҷамъ кардан',
  'web.emptyTitle': 'Дар ин ҷо харҷҳо пайдо мешаванд',
  'web.emptyBody': 'Ба бот «{example}» нависед — ва он пас аз як сония дар ҳамин экран пайдо мешавад.',
  'web.emptyPeriod': 'Дар ин давра харҷ нест.',
  'web.emptyCategory': 'Дар ин категория ҳоло холӣ.',
  'web.amount': 'Маблағ',
  'web.description': 'Тавсиф',
  'web.category': 'Категория',
  'web.saving': 'нигоҳ дошта истодаам…',
  'web.autosave': 'тағйирот фавран нигоҳ дошта мешавад',
  'web.delete': 'Нест кардан',
  'web.deletedToast': 'Нест карда шуд: {label}',
  'web.restore': 'Баргардондан',
  'web.downloadCsv': 'CSV-ро зеркашӣ кардан',
  'web.logout': 'Баромадан',
  'web.themeLight': 'Мавзӯи равшан',
  'web.themeDark': 'Мавзӯи торик',
  'web.prevPeriod': 'Давраи пешина',
  'web.nextPeriod': 'Давраи навбатӣ',
  'web.day': 'Рӯз',
  'web.week': 'Ҳафта',
  'web.month': 'Моҳ',
  'web.expense': 'Харҷ',
  'landing.title': 'Харҷҳо — бо як сатр',
  'landing.body1': 'Ба бот «{example}» менависед — харҷ сабт шуд. Дар ин ҷо дида мешавад, ки пул ба куҷо меравад: аз рӯи рӯзҳо, аз рӯи категорияҳо, барои ҳафта ва моҳ.',
  'landing.body2': 'Бақайдгирии алоҳида нест. Вуруд — тавассути ҳамин бот: ӯ бо фармони {command} пайванд мефиристад.',
  'landing.openBot': 'Кушодани бот',
  'landing.privacy': 'Маълумоти ҳар корбар танҳо ба худи ӯ дида мешавад.',
  'enter.title': 'Вуруд ба панел',
  'enter.body': 'Пароли алоҳида нест: шумо аллакай тавассути Telegram шинохта шудаед. Пайванд як бор кор мекунад.',
  'enter.button': 'Даромадан',
  'enter.deadTitle': 'Пайванд дигар кор намекунад',
  'enter.deadBody': 'Пайвандҳо даҳ дақиқа зиндаанд ва як бор кушода мешаванд — бинобар ин фиристодани онҳо бефоида аст. Аз бот бо фармони {command} пайванди нав пурсед.',

  'help.title': '{icon} <b>Тарзи истифода</b>',
  'help.intro': 'Танҳо харҷро бо як сатр нависед:',
  'help.exampleCurrency': 'хӯроки нисфирӯзӣ 45 usd',
  'help.category': 'Категорияро худам муайян мекунам — агар хато кунам, бо тугмаи зери корт ислоҳ кунед, ва дафъаи оянда дар хотир мегирам.',
  'help.commands': '<b>Фармонҳо</b>',
  'help.list': '/today — ҷамъбасти имрӯз\n/week — барои ҳафта (аз душанбе)\n/month — барои моҳ\n/last — харҷҳои охирин\n/panel — кушодани панел\n/limit — маҳдудият аз рӯи категория\n/export — баровардани CSV\n/settings — забон, минтақаи вақт ва асъор\n/demo — бо намунаҳо пур кардан\n/help — ҳамин роҳнамо',
  'receipt.word': 'Чек',
  'start.pickLanguage': 'Забонро дарҳол иваз кардан мумкин аст — ё ҳозир ҳамин хел харҷ нависед.',
  'wizard.language': '<b>Забон</b>\nБо кадом забон гап занем?',
  'wizard.city': '<b>Шаҳр</b>\nАз рӯи он «имрӯз», ҳафта ва моҳ ҳисоб мешавад.',
  'wizard.done': '{icon} <b>Тайёр</b>\n{city} · {offset} · {currency}\n\nАкнун танҳо харҷро нависед: <code>{example}</code>',
  'wizard.skip': 'Гузаштан',
  'wizard.changeCurrency': 'Асъори дигар',
  'cmd.today': 'Ҷамъи имрӯз',
  'cmd.week': 'Ҷамъи ҳафта',
  'cmd.month': 'Ҷамъи моҳ',
  'cmd.last': 'Харҷҳои охирин',
  'cmd.panel': 'Кушодани панел',
  'cmd.limit': 'Маҳдудият аз рӯи категория',
  'cmd.export': 'Боркунии CSV',
  'cmd.settings': 'Забон, минтақаи вақт, асъор',
  'cmd.demo': 'Пур кардан бо мисолҳо',
  'cmd.help': 'Тарзи истифода',
  'web.sameDaysMonth': 'дар ҳамон {days}-и {month}',
  'web.sameDaysPeriod': 'дар ҳамон {days}-и давраи гузашта',
  'web.almostSame': '≈ ҳамон қадар',
}

/** Английский: две формы, третья повторяет вторую. */
const en: Dict = {
  'plural.expense': 'expense|expenses|expenses',
  'plural.day': 'day|days|days',
  'plural.category': 'category|categories|categories',
  'plural.example': 'example|examples|examples',
  'btn.today': 'Today',
  'btn.week': 'Week',
  'btn.month': 'Month',
  'btn.panel': 'Panel',
  'btn.last': 'Recent',
  'btn.help': 'Help',
  'btn.openPanel': 'Open dashboard',
  'btn.category': 'Category',
  'btn.delete': 'Delete',
  'btn.restore': 'Restore',
  'btn.back': '← back',
  'btn.changeTimezone': 'Change time zone',
  'btn.changeCurrency': 'Change currency',
  'btn.changeLanguage': 'Change language',
  'placeholder.input': 'coffee 350',
  'start.greeting': 'Hi{name}. I record expenses.',
  'start.howto': 'Just write a line — for example <code>{example1}</code> or <code>{example2}</code>.\nI will work out the amount and the category myself.',
  'start.reports': 'Summaries — the buttons below or the commands /today, /week, /month.',
  'start.panel': 'Charts by day and by category are in the dashboard, entry through this same bot, no password.',
  'start.buttons': 'The buttons below do the same as the commands.',
  'panel.link': '\n\nDashboard: {url}\nThe link works for 10 minutes and opens once.',
  'panel.once': 'The link works for 10 minutes and opens once — so it cannot be forwarded and used by someone else.',
  'card.today': 'Today: <b>{total}</b> · {count} {plural}',
  'card.converted': '≈ {amount} at the rate {rate}',
  'card.noDescription': 'No description',
  'card.deleted': 'Deleted.',
  'card.remembered': 'Noted: next time I will sort it the same way.',
  'card.restored': 'Restored.',
  'card.editedInPanel': 'Edited in the dashboard.',
  'card.editedByYou': 'Updated with your edit.',
  'card.fromReceipt': 'Amount from the receipt. You can fix the category with the button.',
  'first.done': 'Done — the first expense is recorded.',
  'first.reports': 'Summaries: /today, /week, /month.',
  'first.panel': 'Charts by day and by category are in the dashboard.',
  'report.empty': 'Nothing yet.',
  'report.emptyHint': 'Write “{example}” — and the expense will show up here and in the dashboard.',
  'report.same': '≈ the same · {tail}',
  'report.delta': '{arrow} {percent}% · {tail}',
  'report.tail': '<i>the same {days} before that — {amount}</i>',
  'report.more': '{count} more — {amount}',
  'report.average': '{amount} a day on average',
  'report.charts': 'Charts by day are in the dashboard.',
  'last.title': '<b>Recent expenses</b>',
  'last.empty': 'No expenses yet. Write “{example}”.',
  'last.noDescription': 'no description',
  'last.hint': 'To edit or delete, tap the link under the expense.',
  'last.notFound': 'There is no such expense.',
  'time.today': 'today {time}',
  'time.yesterday': 'yesterday {time}',
  'time.date': '{day} {month}, {time}',
  'settings.title': '<b>Settings</b>',
  'settings.timezone': '{icon} Time zone: <b>{zone}</b> ({offset})',
  'settings.currency': '{icon} Report currency: <b>{code}</b>',
  'settings.language': '{icon} Language: <b>{name}</b>',
  'settings.whyTimezone': 'The time zone decides what counts as “today”.',
  'settings.pickTimezone': '<b>Time zone</b>\n\nPick a city — today, the week and the month are counted by it.',
  'settings.pickCurrency': '<b>Report currency</b>\n\nExpenses in other currencies are converted into it at the rate for the day of the expense.\nYours is not here? Write the code: <code>/settings GBP</code>',
  'settings.pickLanguage': '<b>Language</b>\n\nWhich language should I reply in?',
  'settings.timezoneSet': '{icon} Time zone: <b>{city}</b> ({offset})\n\nToday, the week and the month are now counted by it.',
  'settings.currencySet': '💰 Report currency: <b>{code}</b>\n\nExpenses already recorded stay in the currency you entered — conversion uses the rate for the day of the expense.',
  'settings.languageSet': '🗣 Language: <b>{name}</b>',
  'settings.unknownZone': 'Unknown zone',
  'settings.unknownCurrency': 'Unknown currency',
  'limit.title': '<b>Category limits</b>',
  'limit.intro': 'Set a monthly cap — I will warn you at 80% and when it runs out.',
  'limit.example': 'For example: <code>/limit groceries 2000</code>\nRemove: <code>/limit groceries 0</code>',
  'limit.categories': 'Categories: {list}',
  'limit.current': '<b>Limits for this month</b>',
  'limit.row': '{mark} {emoji} {name} — {spent} of {limit} ({percent}%)',
  'limit.format': 'Format: <code>/limit groceries 2000</code>',
  'limit.unknownCategory': 'I do not know the category “{name}”. The list is in /limit with no arguments.',
  'limit.removed': 'The limit on “{name}” is removed.',
  'limit.absent': 'There was no such limit.',
  'limit.set': '{emoji} Limit on “{name}”: {amount} a month.',
  'limit.warn80': '🟡 {emoji} <b>{name}</b>: spent {spent} of {limit}.\n{left} left.',
  'limit.warn100': '🔴 {emoji} <b>{name}</b>: the limit is used up.\nSpent {spent} of {limit}.',
  'export.empty': 'There are no expenses this month — nothing to export.',
  'export.caption': '{count} {plural} for the current month.',
  'demo.already': 'The examples are already added. To remove them — /demo_clear.',
  'demo.added': 'Added {count} {plural} over the last month and a half.',
  'demo.yours': 'These are your own records — only you can see them.',
  'demo.next': 'Look at /month, then open the dashboard.',
  'demo.clearHint': 'Remove the examples with one command: /demo_clear',
  'demo.cleared': 'Removed {count} {plural}. Your real expenses are untouched.',
  'demo.nothing': 'There were no examples.',
  'receipt.off': 'Receipt scanning is off. Write the expense as text: “{example}”.',
  'receipt.reading': 'Reading the receipt…',
  'receipt.failed': 'The amount on the receipt could not be read. Write it as text: “{example}”.',
  'receipt.error': 'The receipt could not be read. Write the expense as text: “{example}”.',
  'receipt.question': '{icon} Found these on the receipt. Which amount is the expense?',
  'receipt.hint': 'If none of them fit, just write the amount as text.',
  'error.notFound': 'Expense not found',
  'error.alreadyDeleted': 'Already deleted',
  'error.cannotRestore': 'Could not restore',
  'error.strangeAmount': 'Odd amount',
  'error.cannotSave': 'Could not save',
  'toast.deleted': 'Deleted',
  'toast.restored': 'Restored',
  'toast.saved': 'Saved',
  'toast.notFound': 'Expense not found',
  'export.filename': 'expenses',
  'settings.usage': 'Did not get it. Example: <code>/settings Asia/Dushanbe</code>, <code>/settings USD</code> or <code>/settings tg</code>',
  'parse.empty': 'Empty message.',
  'parse.noAmount': 'I did not find an amount. Write it like this: “{example}”.',
  'parse.notPositive': 'The amount must be greater than zero.',
  'parse.tooLarge': 'The amount is too large — looks like a typo.',
  'parse.examples': 'Examples: <code>{e1}</code>, <code>{e2}</code>, <code>{e3}</code>.',
  'rate.offline': 'The rate is taken from the built-in table: there was no network.',
  'rate.unknown': 'The {currency} rate is unknown — the amount is recorded as is. Fix it in the dashboard.',
  'web.spent': 'Spent',
  'web.spentDay': 'Spent that day',
  'web.categories': 'Categories',
  'web.byDays': 'By day',
  'web.max': 'max {amount} · {day}',
  'web.average': 'avg {amount}',
  'web.today': 'Today',
  'web.yesterday': 'Yesterday',
  'web.showAll': 'show the whole period',
  'web.moreCategories': '{count} more {plural}',
  'web.collapse': 'collapse',
  'web.emptyTitle': 'Expenses will appear here',
  'web.emptyBody': 'Write “{example}” to the bot — and it will be on this screen a second later.',
  'web.emptyPeriod': 'No expenses for this period.',
  'web.emptyCategory': 'Nothing in this category yet.',
  'web.amount': 'Amount',
  'web.description': 'Description',
  'web.category': 'Category',
  'web.saving': 'saving…',
  'web.autosave': 'changes are saved right away',
  'web.delete': 'Delete',
  'web.deletedToast': 'Deleted: {label}',
  'web.restore': 'Restore',
  'web.downloadCsv': 'Download CSV',
  'web.logout': 'Log out',
  'web.themeLight': 'Light theme',
  'web.themeDark': 'Dark theme',
  'web.prevPeriod': 'Previous period',
  'web.nextPeriod': 'Next period',
  'web.day': 'Day',
  'web.week': 'Week',
  'web.month': 'Month',
  'web.expense': 'Expense',
  'landing.title': 'Expenses in one line',
  'landing.body1': 'You write “{example}” to the bot — the expense is recorded. Here you see where the money goes: by day, by category, by week and by month.',
  'landing.body2': 'There is no separate sign-up. Entry is through the same bot: it sends a link on the {command} command.',
  'landing.openBot': 'Open the bot',
  'landing.privacy': 'Each user sees only their own data.',
  'enter.title': 'Dashboard sign-in',
  'enter.body': 'There is no separate password: you are already identified through Telegram. The link works once.',
  'enter.button': 'Sign in',
  'enter.deadTitle': 'The link no longer works',
  'enter.deadBody': 'Links live ten minutes and open once — so forwarding them is pointless. Ask the bot for a new one with the {command} command.',

  'help.title': '{icon} <b>How to use</b>',
  'help.intro': 'Just write an expense on one line:',
  'help.exampleCurrency': 'lunch 45 usd',
  'help.category': 'I work out the category myself — if I get it wrong, fix it with the button under the card and I will remember next time.',
  'help.commands': '<b>Commands</b>',
  'help.list': '/today — today\'s total\n/week — this week (from Monday)\n/month — this month\n/last — recent expenses\n/panel — open the dashboard\n/limit — category limit\n/export — download CSV\n/settings — language, time zone and currency\n/demo — fill with examples\n/help — this help',
  'receipt.word': 'Receipt',
  'start.pickLanguage': 'Change the language now — or just start writing expenses.',
  'wizard.language': '<b>Language</b>\nWhich language should I use?',
  'wizard.city': '<b>City</b>\nIt decides what counts as today, this week and this month.',
  'wizard.done': '{icon} <b>All set</b>\n{city} · {offset} · {currency}\n\nNow just write an expense: <code>{example}</code>',
  'wizard.skip': 'Skip',
  'wizard.changeCurrency': 'Another currency',
  'cmd.today': 'Today total',
  'cmd.week': 'This week total',
  'cmd.month': 'This month total',
  'cmd.last': 'Recent expenses',
  'cmd.panel': 'Open the dashboard',
  'cmd.limit': 'Category limit',
  'cmd.export': 'Export CSV',
  'cmd.settings': 'Language, timezone, currency',
  'cmd.demo': 'Fill with examples',
  'cmd.help': 'How to use it',
  'web.sameDaysMonth': 'same {days} of {month}',
  'web.sameDaysPeriod': 'same {days} of the previous period',
  'web.almostSame': '≈ about the same',
}

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

/* ------------------------------------------------------------------ */
/*  Даты                                                               */
/* ------------------------------------------------------------------ */

/**
 * Месяцы в родительном падеже: «3 сентября». В таджикском и английском
 * падежей нет, поэтому форма одна и та же в обоих списках.
 */
export const MONTHS_GENITIVE: Record<Locale, string[]> = {
  ru: ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'],
  tg: ['январ','феврал','март','апрел','май','июн','июл','август','сентябр','октябр','ноябр','декабр'],
  en: ['January','February','March','April','May','June','July','August','September','October','November','December'],
}

/** Месяцы как заголовок: «Сентябрь 2026». */
export const MONTHS_NOMINATIVE: Record<Locale, string[]> = {
  ru: ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'],
  tg: ['Январ','Феврал','Март','Апрел','Май','Июн','Июл','Август','Сентябр','Октябр','Ноябр','Декабр'],
  en: ['January','February','March','April','May','June','July','August','September','October','November','December'],
}

/** Дни недели, коротко. Первый — воскресенье, как в Date.getUTCDay(). */
export const WEEKDAYS_SHORT: Record<Locale, string[]> = {
  ru: ['вс','пн','вт','ср','чт','пт','сб'],
  tg: ['яш','дш','сш','чш','пш','ҷм','шн'],
  en: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
}

/** Месяцы для подписей графика: «5 сен». */
export const MONTHS_SHORT: Record<Locale, string[]> = {
  ru: ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'],
  tg: ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'],
  en: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
}

/** Языковой тег для Intl: форматирование чисел и дат. */
export const INTL_LOCALE: Record<Locale, string> = {
  ru: 'ru-RU',
  tg: 'tg-TJ',
  en: 'en-GB',
}

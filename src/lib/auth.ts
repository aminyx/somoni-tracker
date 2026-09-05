/**
 * Вход в панель без пароля. Две двери, одна сессия.
 *
 *  1. Magic-link из бота — основной путь. Бот присылает кнопку со ссылкой,
 *     панель обменивает одноразовый токен на сессию.
 *  2. initData Telegram Mini App — когда панель открыта внутри Telegram.
 *
 * Вход через oauth.telegram.org (OIDC) сознательно не делаем: он требует
 * регистрации Allowed URLs и client secret в BotFather — лишний барьер при
 * запуске, а первые два пути полностью закрывают «вход через Telegram».
 *
 * Общее правило: идентификатор пользователя НИКОГДА не берётся из того,
 * что прислал клиент. Только из подписанных Telegram данных или из строки
 * в нашей базе.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from './db'
import { authTokens, sessions, users, type User } from './db/schema'
import { newSecret } from './id'

/** Срок жизни ссылки входа. Ссылка лежит в переписке — держим её короткой. */
export const LOGIN_TOKEN_TTL_MS = 10 * 60 * 1000
/** Срок жизни сессии панели. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Максимальный возраст initData: дальше требуем переоткрыть приложение. */
export const INIT_DATA_MAX_AGE_S = 3600

export const SESSION_COOKIE = 'tracker_session'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/* ------------------------------------------------------------------ */
/*  Одноразовые ссылки входа                                           */
/* ------------------------------------------------------------------ */

/**
 * Выдаёт токен входа. В базу кладётся только его хеш: утечка дампа
 * не даёт рабочих ссылок. Предыдущие живые токены гасим — у пользователя
 * всегда ровно одна действующая ссылка.
 */
export function issueLoginToken(userId: number): { token: string; expiresAt: number } {
  const token = newSecret(32)
  const now = Date.now()
  const expiresAt = now + LOGIN_TOKEN_TTL_MS

  db.transaction((tx) => {
    tx.update(authTokens)
      .set({ usedAt: now })
      .where(and(eq(authTokens.userId, userId), isNull(authTokens.usedAt)))
      .run()
    tx.insert(authTokens)
      .values({ tokenHash: sha256(token), userId, createdAt: now, expiresAt })
      .run()
  })

  return { token, expiresAt }
}

/**
 * Забирает токен. Один UPDATE с условием — повторный вызов уже ничего
 * не найдёт, поэтому гонка «две вкладки открыли ссылку» не создаёт
 * двух сессий.
 *
 * Вызывать ТОЛЬКО из POST-обработчика: краулер превью ссылок Telegram
 * ходит по ссылке GET-запросом раньше человека и сжёг бы токен.
 */
export function consumeLoginToken(token: string): number | null {
  const now = Date.now()
  const rows = db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning({ userId: authTokens.userId })
    .all()

  return rows[0]?.userId ?? null
}

/** Проверка без потребления — чтобы страница подтверждения не врала кнопкой. */
export function peekLoginToken(token: string): boolean {
  const now = Date.now()
  const row = db
    .select({ userId: authTokens.userId })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .get()
  return Boolean(row)
}

/* ------------------------------------------------------------------ */
/*  Сессии                                                             */
/* ------------------------------------------------------------------ */

export type SessionOrigin = 'magic-link' | 'webapp'

/** Создаёт сессию и возвращает значение для cookie (в базе только хеш). */
export function createSession(
  userId: number,
  origin: SessionOrigin = 'magic-link',
  userAgent?: string,
): { value: string; expiresAt: number } {
  const value = newSecret(32)
  const now = Date.now()
  const expiresAt = now + SESSION_TTL_MS

  db.insert(sessions)
    .values({
      idHash: sha256(value),
      userId,
      createdAt: now,
      expiresAt,
      lastUsedAt: now,
      origin,
      userAgent: userAgent?.slice(0, 255) ?? null,
    })
    .run()

  return { value, expiresAt }
}

/**
 * Возвращает пользователя по значению cookie. Заодно продлевает сессию,
 * но не чаще раза в сутки — иначе каждый запрос это лишняя запись на диск.
 */
export function resolveSession(value: string | undefined | null): User | null {
  if (!value) return null
  const now = Date.now()
  const hash = sha256(value)

  const row = db
    .select({ user: users, lastUsedAt: sessions.lastUsedAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, hash), gt(sessions.expiresAt, now)))
    .get()

  if (!row) return null

  if (now - row.lastUsedAt > 24 * 60 * 60 * 1000) {
    db.update(sessions)
      .set({ lastUsedAt: now, expiresAt: now + SESSION_TTL_MS })
      .where(eq(sessions.idHash, hash))
      .run()
  }

  return row.user
}

export function destroySession(value: string | undefined | null): void {
  if (!value) return
  db.delete(sessions).where(eq(sessions.idHash, sha256(value))).run()
}

/** Выход со всех устройств. */
export function destroyAllSessions(userId: number): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run()
}

/** Убирает протухшие строки. Бот вызывает раз в час. */
export function pruneExpired(): { sessions: number; tokens: number } {
  const now = Date.now()
  const s = db.delete(sessions).where(lt(sessions.expiresAt, now)).run()
  const t = db
    .delete(authTokens)
    .where(or(lt(authTokens.expiresAt, now), sql`${authTokens.usedAt} is not null`))
    .run()
  return { sessions: s.changes, tokens: t.changes }
}

/* ------------------------------------------------------------------ */
/*  Telegram Mini App: проверка initData                               */
/* ------------------------------------------------------------------ */

export interface TelegramWebAppUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
  photo_url?: string
  is_premium?: boolean
}

export interface InitDataResult {
  user: TelegramWebAppUser
  authDate: number
  startParam: string | null
}

/**
 * Проверяет подпись initData Mini App.
 *
 * Ключ выводится не так, как в старом Login Widget: там secret = SHA256(token),
 * здесь secret = HMAC_SHA256(key = "WebAppData", msg = token). Перепутанный
 * порядок аргументов — самая частая ошибка, и она не даёт исключения:
 * подпись просто никогда не сходится.
 */
export function verifyInitData(initData: string, botToken: string): InitDataResult {
  const query = new URLSearchParams(initData)
  const hash = query.get('hash')
  if (!hash) throw new Error('initData без подписи')

  // Из строки проверки исключается ТОЛЬКО hash. Поле signature (Ed25519-подпись
  // для сторонних проверяющих, появилось в Bot API 8.0) — такое же полученное
  // поле, и Telegram считает HMAC вместе с ним. Если его выбросить, подпись
  // не сойдётся никогда: именно на этом Mini App отдавал 401 на каждый запуск.
  // Оба поля исключаются только в другой проверке — по ключу Ed25519.
  query.delete('hash')

  const dataCheckString = [...query.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => key + '=' + value)
    .join('\n')

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(dataCheckString).digest()

  const given = Buffer.from(hash, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(expected, given)) {
    throw new Error('подпись initData не сходится')
  }

  const authDate = Number(query.get('auth_date'))
  if (!Number.isFinite(authDate)) throw new Error('initData без auth_date')
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate
  // Отрицательный возраст допускаем в пределах минуты: часы клиента могут спешить.
  if (ageSeconds > INIT_DATA_MAX_AGE_S || ageSeconds < -60) {
    throw new Error('initData устарела, переоткройте приложение')
  }

  const rawUser = query.get('user')
  if (!rawUser) throw new Error('initData без пользователя')
  const user = JSON.parse(rawUser) as TelegramWebAppUser
  if (!user?.id) throw new Error('initData без user.id')

  return { user, authDate, startParam: query.get('start_param') }
}

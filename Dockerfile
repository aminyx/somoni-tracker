# Debian, а не Alpine: у better-sqlite3 под musl нет готовых сборок.
# Но и под этот Node готовой сборки может не оказаться — тогда npm собирает
# модуль из исходников, а для этого нужны python3 и компилятор. Держать их
# в рабочем образе незачем, поэтому сборка идёт в отдельном слое.

# ---------- сборка зависимостей ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Ставим и dev-зависимости: боту нужен tsx во время работы, а панели —
# сборщик Next на следующем шаге.
RUN npm ci --include=dev

# ---------- сборка панели ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Секреты на этом шаге не нужны и не передаются — им не место в слоях образа.
RUN npm run build

# ---------- рабочий образ ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Скомпилированный better-sqlite3 переезжает готовым: компилятор в рабочем
# образе не нужен.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json package-lock.json next.config.ts tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src ./src

# Каталог базы должен принадлежать пользователю, под которым идёт запуск.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000
CMD ["npm", "run", "start"]

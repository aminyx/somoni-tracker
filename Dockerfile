# Debian, а не Alpine: у better-sqlite3 под musl нет готовых сборок.
# Но и под этот Node готовой сборки может не оказаться — тогда npm собирает
# модуль из исходников, а для этого нужны python3 и компилятор. Держать их
# в рабочем образе незачем, поэтому сборка идёт отдельными слоями.

# ---------- зависимости для сборки панели (включая dev) ----------
FROM node:22-bookworm-slim AS deps-build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# ---------- зависимости для работы (без dev) ----------
FROM node:22-bookworm-slim AS deps-runtime
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Готовые бинарники под чужие платформы. onnxruntime кладёт сборки сразу под
# все системы: macOS и Windows в линуксовом образе не нужны и стоят 216 МБ.
# Варианты под musl тоже лишние — образ на Debian с glibc.
#
# Комментарии стоят ДО инструкции, а не внутри цепочки && : в shell символ #
# после переноса строки закомментировал бы весь остаток команды, и удаление
# молча не выполнилось бы.
ARG TARGETARCH=amd64
RUN set -eux;     cd node_modules;     rm -rf onnxruntime-node/bin/napi-v6/darwin onnxruntime-node/bin/napi-v6/win32;     if [ "$TARGETARCH" = "amd64" ]; then       rm -rf onnxruntime-node/bin/napi-v6/linux/arm64;     else       rm -rf onnxruntime-node/bin/napi-v6/linux/x64;     fi;     rm -rf @next/swc-*-musl @napi-rs/canvas-*-musl @img/sharp-linuxmusl-*            @img/sharp-libvips-linuxmusl-* @img/sharp-wasm32

# ---------- сборка панели ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps-build /app/node_modules ./node_modules
COPY . .
# Секреты на этом шаге не нужны и не передаются — им не место в слоях образа.
RUN npm run build

# ---------- рабочий образ ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps-runtime /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json package-lock.json next.config.ts tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src ./src

# Каталоги базы и кэша моделей должны принадлежать пользователю запуска.
RUN mkdir -p /app/data /home/node/.cache \
  && chown -R node:node /app/data /home/node/.cache
USER node

EXPOSE 3000
CMD ["npm", "run", "start"]

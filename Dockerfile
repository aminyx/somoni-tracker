# Debian, а не Alpine: у better-sqlite3 под musl нет готовых сборок,
# и образ бы собирался из исходников по несколько минут.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# Зависимости отдельным слоем: пересобирается только при смене package-lock.
COPY package.json package-lock.json ./
# Ставим и dev-зависимости: боту нужен tsx во время работы.
RUN npm ci --include=dev && npm cache clean --force

COPY . .

# Сборка панели. Переменные окружения на этом шаге не нужны и не передаются —
# секретам в слоях образа не место.
RUN npm run build

# Каталог базы должен существовать и принадлежать непривилегированному
# пользователю, под которым идёт запуск.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000
CMD ["npm", "run", "start"]

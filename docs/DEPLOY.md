# Развёртывание

Требования к площадке заданы самим продуктом:

- бот опрашивает Telegram постоянно — площадка не должна засыпать;
- база это файл — нужен постоянный диск, а не эфемерная файловая система;
- судья может открыть панель в любой момент — холодный старт недопустим.

Из-за первых двух пунктов serverless-хостинги (Vercel, Cloudflare Workers)
не подходят в принципе, а бесплатные тарифы Render и Koyeb засыпают через
15 минут и просыпаются около минуты. Остаётся обычный сервер.

---

## Вариант 1 (основной): свой сервер с Docker

Предполагается, что на сервере уже есть Caddy, который держит 80 и 443.
Ниже — минимальное вмешательство: один каталог, один файл конфигурации
и одна дописанная строка. Всё откатывается двумя командами.

### 1. Сначала посмотреть, что там уже работает

Ничего не меняя:

```bash
ss -tulpn | sort -k5 > /root/ports-before.txt
ss -tlpn 'sport = :443'
grep -nE '^\s*import' /etc/caddy/Caddyfile || echo 'директивы import нет'
curl -s localhost:2019/config/ > /root/caddy-config-before.json
```

Если 443 держит не Caddy, а что-то другое, — переходите к варианту 2,
конфигурацию чужой службы трогать не нужно.

### 2. Положить проект

```bash
install -d -m 755 /opt/somoni-tracker
cd /opt/somoni-tracker
git clone https://github.com/aminyx/somoni-tracker.git .
cp .env.example .env
```

Заполнить в `.env`:

```
TELEGRAM_BOT_TOKEN=…
TELEGRAM_BOT_USERNAME=…
SESSION_SECRET=…            # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
APP_URL=https://tracker.example.tj
DATABASE_PATH=/app/data/tracker.db
```

```bash
chmod 600 .env
docker compose up -d --build
curl -s localhost:3000/api/health     # ждём {"ok":true,...}
```

Контейнеры слушают только `127.0.0.1` — правила брандмауэра менять не нужно.

Модели распознавания чеков (около 12 МБ) скачиваются при первом запуске бота
в том `./models`. Если распознавание не нужно — поставьте
`ENABLE_RECEIPT_OCR=false`: тогда `onnxruntime` вообще не загружается
и процесс бота занимает примерно на 300 МБ меньше.

### 3. Отдать панель наружу через Caddy

Пакет Caddy для Debian и Ubuntu ставит **один** файл `/etc/caddy/Caddyfile`
и никакого каталога `conf.d` не заводит — это надо создать самому. Зато
директиву `import` разрешено дописывать в конец, а пустой шаблон ошибкой
не считается: удаление своего файла потом само по себе всё вернёт.

```bash
mkdir -p /etc/caddy/conf.d
cat > /etc/caddy/conf.d/somoni-tracker.caddy <<'EOF'
tracker.example.tj {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
EOF

cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak
grep -q 'conf.d' /etc/caddy/Caddyfile || echo 'import /etc/caddy/conf.d/*.caddy' >> /etc/caddy/Caddyfile

caddy validate --config /etc/caddy/Caddyfile   # проверка ДО перезагрузки
systemctl reload caddy
curl -sI https://tracker.example.tj/api/health
```

Сертификат Caddy получит сам, если домен уже указывает на этот сервер.

**Откат:**

```bash
rm /etc/caddy/conf.d/somoni-tracker.caddy && systemctl reload caddy
cd /opt/somoni-tracker && docker compose down
```

Оставшаяся строка `import` безвредна: пустой шаблон не ошибка.

### 4. Обновление

```bash
cd /opt/somoni-tracker
git pull
docker compose up -d --build
```

Миграции применяются при старте контейнера `web`, база в `./data` переживает
пересборку.

---

## Вариант 2: сервер занят, ничего трогать нельзя

Cloudflare Tunnel. Он ходит только наружу, поэтому не конфликтует ни с одним
занятым портом и не требует ни правки брандмауэра, ни правки чужих конфигов.

```bash
docker run -d --restart unless-stopped --network host \
  cloudflare/cloudflared:latest tunnel --no-autoupdate \
  run --token <ТОКЕН_ТУННЕЛЯ>
```

В панели Cloudflare туннель направляется на `http://127.0.0.1:3000`.
TLS завершается на стороне Cloudflare.

---

## Вариант 3: отдельная платная площадка

Railway (Hobby, около 5 долларов в месяц): оба процесса в одном проекте, том
для `data/`, без засыпания. Разворачивается из этого же репозитория. Годится,
если своего сервера нет.

---

## Обязательное после развёртывания

1. **Указать адрес панели.** В `.env` поле `APP_URL` должно совпадать
   с реальным адресом — бот подставляет его в кнопку входа. После изменения:
   `docker compose up -d`.
2. **Проверить, что бот один.** Telegram отдаёт обновления единственному
   потребителю. Локальный бот с тем же токеном заставит серверного замолчать.
3. **Наблюдение.** Любой бесплатный пингер (UptimeRobot, Better Stack)
   на `https://…/api/health` раз в пять минут.
4. **Резервная копия базы.** SQLite копируется на ходу только специальной
   командой — обычный `cp` может поймать файл в середине записи:

   ```bash
   cat >> /etc/cron.daily/somoni-backup <<'EOF'
   #!/bin/sh
   d=/opt/somoni-tracker/backups
   mkdir -p "$d"
   sqlite3 /opt/somoni-tracker/data/tracker.db \
     ".backup '$d/tracker-$(date +%F).db'"
   find "$d" -name 'tracker-*.db' -mtime +14 -delete
   EOF
   chmod +x /etc/cron.daily/somoni-backup
   ```

---

## Диагностика

| Симптом | Куда смотреть |
|---|---|
| Бот молчит | `docker compose logs -f bot`. Чаще всего второй запущенный экземпляр с тем же токеном. |
| Панель отвечает 502 | `docker compose ps`, `curl localhost:3000/api/health`. |
| Кнопка «Открыть панель» ведёт на localhost | В `.env` не заполнен `APP_URL`. |
| «Ссылка недействительна» сразу после нажатия | Ссылка одноразовая и живёт 10 минут — запросите новую через `/panel`. |
| Курсы не обновляются | Не критично: берётся встроенная таблица. Проверить `docker compose logs bot | grep курсы`. |
| Бот не читает чеки | `docker compose logs bot | grep чек`. Чаще всего не скачались модели: нужен доступ к huggingface.co, либо выключите `ENABLE_RECEIPT_OCR`. |
| Боту не хватает памяти | Распознавание чеков — самая тяжёлая часть. `ENABLE_RECEIPT_OCR=false` снимает около 300 МБ. |

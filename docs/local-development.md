# Локальная разработка

Оба воркера запускаются через `wrangler dev --local`: Workers, D1 и R2 эмулируются на компьютере, аккаунт Cloudflare и домен не нужны.

| Воркер | Пакет | Папка | Порт |
|---|---|---|---|
| `cloakmail-api` | `@zevkamail/api` | `packages/cloudflare` | 8787 |
| `cloakmail-web` | `@zevkamail/web` | `packages/web` | 8788 |

Веб-воркер обращается к API через Service Binding `API`, поэтому API должен быть запущен первым.

## Требования

- Node.js и npm.
- `curl` для эмуляции писем. В Windows PowerShell вызывайте `curl.exe`, а не `curl` (это алиас `Invoke-WebRequest`).

## API-воркер

Папка `packages/cloudflare`.

Первый запуск:

```bash
npm install --legacy-peer-deps
cp wrangler.toml.example wrangler.toml
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply DB --local
```

- Если npm сообщит, что install-скрипты `esbuild` и `workerd` не разрешены, выполните `npm approve-scripts esbuild workerd`, затем `npm rebuild esbuild workerd`.
- `database_id` в `wrangler.toml` для локального запуска менять не нужно.
- `API_KEY` в `.dev.vars` можно оставить пустым — тогда API работает без ключа.

Запуск:

```bash
npx wrangler dev --local --port 8787
# или: npm run dev
```

После получения кода с новыми миграциями примените их ещё раз: `npm run migrate:local`.

## Веб-воркер

Папка `packages/web`.

Первый запуск:

```bash
npm install --legacy-peer-deps
cp wrangler.toml.example wrangler.toml
cp .dev.vars.example .dev.vars
```

- В `wrangler.toml` для локального запуска поставьте `PUBLIC_EMAIL_DOMAIN = "localhost"`.
- В `.dev.vars` уже стоит `ALLOW_OPEN_SITE="1"` (вход не спрашивается). Если в `packages/cloudflare/.dev.vars` задан `API_KEY`, впишите сюда тот же ключ.

Сборка и запуск:

```bash
npm run build
npx wrangler dev --local --port 8788
```

Сборка по умолчанию использует адаптер Cloudflare. Wrangler отдаёт собранный бандл, поэтому после каждой правки кода сайта нужно повторить `npm run build`.

В логе запуска должна быть строка `env.API (cloakmail-api) ... [connected]`. Откройте http://localhost:8788, например http://localhost:8788/inbox/test@localhost.

`npm run dev` (`vite dev`) запускает сайт без Service Binding: страницы откроются, но `/api/*` работать не будет.

### Проверка парольного входа

В `packages/web/.dev.vars` уберите `ALLOW_OPEN_SITE`, раскомментируйте `SITE_PASSWORD="..."` и перезапустите `wrangler dev`.

## Эмуляция входящего письма

Wrangler принимает письмо на специальный эндпоинт и передаёт его в обработчик `email()`. Подготовьте файл `mail.eml`. Заголовок `Message-ID` обязателен: без него локальный эмулятор письмо отвергнет.

```
From: Sender <sender@example.test>
To: test@localhost
Subject: Код подтверждения
Message-ID: <test-1@example.test>
Date: Sun, 08 Nov 2026 12:00:00 +0000
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Ваш код: 482915
```

Отправка:

```bash
curl -X POST "http://localhost:8787/cdn-cgi/handler/email?from=sender@example.test&to=test@localhost" --data-binary @mail.eml
```

Адрес получателя берётся из параметра `to` (SMTP-конверт), а не из заголовка `To`.

Чтение через API:

```bash
curl -H "X-API-Key: <ключ из .dev.vars>" http://localhost:8787/api/inbox/test@localhost
```

Если `API_KEY` пустой, заголовок не нужен.

## Проверки и тесты

Из корня репозитория (зависимости должны быть установлены в обоих пакетах):

```bash
npm run check   # проверка типов обоих пакетов
npm test        # юнит-тесты обоих пакетов
```

По пакетам:

| Пакет | Команда | Что делает |
|---|---|---|
| `packages/web` | `npm test` | Vitest: `clipboard`, `generateAddress`, `code` (поиск кода подтверждения) в `src/lib/utils/__tests__` |
| `packages/web` | `npm run check` | `svelte-check` |
| `packages/cloudflare` | `npm run test:unit` | Vitest в Node (`vitest.unit.config.ts`): `test/unit/fit-inline.test.ts` — обрезка больших тел писем |
| `packages/cloudflare` | `npm run check` | `tsc --noEmit` |

Интеграционные тесты воркера (`npm test` в `packages/cloudflare`, файлы `test/*.test.ts`, `@cloudflare/vitest-pool-workers` 0.6) сейчас не запускаются: пул несовместим с текущим `workerd` (ошибка `No such module "node:vm"`). Нужно обновить пул тестов.

### CI

`.github/workflows/ci.yml` на каждый push и pull request в `main` запускает в GitHub Actions:

- `packages/cloudflare`: `npm run check`, `npm run test:unit`;
- `packages/web`: `npm run check`, `npm test`, `npm run build:cloudflare`.

## Переменные окружения

Секреты локально задаются в `.dev.vars` (файл в `.gitignore`, шаблон — `.dev.vars.example` в каждом пакете), в облаке — через `npx wrangler secret put <ИМЯ>`. Обычные переменные задаются в `[vars]` файла `wrangler.toml`; значения из `.dev.vars` при локальном запуске их переопределяют.

### `packages/cloudflare` (API)

| Переменная | Где задаётся | По умолчанию | Назначение |
|---|---|---|---|
| `API_KEY` | `.dev.vars` / секрет | пусто | Ключ для `X-API-Key`. Пусто — API открыт без проверки |
| `DOMAIN` | `[vars]` | `localhost` | Почтовый домен |
| `EMAIL_TTL_SECONDS` | `[vars]` | `86400` | Срок жизни писем одноразовых ящиков и срок после открепления постоянного |
| `MAX_EMAIL_SIZE_MB` | `[vars]` | `10` | Читается в конфигурации, в варианте на Workers размер письма сейчас не ограничивает |

Привязки: `DB` (D1, обязательно), `R2` (R2, необязательно, по умолчанию выключен).

### `packages/web` (сайт)

| Переменная | Где задаётся | По умолчанию | Назначение |
|---|---|---|---|
| `API_KEY` | `.dev.vars` / секрет | пусто | Тот же ключ, что у API; добавляется к проксируемым запросам |
| `SITE_PASSWORD` | `.dev.vars` / секрет | пусто | Пароль на сайт. В облаке без него сайт отвечает 503 |
| `ALLOW_OPEN_SITE` | `.dev.vars` | `1` в шаблоне | `1` — разрешить работу без пароля. Только для локальной разработки |
| `PUBLIC_APP_NAME` | `[vars]` | `zevkamail` | Название в интерфейсе |
| `PUBLIC_EMAIL_DOMAIN` | `[vars]` | `example.com` в шаблоне | Домен, на котором интерфейс создаёт адреса |

Привязка: `API` (Service Binding на `cloakmail-api`, обязательно).

## Частые проблемы

- **Сайт отвечает `SITE_PASSWORD is not set` (503).** В `packages/web/.dev.vars` нет ни `ALLOW_OPEN_SITE="1"`, ни `SITE_PASSWORD`.
- **Интерфейс получает 401 на `/api/*`.** `API_KEY` в `packages/web/.dev.vars` не совпадает с ключом в `packages/cloudflare/.dev.vars`.
- **Ошибка `no such table: mailboxes`.** Не применена миграция `0002`: `npm run migrate:local`.
- **Сервер отвечает старым кодом.** После некорректного завершения `wrangler dev` процесс `workerd` может остаться занимать порт 8787. Завершите его (в Windows — `workerd.exe` в диспетчере задач) и запустите заново.
- **Изменения сайта не видны.** Не выполнена пересборка: `npm run build`.

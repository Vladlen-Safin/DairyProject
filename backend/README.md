# ediary-backend

Бэкенд «Электронного дневника»: импортирует выгрузку 1С (XML с FTP) в PostgreSQL
и отдаёт данные фронтенду (Angular, каталог [`../dairy`](../dairy)).

Переписанная версия старого модуля Drupal ([`../old/e_diary_import.module`](../old/e_diary_import.module)):
потоковый разбор больших XML, чекпоинты в БД вместо `.tmp`-файлов, даты как строки
`YYYY-MM-DD` (без сдвигов таймзоны).

---

## Как это работает

```
1С ──FTP──> filelist.xml ──┐
                           ├─> POST /importxml ──> парсинг ──> PostgreSQL
   book / groups /         │        │
   events / final_marks ───┘        └──> result.xml ──FTP──> 1С

Angular ──> GET /api/* (+ /api/auth/*) ──> PostgreSQL
```

- `POST /importxml` — принимает запрос от 1С: качает файлы с FTP, парсит, пишет в БД,
  кладёт `result.xml` обратно на FTP. Отдаёт текстовый код (`DONE` / `CONTINUE` / …).
- `GET /api/*` — read-API для фронтенда.
- `POST /api/auth/*` — демо-авторизация (JWT access + httpOnly refresh-cookie).

---

## Требования

| Компонент | Версия |
|---|---|
| Node.js | 20+ |
| PostgreSQL | 14+ (проверено на 18) |
| Доступ по сети | к FTP 1С (по умолчанию `192.168.8.16:21`) — только для `/importxml` |

---

## Быстрый старт

### 1. База данных (один раз)

Под суперпользователем `postgres`:

```sql
CREATE ROLE ediary LOGIN PASSWORD 'ediary';
CREATE DATABASE ediary OWNER ediary;
```

### 2. Конфиг

Проверьте `backend/.env` (файл не в git, значения для локальной разработки уже заданы):

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `DATABASE_URL` | строка подключения к PostgreSQL | `postgres://ediary:ediary@localhost:5432/ediary` |
| `DB_POOL_SIZE` | размер пула соединений | `10` |
| `PORT` | порт HTTP-сервера | `3000` |
| `XML_LOCAL_CACHE_DIR` | куда складывать скачанные с FTP XML | `./xml-cache` |
| `IMPORT_TIME_BUDGET_MS` | бюджет времени на одну итерацию импорта `events.xml` | `20000` |
| `IMPORT_API_TOKEN` | если задан — `/importxml` требует заголовок `x-import-token` | пусто (выкл) |
| `JWT_SECRET` | секрет подписи JWT | `dev-insecure-secret-change-me` (**сменить в проде**) |
| `FTP_HOST` / `FTP_PORT` | адрес FTP-источника 1С | `192.168.8.16` / `21` |
| `FTP_USER` / `FTP_PASSWORD` | учётка FTP | — |
| `FTP_SECURE` | FTPS (`true`/`false`) | `false` |
| `FTP_REMOTE_DIR` | рабочая папка на FTP | `/` |

### 3. Установка и схема БД

```bash
cd backend
npm install
npm run migrate
```

`npm run migrate` прогоняет [`migrations/001_init.sql`](migrations/001_init.sql) **один раз на чистой БД**.
Повторный запуск упадёт с «relation already exists» — системы версионирования миграций нет.
Пересоздать схему: `DROP DATABASE ediary` → `CREATE DATABASE ediary OWNER ediary` → `npm run migrate`.

Отдельные доработки схемы (для уже развёрнутой БД) — по имени файла:
`npm run migrate -- 002_widen_mark_values.sql`.

### 4. Проверка FTP (опционально)

```bash
npm.cmd run ftp:check     # список файлов в корне FTP
npm run ftp:peek      # печатает содержимое filelist.xml / book.xml / groups.xml / ...
```

В выводе `ftp:peek` убедитесь, что **`book.xml` и `groups.xml` непустые** (внутри есть
`<schoolyears>`, `<pupils>`, `<groups>` …). Если там только `<MessageNo>` — 1С отдала
частичное сообщение; `events`/`final_marks` не с чем будет связать. Нужна **полная
выгрузка** из 1С (в плане обмена «Обмен с электронным дневником» — повторная регистрация
всех объектов).

### 5. Запуск

```bash
npm run dev                  # авто-перезапуск (tsx watch)
# либо
npm run build && npm start   # прод-сборка в dist/
```

Проверка:

```bash
curl http://localhost:3000/api/health
# {"ok":true,"db":true,"counts":{...}}   — нули до импорта
```

### 6. Импорт данных из 1С

```bash
curl -X POST http://localhost:3000/importxml
```

Ответ — текстовый код:

| Код | Значение | Что делать |
|---|---|---|
| `CONTINUE` | `events.xml` не доехал за `IMPORT_TIME_BUDGET_MS` | **повторить тот же запрос**, пока не `DONE` |
| `DONE` | всё импортировано | готово |
| `ALREADY` | сообщение с этим `MessageNo` уже загружалось | ничего |
| `ERROR` | импорт прошёл, но были ошибки по строкам | смотреть `ediary_import_results.errors` |
| `NONE` | файл не найден / `MessageNo` в файле ≠ `filelist.xml` | проверить выгрузку 1С |

Прогнать до конца (bash):

```bash
while true; do
  r=$(curl -s -X POST http://localhost:3000/importxml); echo "$r"
  [ "$r" = "CONTINUE" ] || break
done
```

PowerShell:

```powershell
do { $r = (Invoke-WebRequest -Method POST http://localhost:3000/importxml).Content; $r }
while ($r -eq "CONTINUE")
```

### 7. Проверка результата

```bash
curl -s http://localhost:3000/api/health
```

```sql
SELECT file, success, fail, left(errors, 200) AS errors
FROM ediary_import_results ORDER BY updated_at DESC;

SELECT count(*) FROM ediary_pupils;
SELECT count(*) FROM ediary_groups;
SELECT count(*) FROM ediary_events;
```

### Повторный импорт того же MessageNo

`/importxml` защищён от дублей по `MessageNo`. Прогнать заново тот же номер:

```sql
DELETE FROM ediary_import_checkpoint WHERE messageno = '<номер>';
DELETE FROM ediary_import_results    WHERE messageno = '<номер>';
```

Штатный путь обновления — новая выгрузка из 1С с новым `MessageNo`.

### Полные выгрузки каждые 15 минут

При новом `MessageNo` XML читается и сравнивается с текущими данными PostgreSQL.
Существующие справочники, группы, уроки и итоговые события обновляются только при
отличии импортируемых полей; новые записи добавляются. Миграция БД не требуется:
сравнение работает и для ранее заполненной базы.

Оценки, комментарии, пропуски, состав и периоды группы сравниваются отдельно,
без учёта порядка XML-элементов. Неизменённые наборы сохраняют свои ID. Если набор
изменился, заменяется только этот набор у соответствующего объекта. Пустой набор
удаляет прежние дочерние записи. Учебные периоды сохраняют свои ID при обновлении;
смены и звонки заменяются для учебного года только при изменении их содержимого.
Пакеты уроков обрабатываются в транзакции с advisory-блокировкой от параллельного
импорта пакетов в ту же схему, без блокировок строк неизменённых уроков.

Счётчик `success` означает число успешно обработанных записей, включая неизменённые,
а не число SQL UPDATE. Служебный журнал обмена продолжает записываться для каждого
нового сообщения. Скачивание и чтение полной XML-выгрузки по-прежнему необходимы.

Проверка повторной выгрузки и изменения дочерних данных на PostgreSQL (PowerShell):

```powershell
npm run build
$env:RUN_IMPORT_DB_TESTS = '1'
node --test tests/*.test.mjs
```

Тест использует `IMPORT_TEST_DATABASE_URL` или `DATABASE_URL` из окружения / `.env`.
Он создаёт отдельную случайную схему `import_test_*` и удаляет её после проверки;
рабочие таблицы не меняются. Проверяются ID и версии строк PostgreSQL (`xmin`),
чтобы обнаружить даже UPDATE с прежними значениями. Без `RUN_IMPORT_DB_TESTS=1`
интеграционный тест пропускается.

---

## Фронтенд

```bash
cd ../dairy
npm install
npm start          # http://localhost:4200
```

CORS под `localhost:4200` уже настроен в [`src/server.ts`](src/server.ts).
Фронт ожидает API на `http://localhost:3000/api` (см. `dairy/src/environments/environment.ts`).

### Вход

Логины берутся из `book.xml` — секция `<pupils><pupil><users><user>`. Пароль хранится
как `plain:<пароль из выгрузки>`, вход по нему работает.

```sql
SELECT u.username, pa.type
FROM app_users u
JOIN ediary_pupils_accounts pa ON pa.uid = u.id
LIMIT 20;
```

- Аккаунт типа `pupil` / `parent` → роль `student` → доступ к `/diary` и `/schedule`.
- Аккаунт без привязки к ученику → роль `teacher` → `/diary` отдаёт 403 (так задумано).

Если в `book.xml` нет `<users>` — временная тестовая учётка:

```sql
WITH nu AS (
  INSERT INTO app_users(username, password_hash, status)
  VALUES ('test', 'plain:test', 1) RETURNING id
)
INSERT INTO ediary_pupils_accounts(pupil, type, uid)
SELECT (SELECT id FROM ediary_pupils ORDER BY id LIMIT 1), 'pupil', id FROM nu;
```

---

## HTTP API

### Обмен с 1С

| Метод | Путь | Описание |
|---|---|---|
| `POST` (любой) | `/importxml` | запустить/продолжить импорт. Если задан `IMPORT_API_TOKEN` — нужен заголовок `x-import-token` |

### Авторизация — `/api/auth`

| Метод | Путь | Тело / вход | Ответ |
|---|---|---|---|
| `POST` | `/api/auth/login` | `{ login, password }` | `{ accessToken, user: { id, login, role } }` + refresh-cookie |
| `POST` | `/api/auth/refresh` | refresh-cookie | `{ accessToken }` |
| `POST` | `/api/auth/logout` | — | `{ ok: true }` |

access-токен — короткоживущий (15 мин), передаётся как `Authorization: Bearer <token>`.
refresh-токен — httpOnly cookie, 7 дней.

### Данные — `/api`

| Метод | Путь | Параметры | Описание |
|---|---|---|---|
| `GET` | `/api/health` | — | живость + счётчики строк по таблицам |
| `GET` | `/api/me` | *(Bearer)* | профиль: роль, ученик, класс, четверти |
| `GET` | `/api/schoolyears` | — | учебные года |
| `GET` | `/api/subjects` | — | предметы |
| `GET` | `/api/teachers` | — | учителя |
| `GET` | `/api/groups` | `schoolyear?` | классы/группы |
| `GET` | `/api/events` | `group` (обяз.), `from?`, `to?` | занятия группы за период + вложенные `marks` / `comments` / `missings` (период по умолчанию — 30 дней, лимит 1000) |
| `GET` | `/api/final-marks` | `group?`, `pupil?` | итоговые события с оценками (нужен хотя бы один фильтр) |

---

## Структура

```
backend/
├── migrations/001_init.sql      схема БД (единый файл)
├── scripts/
│   ├── migrate.ts               прогон миграции
│   ├── seed.ts                  синтетические демо-данные (НЕ нужен при боевом импорте)
│   └── ftp*.ts                  диагностика FTP
├── src/
│   ├── server.ts                точка входа, express + CORS + роуты
│   ├── config.ts                чтение .env
│   ├── db/                      пул pg + Kysely, типы таблиц
│   ├── ftp/                     клиент FTP, скачивание/загрузка файлов сообщения
│   ├── xml/                     потоковый (saxes) и целиковый (fast-xml-parser) разбор
│   ├── import/                  импортёры book / groups / events / final_marks + чекпоинты
│   ├── auth/                    JWT (HS256 на node:crypto) + хэш паролей (scrypt)
│   ├── middleware/auth.ts       requireAuth, чтение cookie
│   └── routes/                  importxml, read (/api), auth (/api/auth)
└── xml-cache/                   локальный кэш скачанных с FTP XML (не в git)
```

### npm-скрипты

| Скрипт | Действие |
|---|---|
| `npm run dev` | запуск с авто-перезапуском (`tsx watch`) |
| `npm run build` | компиляция в `dist/` |
| `npm start` | запуск собранного `dist/server.js` |
| `npm run migrate` | создать схему БД |
| `npm run seed` | залить демо-данные (**делает `TRUNCATE` всех таблиц**; для разработки без FTP) |
| `npm run ftp:check` / `ftp:peek` / `ftp:inspect` | диагностика FTP-источника |

---

## Диагностика

| Симптом | Причина / решение |
|---|---|
| `/importxml` висит / `ECONNREFUSED` | нет доступа к FTP. `npm run ftp:check` |
| импорт `DONE`, но во фронте «Учётная запись не привязана к классу» | `book.xml` / `groups.xml` в выгрузке пустые → нет `ediary_pupils` / `ediary_groups_pupils`. Нужна полная выгрузка из 1С |
| `ediary_import_results` полон `fail` у events / final_marks | не импортированы справочники (`book`) или классы (`groups`) — та же причина |
| ошибки в `errors` по `book.xml` про `terms` / `calls` | секции «схемы аттестации» и «звонки» восстановлены по старому PHP без живого примера — прислать реальный `xml-cache/book.xml` для правки парсера |
| логин: 401 на все запросы | бэкенд не запущен, либо `environment.ts` во фронте не указывает на `http://localhost:3000/api` |
| после F5 выкидывает на логин | должно чиниться `refresh()` через cookie; проверить, что запросы идут с `withCredentials` и cookie `refreshToken` присутствует |
| `npm run migrate` → «already exists» | схема уже создана; пересоздавать только через `DROP` / `CREATE DATABASE` |
| импорт падает `значение не умещается в тип character varying(N)` | реальная выгрузка 1С не влезла в узкую колонку. Применить свежие миграции: `npm run migrate -- 002_widen_mark_values.sql` |

---

## Известные ограничения

- **Авторизация — демо-уровень.** Пароли из 1С хранятся как `plain:<пароль>`. Полноценный
  слой (хэширование, роли, срок жизни сессий) — отдельная задача. `JWT_SECRET` по умолчанию
  небезопасен.
- **Секции `terms` и `calls` в `book.xml`** реализованы по конфигу старого PHP-модуля без
  проверки на реальной выгрузке — структура тегов может отличаться.
- **`book` / `groups` / `final_marks`** импортируются за один проход (без чекпоинтов). Если
  реальные файлы окажутся очень большими — перевести на потоковый разбор, как `events`.
- **Нет системы версионирования миграций** — одна SQL-схема.
- `seed.ts` и `/importxml` пишут в одни таблицы; не смешивать (seed делает `TRUNCATE`).

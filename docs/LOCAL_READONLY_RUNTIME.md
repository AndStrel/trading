# Локальный read-only runtime

Цель — получать рыночные данные с компьютера, сохраняя единственный Telegram
poller на сервере. Это не real/sandbox исполнитель, не funding и не допуск
стратегии. Public HTTPS/404 подтверждает только сеть/TLS, не доступ токена к API.

## Приватная read-capsule: подготовка на хосте

`ops/prepare_local_read_capsule.mjs` выполняется **на хосте** с Node.js 22+.
Существующий Docker-образ содержит `dist`, но не новый `ops` helper; не пытайтесь
запускать этот helper внутри уже собранного образа.

Из отдельно существующего приватного `snapshot.json` helper переносит только
`{ "env": { "T_INVEST_TOKEN": "…" } }`. Live/sandbox/trading/Telegram токены,
account/chat ID, runtime state, TLS overrides и все остальные поля отбрасываются.
Снимок не изменяется. Файл результата всегда новый; overwrite запрещён.

```sh
rtk proxy node ops/prepare_local_read_capsule.mjs \
  --source /absolute/private/snapshot.json \
  --output /absolute/private/market-read-capsule.json
```

Оба пути должны быть абсолютными и нормализованными, без symlink в файле или
любом родительском каталоге. На macOS `/tmp` может быть symlink: используйте
проверенный `/private/tmp/...`, а не обходите проверку. Непосредственные родители
должны уже иметь `0700` и принадлежать текущему UID. Source — обычный файл
`0600` того же UID, максимум 64 KiB; output создаётся exclusively с `0600`.
Helper не исправляет широкие права или чужое владение автоматически.

Успех: `{"result":"prepared","brokerRequests":0,"brokerWrites":false}`.
Ошибка — fixed reason и exit 1, без токенов, путей или сырого исключения.
Не печатайте source/capsule и не добавляйте их в Git. Наличие поля с read-token
не доказывает его брокерские права или срок действия.

## Узкий контейнер: только market relay

Используйте проверенный immutable image ID актуального main с подтверждённой
OCI revision. Dockerfile default CMD запускает `dist/telegram-service.js`;
его обязательно заменить на `node dist/local-market-relay-service.js`.
Штатный `docker compose up telegram-service` для этого локального slice не подходит:
он загружает общий `.env` и запускает второй poller.

Требования к запуску:

- readonly rootfs, непривилегированный UID с доступом к приватным file mounts,
  `--cap-drop ALL`, `no-new-privileges`; для host-owned `0600` capsule используйте
  текущие UID:GID хоста, не полагайтесь на совпадение с image user `node`;
- только `127.0.0.1:13877:13877`, никакого публичного bind/host network;
- два отдельных read-only file mounts: отфильтрованная capsule как
  `/run/private/snapshot.json`, отдельный relay secret как `/run/private/relay-secret`;
  не монтировать полный исходный snapshot, `server.env` или весь private-каталог;
- relay secret — отдельный приватный файл, минимум 32 символа, не аргумент командной
  строки и не значение, выводимое в Docker/SSH logs;
- execution disabled; без Telegram/live/sandbox credentials, чужого журнала,
  market-data SQLite и production volumes;
- `/tmp` при необходимости — отдельный bounded tmpfs; TLS-проверка остаётся включённой.

Сертификаты, если требуются текущим образом, остаются внутри контейнера.
Не изменять macOS Keychain/глобальный CA store, не использовать `-k` или
`NODE_TLS_REJECT_UNAUTHORIZED=0`. Не копировать `server.env` ради удобства запуска.

Relay не открывает журнал. При отдельном запуске standalone
`dist/intraday-scanner.js` нужен **новый локальный journal/volume**, execution
disabled и только минимальный read-only credential input; Telegram token не нужен.
Сам standalone scanner не читает capsule автоматически: его минимальную
конфигурацию нужно подключать явно отдельным контролируемым launcher.

## Что реально проверяется

Relay допускает только `Shares`, `GetCandles`, `GetOrderBook`, `GetLastPrices`,
`GetTradingStatus`. Account reads, BUY/SELL/stop/cancel/funding через него запрещены.
Передача токена брокера в relay request запрещена; авторизация использует только
отдельный relay secret. Нет автоматического fallback между источниками.

После согласованного запуска проверяют точный image/revision, readonly/capabilities,
loopback port и безопасный ready event. Не читать `Config.Env` или сырые приватные
logs. Неавторизованный `/market-data`/`/egress` должен вернуть 401; один разрешённый
authenticated `Shares` read подтверждает только market API. Авторизацию передаёт
приватный helper, не `curl -H` с секретом в аргументах/истории shell.

Для доступа сервера к relay нужен отдельно проверенный приватный SSH/socket tunnel.
В существующем серверном коде допустим socket только `/run/relay/market.sock`,
secret path только `/run/relay/secret`, URL — authenticated loopback `/market-data`.
Свежую доступность «Компьютер» подтверждают перед явным выбором источника.

Выбор «Компьютер» меняет только scanner market data. `LivePilotPreflight` и
исполнительные проверки не переключаются на relay. Поэтому успешный relay не
исправляет серверный account-preflight.

## Отдельная разовая проверка read-only доступа

`ops/probe_local_readonly.mjs` — отдельный host-mounted helper, которого также
нет в существующем образе. Он использует проверенный `LivePreflightClient` из
`/app/dist`, но выполняет только два metadata read: `GetAccounts` и `GetInfo`.
При корректной capsule запросы запускаются по одному разу, без broker writes.
Timeout каждого fetch — 10 секунд; endpoint фиксированный production HTTPS.
Account/position/order IDs, имена, деньги, токены и сырые broker errors не выводятся.

После отдельного подтверждения image/revision и разрешения этих двух read-запросов
используйте **тот же отфильтрованный файл**, не исходный snapshot. Для probe его
destination другой: `/run/private/read-snapshot.json`. Capsule должна содержать
ровно `{env:{T_INVEST_TOKEN}}`, быть обычным `0600` файлом текущего container UID.
Пример с уже проверенным образом main `f1d56be84d2d8a4f7776cbd8d1b56ba6b0379e63`:

```sh
rtk proxy docker run --rm --read-only \
  --user "$(rtk proxy id -u):$(rtk proxy id -g)" \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount type=bind,src=/absolute/private/market-read-capsule.json,dst=/run/private/read-snapshot.json,readonly \
  --mount type=bind,src=/Users/Andrey/dev/trading-strategy-bot/ops/probe_local_readonly.mjs,dst=/run/tools/probe-local-readonly.mjs,readonly \
  --entrypoint node \
  sha256:fbe712472aaf232d1988f99de6b265e9bd979686ebcd7f2e44ab02f977272378 \
  /run/tools/probe-local-readonly.mjs
```

Не добавляйте `.env`, `--env-file`, Telegram/live/sandbox credentials, journal
volume или published port. Этот разовый контейнер не запускает relay, poller,
scanner или executor. Если используете другой образ, сначала подтвердите его
immutable ID и OCI revision; не подменяйте этот пример непроверенным tag.

`read-access-confirmed` означает только два успешных metadata read и наличие
однозначно найденных, открытых обычных счетов с пользовательскими именами
«Дневной»/«Недельный». Helper ничего не выбирает и не перенастраивает; он выводит
лишь `found/open/ordinary`, число счетов и безопасный enum тарифа.
Это не balance/positions/active-orders проверка и не production credential proof:
`liveCredentialVerified:false`, `liveSubmissionAllowed:false`, `brokerWrites:false`
остаются при любом результате. Полный `dist/pilot-preflight.js` требует отдельно
подготовленного role-specific live credential и остальных account/risk gates;
наличие sandbox token или работа read token этого не заменяет.

Offline-проверки обоих новых host helpers не требуют Docker, сети или приватных файлов:

```sh
rtk proxy node --test ops/test_prepare_local_read_capsule.mjs ops/test_probe_local_readonly.mjs
```

Реальные заявки не реализованы этим slice. Полный strategy sandbox цикл, точная
pre-BUY/post-flat cash/late-fee сверка, forward/executable evidence и прибыльность
остаются отдельными воротами. Их не заменяют capsule, TLS или успешный `Shares`.

## Фактическая локальная проверка 3 октября 2026

Accepted main: `f1d56be84d2d8a4f7776cbd8d1b56ba6b0379e63`. Собранный образ
`sha256:fbe712472aaf232d1988f99de6b265e9bd979686ebcd7f2e44ab02f977272378`
имеет эту OCI revision. Изолированные CA установлены только в образе.
Запущен отдельный market relay с read-only rootfs, host UID:GID, двумя отдельными
read-only file mounts и единственным bind `127.0.0.1:13877`. Последняя проверка:
running, restartCount=0; Telegram poller, журнал и исполнитель не запускаются.

Authenticated `Shares` read успешен: 1 916 инструментов, `SBER/TQBR` присутствует.
Неавторизованный запрос отклонён с 401; account method через relay — с 400.
Отдельный ephemeral metadata probe успешно прочитал `GetAccounts` и `GetInfo`;
проверка заданных оператором профилей успешна. Персональные broker metadata
в Git не сохраняются. Только эти read-запросы: `brokerWrites:false`,
`liveCredentialVerified:false`, `liveSubmissionAllowed:false`.

Это не сверка configured account IDs, cash, позиций, активных заявок, полномочий
отдельного live credential или экономики стратегии. После metadata probe
восстановлен существующий приватный SSH/socket channel. Точный старый сокет
нашего проекта проверен: listener отсутствовал, подключение не работало; он
перемещён в том же приватном каталоге в `market.sock.stale-20261003-local-recovery`
и остаётся восстановимым. Секреты не менялись: проверено только их совпадение.
Новый socket — root:node `0660`, private directory `0750`, secret `0640`,
readonly mount существующего контейнера. Публичный TCP-порт не открывался.

Из существующего серверного контейнера повторно подтверждены 401/400 guards
и authenticated `Shares` с 1 916 инструментами. Операторский smoke `/api/view`
показал `computer.configured:true`, `available:true`, `busy:false`; это не
подтверждение входа с настоящего Telegram-устройства. Через разрешённое source
действие выбран «Компьютер» при `executionMode:disabled`, `kill:true`; прежний
scanner report сброшен. Счета/лимиты/исполнитель, `.env` и серверный процесс
не менялись. Свежий scan ждёт штатного торгового окна; расписание не обходится.
Серверный account-preflight остаётся независимым и не проходит автоматически
благодаря этому каналу или metadata probe. В этой принятой версии выбор ещё
хранился только в памяти: после рестарта source снова становился «Сервер».

Новые helpers проверены 23 offline-тестами. Общий `check` на локальной ветке
до интеграции нового cash-flow slice: 1 326 тестов приложения плюс 23 helper-теста,
typecheck и build — PASS. Это локальная валидация; не CI/review нового head и не
доказательство торговли или прибыли.

## Сохранение выбранного источника — следующий safety slice

Новая локальная версия сохраняет только одну из канонических записей
`{"version":1,"selected":"server"}` или `{"version":1,"selected":"computer"}`
в отдельном runtime-state key `market.source.selection.v1`.
Ни credentials, ни account identity, ни health/location/lease не сохраняются.
При рестарте предпочтение «Компьютер» сохраняется, даже если transport сейчас
не настроен/не работает. Неявного переключения на «Сервер» нет; отсутствие
настройки отказано, настроенный offline transport только пытается выбранный
канал и безопасно завершает read ошибкой. Health после рестарта неизвестен
и проверяется заново; выбор через панель по-прежнему требует свежего успешного
probe и отсутствия активного scan lease.

Запись сохраняется до изменения in-memory selection и сброса scanner report.
Ошибка сохранения оставляет прежний выбор/report; ошибка чтения или невалидные
persisted bytes дают фиксированную redacted startup error. Существующий fetch
контракт не получил нового глобального freshness gate. Missing preference
сохраняет прежний default «Сервер» до явного выбора оператора.

Локальная проверка: 1 684 TS tests / 82 files, 23 ops-local tests, typecheck/build
PASS; независимый review трёх файлов без P1/P2. Compiled Node24 container smoke
с network none/read-only root/синтетическим SQLite подтвердил restart,
health-not-restored, save failure и отсутствие fallback; реальных broker
reads/orders и production volumes в этом smoke нет. Это draft overlay,
не фактическое доказательство production restart этой версии.

# Автоматический deploy Telegram-сервиса

Для первого локального или серверного запуска используйте [QUICKSTART](QUICKSTART.md):
`npm run setup`, заполнение `.env`, `npm run doctor`, `npm run deploy`.
Ни одна из этих команд не устанавливает домен/сертификат и не изменяет другие проекты.

Локальный `npm run deploy` выполняет ту же защитную последовательность:
сборка `telegram-service` → `strategy-config-preflight` в новом образе →
`up -d --no-build telegram-service`. При ошибке сборки или конфигурации
работающий контейнер не заменяется. Preflight не обращается к брокеру и журналу;
`doctor` использует эту же проверку перед дополнительной диагностикой профиля.

Workflow **Deploy Telegram service** запускается после каждого push в `main` —
то есть после merge PR. Ручной запуск сохранён для повторного deploy или отката.
Он не получает T-Invest или Telegram токены из GitHub и не перезаписывает
серверный `.env`.

## Что делает workflow

1. Проверяет обязательные GitHub Secrets и Variables.
2. Подключается к серверу только по значениям `DEPLOY_HOST` и `DEPLOY_USER`, SSH-ключу и проверенному `known_hosts` из GitHub Secrets.
3. Клонирует или обновляет проект в `/opt/andstrel/trading` и закрепляет точный SHA события, а не подвижный `origin/main`.
4. Останавливается, если `/opt/andstrel/trading/.env` отсутствует.
5. Собирает новый образ с immutable OCI revision label, не останавливая работающий сервис.
6. Проверяет существующий приватный `.env` командой `strategy-config-preflight`: без запросов брокеру, открытия журнала и печати секретов. Для режима `watchlist` нужны непустой список и биржевые тикеры в `label`; невалидная конфигурация останавливает deploy до замены контейнера.
7. Только после успешной проверки заменяет контейнер. Mini App публикуется на `127.0.0.1:8088`, внешний доступ требует HTTPS reverse proxy.
8. Выполняет read-only проверку работающего сервиса: контейнер и привязка его образа к ожидаемому SHA, приватный журнал, режим исполнения, выбранные публичные тикеры и HTTP-панель. Проверка приватного API без авторизации должна вернуть 401. Не изменяет `.env`, счета или заявки.

Он не обращается к другим каталогам и сервисам на сервере.

## Сертификаты T-Invest в образе

Обычная production-сборка, выполняемая `npm run deploy`, устанавливает
официальную цепочку CA Минцифры в контейнер и сохраняет проверку TLS. В CI эта
операция намеренно отключена: проверка контейнера рендерит локальную PNG-карточку
с сетью `none` и не обращается к T-Invest. Это не ослабляет production-образ и
устраняет зависимость CI от доступности внешнего сайта сертификатов.

## Один раз на сервере

Перед первым deploy подготовьте серверный `.env` в `/opt/andstrel/trading/.env`. В нём должны быть:

```dotenv
T_INVEST_TOKEN=отдельный-read-only-токен
T_INVEST_TRANSPORT=system-curl
T_INVEST_JOURNAL_PATH=/app/data/journal.sqlite
T_INVEST_INTRADAY_UNIVERSE=moex-liquid
T_INVEST_SCANNER_UNIVERSE_REFRESH_MINUTES=1440
T_INVEST_SCANNER_MAX_INSTRUMENTS=30
T_INVEST_SCANNER_MAX_CONCURRENT_REQUESTS=2
T_INVEST_SCANNER_MIN_AVERAGE_CANDLE_TURNOVER_RUB=1000000
T_INVEST_SCANNER_MAX_CANDIDATES_PER_SCAN=3
T_INVEST_SCANNER_INTERVAL_SECONDS=300
T_INVEST_SCANNER_LOOKBACK_MINUTES=360
T_INVEST_SCANNER_CANDIDATE_COOLDOWN_MINUTES=30
T_INVEST_SCANNER_SLIPPAGE_RATE=0.0005
T_INVEST_COMMISSION_RATE=0.003
T_INVEST_EXECUTION_MODE=disabled
INTRADAY_MAX_RISK_RUB=500
INTRADAY_MAX_POSITION_RUB=50000
INTRADAY_MAX_SPREAD_PCT=0.3
INTRADAY_MAX_ENTRY_DEVIATION_PCT=0.5
INTRADAY_ALLOW_SHORT=false
TELEGRAM_BOT_TOKEN=токен-бота
TELEGRAM_ALLOWED_CHAT_IDS=ваш-chat-id
TELEGRAM_POLLING_TIMEOUT_SECONDS=25
```

У файла должны быть права `600`. Не кладите его в Git, GitHub Secrets или workflow logs.
Полный актуальный список полей находится в `.env.example`. При включённом дневном
prepare-профиле фактическая комиссия не ниже `0.003` на сторону; уменьшение значения
в старом `.env` не отменяет этого ограничения.

## Запуск

Перед первым запуском создайте GitHub Environment `production` и настройте для него
deployment branch policy только на `main`. Перенесите в этот Environment Secrets
`TRADING_DEPLOY_SSH_KEY` и `TRADING_DEPLOY_KNOWN_HOSTS`, затем удалите их копии из
repository-level Secrets. Это важно: ручной workflow читает YAML из выбранной ветки,
поэтому одной проверки `github.ref` внутри изменяемого workflow недостаточно. Все три
workflow с SSH-доступом, включая `Deploy`, `Bootstrap`, `Replay` и read-only проверки, привязаны к Environment
`production`; при необходимости добавьте required reviewer.

После merge PR в `main` deploy запускается сам. Его статус виден в GitHub →
**Actions** → **Deploy Telegram service**.

Для повторного deploy или отката: GitHub → **Actions** → **Deploy Telegram
service** → **Run workflow**. Выбирайте только `main`.

После первого deploy подтвердите в GitHub log, что сервис запущен, затем проверьте:

- перед заменой контейнера: `configReady: true`, `liveSubmissionAllowed: false`;
- при запуске: событие `trading-selection-loaded` с выбранным алгоритмом, ревизией и публичными тикерами;
- в Telegram: `/start`, потом `/status`;
- на сервере: TLS-проверка T-Invest из контейнера возвращает `HTTP 404`;
- в логах нет `Telegram polling failed`.

Успех сборки, `compose up` и мгновенно прочитанный пустой лог ещё не подтверждают здоровый процесс. Итоговый read-only отчёт отдельно показывает состояние сервиса и локальной HTTP-панели, внешнюю HTTPS-доступность и диагностику одноразовой проверки candidate-конфигурации. В нём нет токенов, account ID, содержимого env или сырого stderr. Отказ дополнительной candidate-проверки не выдаётся за доказательство готовности к торговле.

Для повторной проверки без перезапуска используйте GitHub → **Actions** → **Verify strategy service read-only** → **Run workflow**, только `main`. Работающий checkout должен уже совпадать с SHA выбранного `main`; workflow не обновляет файлы и не исправляет конфигурацию. Локальный отказ соединения проверяйте отдельно от исправности сервиса на VPS.

## Одноразовый импорт исторических данных

Для первичной загрузки 2025 года используется отдельный workflow **Bootstrap 2025 historical data**. Он запускается после изменений, относящихся к архивному импортеру, либо вручную; использует те же ограниченные deploy Secrets и не получает токен T-Invest из GitHub. Он ждёт тот же concurrency-lock, что и deploy, проверяет минимум 4 GiB свободного места и выполняет импорт `liquid-20` в существующий Docker volume. Подробности и точный список бумаг: [исторические данные](HISTORICAL_DATA.md).

## Одноразовый replay 2025

После успешного импорта архива отдельный workflow **Replay 2025 historical data** запускается вручную из GitHub Actions. Он сам синхронизирует и собирает текущий `main` на VPS, затем запускает `backtest:replay -- --year 2025` внутри того же Docker volume. Job остановится, если хотя бы один архив liquid-20 отсутствует — частичный результат не будет выдан за результат всей вселенной.

Полный JSON-отчёт остаётся на сервере в Docker volume: `/app/data/backtests/replay-2025-liquid-20.json`; Actions log показывает только компактную сводку фаз и не содержит токенов. Модель затрат и границы результата описаны в [документе backtest](BACKTEST.md).

Для контролируемого сравнения целей используйте ручной workflow **Replay target sweep 2025**. Оставьте значение по умолчанию `0.75,1,1.25,1.5,2,2.5`, если не согласована отдельная гипотеза. Он запускает одинаковый replay для каждого множителя и публикует полный JSON-артефакт; победитель выбирается только по development, затем один раз проверяется на validation, а OOS не используется для подбора.

## Откат

Откат — это повторный ручной запуск workflow после revert в `main`. `.env` и Docker volume с журналом при этом сохраняются. До отката запретите новые входы и проверьте незавершённые позиции: старая версия сопровождения может не поддерживать новый выбранный актив, которого нет в её watchlist. До подтверждённого закрытия сохраняйте новый защитный модуль. Подробности — [план обновления](BOT_REFRESH_PLAN.md).

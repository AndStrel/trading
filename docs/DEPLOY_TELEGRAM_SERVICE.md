# Автоматический deploy Telegram-сервиса

Workflow **Deploy Telegram service** запускается после каждого push в `main` —
то есть после merge PR. Ручной запуск сохранён для повторного deploy или отката.
Он не получает T-Invest или Telegram токены из GitHub и не перезаписывает
серверный `.env`.

## Что делает workflow

1. Проверяет обязательные GitHub Secrets и Variables.
2. Подключается к серверу только по значениям `DEPLOY_HOST` и `DEPLOY_USER`, SSH-ключу и проверенному `known_hosts` из GitHub Secrets.
3. Клонирует или обновляет проект в `/opt/andstrel/trading`.
4. Останавливается, если `/opt/andstrel/trading/.env` отсутствует.
5. Собирает и запускает `docker compose`, не открывая порты.

Он не обращается к другим каталогам и сервисам на сервере.

## Сертификаты T-Invest в образе

Обычная production-сборка через `docker compose up -d --build` устанавливает
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
T_INVEST_COMMISSION_RATE=0.0005
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

## Запуск

После merge PR в `main` deploy запускается сам. Его статус виден в GitHub →
**Actions** → **Deploy Telegram service**.

Для повторного deploy или отката: GitHub → **Actions** → **Deploy Telegram
service** → **Run workflow**. Выбирайте только `main`.

После первого deploy подтвердите в GitHub log, что сервис запущен, затем проверьте:

- в Telegram: `/start`, потом `/status`;
- на сервере: TLS-проверка T-Invest из контейнера возвращает `HTTP 404`;
- в логах нет `Telegram polling failed`.

## Одноразовый импорт исторических данных

Для первичной загрузки 2025 года используется отдельный workflow **Bootstrap 2025 historical data**. Он запускается только при изменении собственного workflow-файла в `main`, использует те же ограниченные deploy Secrets и не получает токен T-Invest из GitHub. Он ждёт тот же concurrency-lock, что и deploy, проверяет минимум 4 GiB свободного места и выполняет импорт `liquid-20` в существующий Docker volume. Подробности и точный список бумаг: [исторические данные](HISTORICAL_DATA.md).

## Одноразовый replay 2025

После импорта архива отдельный workflow **Replay 2025 historical data** запускается один раз при добавлении/изменении собственного YAML-файла в `main`. Он сам синхронизирует и собирает текущий `main` на VPS, затем запускает `backtest:replay -- --year 2025` внутри того же Docker volume. Job остановится, если хотя бы один архив liquid-20 отсутствует — частичный результат не будет выдан за результат всей вселенной.

Полный JSON-отчёт остаётся на сервере в Docker volume: `/app/data/backtests/replay-2025-liquid-20.json`; Actions log показывает только компактную сводку фаз и не содержит токенов. Модель затрат и границы результата описаны в [документе backtest](BACKTEST.md).

## Откат

Откат — это повторный ручной запуск workflow после revert в `main`. `.env` и Docker volume с журналом при этом сохраняются.

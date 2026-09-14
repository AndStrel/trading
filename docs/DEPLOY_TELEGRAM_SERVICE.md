# Ручной deploy Telegram-сервиса

Workflow **Deploy Telegram service** запускается только вручную из ветки `main`. Он не получает T-Invest или Telegram токены из GitHub и не перезаписывает серверный `.env`.

## Что делает workflow

1. Проверяет обязательные GitHub Secrets и Variables.
2. Подключается к `root@151.241.228.136` только по SSH-ключу и проверенному `known_hosts`.
3. Клонирует или обновляет проект в `/opt/andstrel/trading`.
4. Останавливается, если `/opt/andstrel/trading/.env` отсутствует.
5. Собирает и запускает `docker compose`, не открывая порты.

Он не обращается к другим каталогам и сервисам на сервере.

## Один раз на сервере

Перед первым deploy подготовьте серверный `.env` в `/opt/andstrel/trading/.env`. В нём должны быть:

```dotenv
T_INVEST_TOKEN=отдельный-read-only-токен
T_INVEST_TRANSPORT=system-curl
T_INVEST_JOURNAL_PATH=/app/data/journal.sqlite
T_INVEST_INTRADAY_WATCHLIST='[{"instrumentId":"e6123145-9665-43e0-8413-cd61b8aa9b13","label":"SBER","lotSize":1,"priceStep":0.01}]'
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

GitHub → **Actions** → **Deploy Telegram service** → **Run workflow**. Выбирайте только `main`.

После первого deploy подтвердите в GitHub log, что сервис запущен, затем проверьте:

- в Telegram: `/start`, потом `/status`;
- на сервере: TLS-проверка T-Invest из контейнера возвращает `HTTP 404`;
- в логах нет `Telegram polling failed`.

## Откат

Откат — это повторный ручной запуск workflow после revert в `main`. `.env` и Docker volume с журналом при этом сохраняются.

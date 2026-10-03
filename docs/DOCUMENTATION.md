# Указатель документации

Начинайте с [README](../README.md) и [QUICKSTART](QUICKSTART.md). Текущий план изменений с отметками выполнения — [BOT_REFRESH_PLAN](BOT_REFRESH_PLAN.md). Канонический список переменных находится в [`.env.example`](../.env.example), валидатор конфигурации — в [`src/config.ts`](../src/config.ts).

## Рабочий бот и эксплуатация

| Документ | Область |
|---|---|
| [QUICKSTART](QUICKSTART.md) | Минимальная настройка, Docker, управление, диагностика |
| [STRATEGIES](STRATEGIES.md) | Выбор подхода, правила сигналов и рекомендаций, источники |
| [TELEGRAM_SERVICE](TELEGRAM_SERVICE.md) | Команды и работа Telegram-сервиса; подробности sandbox |
| [TELEGRAM_MINI_APP](TELEGRAM_MINI_APP.md) | Панель, авторизация, HTTPS, nginx и откат |
| [DEPLOY_TELEGRAM_SERVICE](DEPLOY_TELEGRAM_SERVICE.md) | Автоматизация production deploy и сохранность конфигурации |
| [MARKET_SOURCE_SWITCH](MARKET_SOURCE_SWITCH.md) | Доступность и переключение источника рыночных данных |
| [INTRADAY_SCANNER](INTRADAY_SCANNER.md) | Сканер, источники свечей и системный сервис |
| [SANDBOX_EXECUTION](SANDBOX_EXECUTION.md) | Состояния заявок, подготовка счёта и защитные ограничения |
| [SANDBOX_VTBR_ACCEPTANCE](SANDBOX_VTBR_ACCEPTANCE.md) | Техническое доказательство sandbox-цикла и известные ограничения |
| [ARCHITECTURE](ARCHITECTURE.md) | Модули и границы полномочий |
| [SECURITY](SECURITY.md) | Секреты, токены, транспорт и TLS |

Для запуска актуальные команды берутся из QUICKSTART. Старые примеры в подробных документах отражают контекст конкретных этапов; наличие поля или инструкции не означает, что функция проверена в production.

## Исторические исследования

| Документ | Область |
|---|---|
| [HISTORICAL_DATA](HISTORICAL_DATA.md) | Импорт и provenance минутных архивов |
| [RESEARCH_DATASET](RESEARCH_DATASET.md) | Полнота и область исследовательских наборов |
| [BACKTEST](BACKTEST.md) | Исторический replay, затраты, development/validation/OOS |
| [RESEARCH_ORB_RVOL_V1](RESEARCH_ORB_RVOL_V1.md) | Зафиксированная историческая гипотеза и ворота допуска |
| [ROADMAP](ROADMAP.md) | Историческая последовательность развития; актуальный план — BOT_REFRESH_PLAN |

Эти документы сохраняют воспроизводимость прошлых попыток. Исследовательский результат и техническая sandbox-проверка не подтверждают будущую доходность. Отсутствующие bid/ask или свечи должны оставаться отмеченными пропусками.

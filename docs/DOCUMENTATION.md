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
| [LIVE_PILOT_READBACK](LIVE_PILOT_READBACK.md) | Read-only проверка дневного счёта и рабочий путь `/execution_arm LIVE` + `/approve` |
| [MARKET_SOURCE_SWITCH](MARKET_SOURCE_SWITCH.md) | Доступность и переключение источника рыночных данных |
| [LOCAL_READONLY_RUNTIME](LOCAL_READONLY_RUNTIME.md) | Изолированный локальный контейнер, минимальный read-token и границы подтверждённого доступа |
| [INTRADAY_SCANNER](INTRADAY_SCANNER.md) | Сканер, источники свечей и системный сервис |
| [SANDBOX_EXECUTION](SANDBOX_EXECUTION.md) | Состояния заявок, подготовка счёта и защитные ограничения |
| [SANDBOX_CASH_EVIDENCE](SANDBOX_CASH_EVIDENCE.md) | Immutable pre-BUY baseline, точный cash/operations proof и отличие от полного исполнения |
| [SANDBOX_TARGET_EXIT](SANDBOX_TARGET_EXIT.md) | Opt-in цель, поколения native stop, безопасный rearm и архив расходов |
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
| [CATALOG_PARITY_REPLAY_V1](CATALOG_PARITY_REPLAY_V1.md) | Заранее фиксируем воспроизведение нового каталога; read-only источник, лотность и расходы |
| [CATALOG_ALL_STRATEGIES_SCREEN_V1](CATALOG_ALL_STRATEGIES_SCREEN_V1.md) | Все три текущие стратегии: 18 независимых заранее объявленных сценариев, без перенастройки и live-допуска |
| [FROZEN_MOEX_MINUTE_CAPTURE](FROZEN_MOEX_MINUTE_CAPTURE.md) | Отдельная bounded минутная выгрузка публичного MOEX без изменения старой базы |
| [RESEARCH_ORB_RVOL_V1](RESEARCH_ORB_RVOL_V1.md) | Зафиксированная историческая гипотеза и ворота допуска |
| [ROADMAP](ROADMAP.md) | Историческая последовательность развития; актуальный план — BOT_REFRESH_PLAN |
| [STRUCTURAL_FLOW_V1](STRUCTURAL_FLOW_V1.md) | Три заранее зафиксированных календарных потока SBMX против SBMM; не допуск к заявкам |
| [STRUCTURAL_FLOW_V1_RESULTS](STRUCTURAL_FLOW_V1_RESULTS.md) | Оба кандидата раунда отвергнуты; экспирация не обгоняет издержки |
| [SCALP_TRADER_V1](SCALP_TRADER_V1.md) | Три скальпа при тарифе Трейдер до абонентской платы; много сделок в день |
| [SCALP_TRADER_V1_RESULTS](SCALP_TRADER_V1_RESULTS.md) | Все три отвергнуты: частота есть, net после тарифа Трейдер отрицательный |
| [SCALP_TRADER_V2](SCALP_TRADER_V2.md) | Часовой знак и отставание SBER от GAZP при тарифе Трейдер, выход только по времени |
| [SCALP_TRADER_V2_RESULTS](SCALP_TRADER_V2_RESULTS.md) | Три правила v2 отвергнуты: средний gross до расходов около нуля |
| [SCALP_TRADER_V3](SCALP_TRADER_V3.md) | Перенос трёх скальпов на архив T внутри 10:00–17:00, те же пороги |
| [SCALP_TRADER_V3_RESULTS](SCALP_TRADER_V3_RESULTS.md) | Перенос на T отвергнут: средний net снова около круга тарифа |
| [TGLD_OPENING_DRIVE_SCALP_V1](TGLD_OPENING_DRIVE_SCALP_V1.md) | Новый скальп TGLD 2025: повторные входы, пока утренний ход жив |
| [TGLD_OPENING_DRIVE_SCALP_V1_RESULTS](TGLD_OPENING_DRIVE_SCALP_V1_RESULTS.md) | Утренний ход TGLD не допущен: 4,5% net-побед |
| [SCALP_TRADER_SEARCH_CLOSE](SCALP_TRADER_SEARCH_CLOSE.md) | Десять скальпов при тарифе Трейдер закрыты: трёх допусков нет |
| [SESSION_SPLIT_TRADER_V1](SESSION_SPLIT_TRADER_V1.md) | Ночь, дневная сессия и удержание пять сессий при тарифе Трейдер |
| [SESSION_SPLIT_TRADER_V1_RESULTS](SESSION_SPLIT_TRADER_V1_RESULTS.md) | Ночь и сессия в минусе; пять сессий не подтверждаются на трёх именах |
| [CANDLE_PATTERN_2024_2025_V1](CANDLE_PATTERN_2024_2025_V1.md) | Тройки знаков свечей: поиск на 2024, проверка на 2025 |
| [CANDLE_PATTERN_2024_2025_V1_RESULTS](CANDLE_PATTERN_2024_2025_V1_RESULTS.md) | Ни одна тройка знаков не повторилась в плюсе на трёх именах |
| [CANDLE_RANGE_2024_2025_V1](CANDLE_RANGE_2024_2025_V1.md) | Положение закрытия в диапазоне дня: поиск на 2024, проверка на 2025 |
| [CANDLE_RANGE_2024_2025_V1_RESULTS](CANDLE_RANGE_2024_2025_V1_RESULTS.md) | Ни одна группа диапазона не прошла совместный отбор 2024 |
| [CANDLE_INSIDE_2024_2025_V1](CANDLE_INSIDE_2024_2025_V1.md) | Внутренняя и внешняя свеча: поиск на 2024, проверка на 2025 |
| [CANDLE_INSIDE_2024_2025_V1_RESULTS](CANDLE_INSIDE_2024_2025_V1_RESULTS.md) | Ни внутренняя, ни внешняя свеча не прошла совместный отбор 2024 |
| [CANDLE_GAP_2024_2025_V1](CANDLE_GAP_2024_2025_V1.md) | Разрыв открытия: поиск на 2024, проверка на 2025 |
| [CANDLE_GAP_2024_2025_V1_RESULTS](CANDLE_GAP_2024_2025_V1_RESULTS.md) | Ни одна группа разрыва не прошла совместный отбор 2024 |
| [CANDLE_CONTEXT_2024_2025_V1](CANDLE_CONTEXT_2024_2025_V1.md) | Объём против своей медианы и согласие двух других бумаг |
| [CANDLE_CONTEXT_2024_2025_V1_RESULTS](CANDLE_CONTEXT_2024_2025_V1_RESULTS.md) | Ни объём, ни согласие бумаг не прошли совместный отбор 2024 |
| [CANDLE_WEEK_2024_2025_V1](CANDLE_WEEK_2024_2025_V1.md) | Знак предыдущей недельной свечи: поиск на 2024, проверка на 2025 |
| [CANDLE_WEEK_2024_2025_V1_RESULTS](CANDLE_WEEK_2024_2025_V1_RESULTS.md) | Ни растущая, ни падающая неделя не прошла совместный отбор 2024 |
| [CANDLE_MONTH_2024_2025_V1](CANDLE_MONTH_2024_2025_V1.md) | Месячный лидер и аутсайдер SBER, GAZP и SBMX |
| [CANDLE_MONTH_2024_2025_V1_RESULTS](CANDLE_MONTH_2024_2025_V1_RESULTS.md) | Аутсайдер прошёл 2024 и не подтвердился в 2025 |
| [CANDLE_AFTERNOON_2024_2025_V1](CANDLE_AFTERNOON_2024_2025_V1.md) | Знак утра и сделка со второй половины дня |
| [CANDLE_AFTERNOON_2024_2025_V1_RESULTS](CANDLE_AFTERNOON_2024_2025_V1_RESULTS.md) | Ни продолжение, ни отскок утра не прошли отбор 2024 |
| [CANDLE_MONDAY_2024_2025_V1](CANDLE_MONDAY_2024_2025_V1.md) | Знак понедельника и остаток той же недели |
| [CANDLE_MONDAY_2024_2025_V1_RESULTS](CANDLE_MONDAY_2024_2025_V1_RESULTS.md) | Ни растущий, ни падающий понедельник не прошёл совместный отбор 2024 |
| [CANDLE_OWN_MONTH_2024_2025_V1](CANDLE_OWN_MONTH_2024_2025_V1.md) | Свой прошлый месяц: продолжение или разворот той же бумаги |
| [CANDLE_OWN_MONTH_2024_2025_V1_RESULTS](CANDLE_OWN_MONTH_2024_2025_V1_RESULTS.md) | Ни продолжение, ни разворот своего месяца не прошли на всех трёх бумагах |
| [CANDLE_WEEKEND_GAP_2024_2025_V1](CANDLE_WEEKEND_GAP_2024_2025_V1.md) | Разрыв от закрытия прошлой недели к открытию понедельника |
| [CANDLE_WEEKEND_GAP_2024_2025_V1_RESULTS](CANDLE_WEEKEND_GAP_2024_2025_V1_RESULTS.md) | Ни разрыв вверх, ни разрыв вниз не прошёл совместный отбор 2024 |
| [CANDLE_CROSS_MONTH_2024_2025_V1](CANDLE_CROSS_MONTH_2024_2025_V1.md) | Месяц TGLD или SBGB как сигнал для следующего месяца SBMX |
| [CANDLE_CROSS_MONTH_2024_2025_V1_RESULTS](CANDLE_CROSS_MONTH_2024_2025_V1_RESULTS.md) | Ни золото, ни облигации не прошли отбор 2024 без лучшей сделки |
| [CANDLE_BLOCK_2024_2025_V1](CANDLE_BLOCK_2024_2025_V1.md) | Знак предыдущих пяти сессий IMOEX или SBMX и следующие пять сессий |
| [CANDLE_BLOCK_2024_2025_V1_RESULTS](CANDLE_BLOCK_2024_2025_V1_RESULTS.md) | Ни рост, ни падение пяти сессий не прошли отбор 2024 |
| [CANDLE_CLOSE_HOUR_2024_2025_V1](CANDLE_CLOSE_HOUR_2024_2025_V1.md) | Знак последнего часа и сделка на следующий день |
| [CANDLE_CLOSE_HOUR_2024_2025_V1_RESULTS](CANDLE_CLOSE_HOUR_2024_2025_V1_RESULTS.md) | Ни рост, ни падение последнего часа не прошли отбор 2024 |
| [CANDLE_WICK_2024_2025_V1](CANDLE_WICK_2024_2025_V1.md) | Длинная нижняя или верхняя тень и следующий день |
| [CANDLE_WICK_2024_2025_V1_RESULTS](CANDLE_WICK_2024_2025_V1_RESULTS.md) | Ни нижняя, ни верхняя тень не прошла совместный отбор 2024 |
| [CANDLE_LEAD_2024_2025_V1](CANDLE_LEAD_2024_2025_V1.md) | Кто из SBER и GAZP сильнее за день, и следующие пять сессий SBMX |
| [CANDLE_LEAD_2024_2025_V1_RESULTS](CANDLE_LEAD_2024_2025_V1_RESULTS.md) | Лидерство SBER не проходит без лучшей сделки, лидерство GAZP в минусе |
| [CANDLE_WIDTH_2024_2025_V1](CANDLE_WIDTH_2024_2025_V1.md) | Ширина дня против медианы 20 сессий и следующие пять сессий |
| [CANDLE_WIDTH_2024_2025_V1_RESULTS](CANDLE_WIDTH_2024_2025_V1_RESULTS.md) | Узкий день в плюсе только у SBER, широкая группа в минусе |
| [CANDLE_OPEN15_2024_2025_V1](CANDLE_OPEN15_2024_2025_V1.md) | Знак первых 15 минут и остаток дня до 17:00 |
| [CANDLE_OPEN15_2024_2025_V1_RESULTS](CANDLE_OPEN15_2024_2025_V1_RESULTS.md) | Ни рост, ни падение первых 15 минут не прошли отбор 2024 |
| [CANDLE_WEEK_RANGE_2024_2025_V1](CANDLE_WEEK_RANGE_2024_2025_V1.md) | Где закрылась прошлая неделя в своём диапазоне |
| [CANDLE_WEEK_RANGE_2024_2025_V1_RESULTS](CANDLE_WEEK_RANGE_2024_2025_V1_RESULTS.md) | Ни одна треть недельного диапазона не прошла совместный отбор 2024 |
| [CANDLE_MONTH_OPEN_2024_2025_V1](CANDLE_MONTH_OPEN_2024_2025_V1.md) | Первые пять сессий месяца против остатка того же месяца |
| [CANDLE_MONTH_OPEN_2024_2025_V1_RESULTS](CANDLE_MONTH_OPEN_2024_2025_V1_RESULTS.md) | Ни рост, ни падение первых пяти сессий не прошли совместный отбор 2024 |
| [CANDLE_MONTH_RANGE_2024_2025_V1](CANDLE_MONTH_RANGE_2024_2025_V1.md) | Где закрылся прошлый месяц в своём диапазоне |
| [CANDLE_MONTH_RANGE_2024_2025_V1_RESULTS](CANDLE_MONTH_RANGE_2024_2025_V1_RESULTS.md) | Ни одна треть месячного диапазона не прошла совместный отбор 2024 |
| [CANDLE_FORTNIGHT_2024_2025_V1](CANDLE_FORTNIGHT_2024_2025_V1.md) | Знак двухнедельной свечи и следующая такая же свеча |
| [CANDLE_FORTNIGHT_2024_2025_V1_RESULTS](CANDLE_FORTNIGHT_2024_2025_V1_RESULTS.md) | Ни рост, ни падение двух недель не прошли совместный отбор 2024 |
| [CANDLE_MONTH_END_2024_2025_V1](CANDLE_MONTH_END_2024_2025_V1.md) | Последние пять сессий месяца и весь следующий месяц |
| [CANDLE_MONTH_END_2024_2025_V1_RESULTS](CANDLE_MONTH_END_2024_2025_V1_RESULTS.md) | Ни рост, ни падение хвоста месяца не прошли совместный отбор 2024 |
| [CANDLE_MONTH_GAP_2024_2025_V1](CANDLE_MONTH_GAP_2024_2025_V1.md) | Открытие месяца выше, внутри или ниже прошлого диапазона |
| [CANDLE_MONTH_GAP_2024_2025_V1_RESULTS](CANDLE_MONTH_GAP_2024_2025_V1_RESULTS.md) | Вне диапазона открытий не было, внутренняя группа не прошла 2024 |
| [CANDLE_WEEK_LEAD_2024_2025_V1](CANDLE_WEEK_LEAD_2024_2025_V1.md) | Лидер и аутсайдер одной недели среди SBER, GAZP и SBMX |
| [CANDLE_WEEK_LEAD_2024_2025_V1_RESULTS](CANDLE_WEEK_LEAD_2024_2025_V1_RESULTS.md) | Ни лидер, ни аутсайдер недели не прошли отбор 2024 |
| [CANDLE_INDEX_WEEK_2024_2025_V1](CANDLE_INDEX_WEEK_2024_2025_V1.md) | Знак недели IMOEX и следующая неделя SBER, GAZP и SBMX |
| [CANDLE_INDEX_WEEK_2024_2025_V1_RESULTS](CANDLE_INDEX_WEEK_2024_2025_V1_RESULTS.md) | После роста индексной недели средний плюс есть, доля побед ниже 51% |
| [CANDLE_INDEX_MONTH_2024_2025_V1](CANDLE_INDEX_MONTH_2024_2025_V1.md) | Знак месяца IMOEX и следующий месяц SBER, GAZP и SBMX |
| [CANDLE_INDEX_MONTH_2024_2025_V1_RESULTS](CANDLE_INDEX_MONTH_2024_2025_V1_RESULTS.md) | Ни рост, ни падение месяца индекса не прошли совместный отбор 2024 |
| [CANDLE_GOLD_WEEK_2024_2025_V1](CANDLE_GOLD_WEEK_2024_2025_V1.md) | Знак недели TGLD и следующая неделя SBER, GAZP и SBMX |
| [CANDLE_GOLD_WEEK_2024_2025_V1_RESULTS](CANDLE_GOLD_WEEK_2024_2025_V1_RESULTS.md) | Ни рост, ни падение недели золота не прошли отбор 2024 |
| [CANDLE_MONTH_WIDTH_2024_2025_V1](CANDLE_MONTH_WIDTH_2024_2025_V1.md) | Узкий или широкий месяц и весь следующий месяц |
| [CANDLE_MONTH_WIDTH_2024_2025_V1_RESULTS](CANDLE_MONTH_WIDTH_2024_2025_V1_RESULTS.md) | Узкий месяц отобран на 2024 и не подтверждён на 2025 |
| [CANDLE_BOND_WEEK_2024_2025_V1](CANDLE_BOND_WEEK_2024_2025_V1.md) | Знак недели SBGB и следующая неделя SBER, GAZP и SBMX |
| [CANDLE_BOND_WEEK_2024_2025_V1_RESULTS](CANDLE_BOND_WEEK_2024_2025_V1_RESULTS.md) | Ни рост, ни падение недели облигаций не прошли отбор 2024 |
| [CANDLE_WEEKDAY_2024_2025_V1](CANDLE_WEEKDAY_2024_2025_V1.md) | Свеча понедельника, вторника, среды, четверга и пятницы |
| [CANDLE_WEEKDAY_2024_2025_V1_RESULTS](CANDLE_WEEKDAY_2024_2025_V1_RESULTS.md) | Ни один день недели не прошёл совместный отбор 2024 |
| [CANDLE_PREF_WEEK_2024_2025_V1](CANDLE_PREF_WEEK_2024_2025_V1.md) | Знак недели SBERP и следующая неделя SBER |
| [CANDLE_PREF_WEEK_2024_2025_V1_RESULTS](CANDLE_PREF_WEEK_2024_2025_V1_RESULTS.md) | Ни рост, ни падение недели SBERP не прошли отбор 2024 |
| [CANDLE_THREE_WEEK_2024_2025_V1](CANDLE_THREE_WEEK_2024_2025_V1.md) | Три недели подряд в одну сторону и четвёртая неделя |
| [CANDLE_THREE_WEEK_2024_2025_V1_RESULTS](CANDLE_THREE_WEEK_2024_2025_V1_RESULTS.md) | Ни три роста, ни три падения не прошли отбор 2024 |
| [CANDLE_MONTH_INSIDE_2024_2025_V1](CANDLE_MONTH_INSIDE_2024_2025_V1.md) | Месяц внутри, снаружи или ни то ни другое, и следующий месяц |
| [CANDLE_MONTH_INSIDE_2024_2025_V1_RESULTS](CANDLE_MONTH_INSIDE_2024_2025_V1_RESULTS.md) | Внутренний и внешний месяц редки, остаток не прошёл 2024 |
| [CANDLE_WEEK_VWAP_2024_2025_V1](CANDLE_WEEK_VWAP_2024_2025_V1.md) | Закрытие недели против её объёмной цены и следующая неделя |
| [CANDLE_WEEK_VWAP_2024_2025_V1_RESULTS](CANDLE_WEEK_VWAP_2024_2025_V1_RESULTS.md) | Ни одна сторона объёмной цены не прошла совместный отбор 2024 |
| [CANDLE_MONDAY_HOUR_2024_2025_V1](CANDLE_MONDAY_HOUR_2024_2025_V1.md) | Первый час понедельника и удержание до пятницы 17:00 |
| [CANDLE_MONDAY_HOUR_2024_2025_V1_RESULTS](CANDLE_MONDAY_HOUR_2024_2025_V1_RESULTS.md) | Ни рост, ни падение первого часа понедельника не прошли отбор 2024 |
| [CANDLE_WEEK_INSIDE_2024_2025_V1](CANDLE_WEEK_INSIDE_2024_2025_V1.md) | Неделя внутри, снаружи или ни то ни другое, и следующая неделя |
| [CANDLE_WEEK_INSIDE_2024_2025_V1_RESULTS](CANDLE_WEEK_INSIDE_2024_2025_V1_RESULTS.md) | Внутренняя неделя не набрала восемь сделок сразу на трёх бумагах |
| [CANDLE_OIL_WEEK_2024_2025_V1](CANDLE_OIL_WEEK_2024_2025_V1.md) | Знак недели SNGS и следующая неделя GAZP |
| [CANDLE_OIL_WEEK_2024_2025_V1_RESULTS](CANDLE_OIL_WEEK_2024_2025_V1_RESULTS.md) | Ни рост, ни падение недели SNGS не прошли отбор 2024 |
| [CANDLE_WEEK_AGREE_2024_2025_V1](CANDLE_WEEK_AGREE_2024_2025_V1.md) | Согласие недель SBER и GAZP и следующая неделя SBMX |
| [CANDLE_WEEK_AGREE_2024_2025_V1_RESULTS](CANDLE_WEEK_AGREE_2024_2025_V1_RESULTS.md) | Ни рост, ни падение двух недель вместе не прошли отбор 2024 |
| [CANDLE_FRIDAY_WEEK_2024_2025_V1](CANDLE_FRIDAY_WEEK_2024_2025_V1.md) | Знак пятницы и вся следующая неделя |
| [CANDLE_FRIDAY_WEEK_2024_2025_V1_RESULTS](CANDLE_FRIDAY_WEEK_2024_2025_V1_RESULTS.md) | Ни рост, ни падение пятницы не прошли отбор 2024 |
| [CANDLE_MONTH_VWAP_2024_2025_V1](CANDLE_MONTH_VWAP_2024_2025_V1.md) | Закрытие месяца против его объёмной цены и следующий месяц |
| [CANDLE_MONTH_VWAP_2024_2025_V1_RESULTS](CANDLE_MONTH_VWAP_2024_2025_V1_RESULTS.md) | Плюс после закрытия ниже объёмной цены держится на одном месяце у каждой бумаги |
| [CANDLE_WEEK_BREAK_2024_2025_V1](CANDLE_WEEK_BREAK_2024_2025_V1.md) | Закрытие недели за максимумом или минимумом восьми предыдущих |
| [CANDLE_WEEK_BREAK_2024_2025_V1_RESULTS](CANDLE_WEEK_BREAK_2024_2025_V1_RESULTS.md) | Ни пробой, ни закрытие внутри восьми недель не прошли отбор 2024 |
| [CANDLE_WEEK_ENDS_2024_2025_V1](CANDLE_WEEK_ENDS_2024_2025_V1.md) | Понедельник и пятница одной недели и следующая неделя |
| [CANDLE_WEEK_ENDS_2024_2025_V1_RESULTS](CANDLE_WEEK_ENDS_2024_2025_V1_RESULTS.md) | Ни одно сочетание понедельника и пятницы не прошло отбор 2024 |
| [CANDLE_EXCHANGE_WEEK_2024_2025_V1](CANDLE_EXCHANGE_WEEK_2024_2025_V1.md) | Знак недели акции MOEX и следующая неделя SBMX |
| [CANDLE_EXCHANGE_WEEK_2024_2025_V1_RESULTS](CANDLE_EXCHANGE_WEEK_2024_2025_V1_RESULTS.md) | Ни рост, ни падение недели акции MOEX не прошли отбор 2024 |
| [CANDLE_MONTH_WICK_2024_2025_V1](CANDLE_MONTH_WICK_2024_2025_V1.md) | Какая тень месяца длиннее, и весь следующий месяц |
| [CANDLE_MONTH_WICK_2024_2025_V1_RESULTS](CANDLE_MONTH_WICK_2024_2025_V1_RESULTS.md) | Ни нижняя, ни верхняя тень месяца не прошли совместный отбор 2024 |
| [CANDLE_WEEK_BODY_2024_2025_V1](CANDLE_WEEK_BODY_2024_2025_V1.md) | Доля тела в диапазоне недели и следующая неделя |
| [CANDLE_WEEK_BODY_2024_2025_V1_RESULTS](CANDLE_WEEK_BODY_2024_2025_V1_RESULTS.md) | Ни одна доля тела недели не прошла совместный отбор 2024 |
| [CANDLE_MONTH_STEP_2024_2025_V1](CANDLE_MONTH_STEP_2024_2025_V1.md) | Открытие месяца против close прошлого месяца |
| [CANDLE_MONTH_STEP_2024_2025_V1_RESULTS](CANDLE_MONTH_STEP_2024_2025_V1_RESULTS.md) | Открытие выше прошлого close не прошло из-за GAZP |
| [CANDLE_MINER_WEEK_2024_2025_V1](CANDLE_MINER_WEEK_2024_2025_V1.md) | Знак недели PLZL и следующая неделя TGLD |
| [CANDLE_MINER_WEEK_2024_2025_V1_RESULTS](CANDLE_MINER_WEEK_2024_2025_V1_RESULTS.md) | Рост недели PLZL отобран на 2024 и не подтверждён на 2025 |
| [CANDLE_GOLD_LEAD_2024_2025_V1](CANDLE_GOLD_LEAD_2024_2025_V1.md) | Знак недели TGLD и следующая неделя PLZL |
| [CANDLE_GOLD_LEAD_2024_2025_V1_RESULTS](CANDLE_GOLD_LEAD_2024_2025_V1_RESULTS.md) | Ни рост, ни падение недели TGLD не прошли отбор для PLZL |
| [CANDLE_WEEK_VOLUME_2024_2025_V1](CANDLE_WEEK_VOLUME_2024_2025_V1.md) | Объём недели против медианы восьми предыдущих |
| [CANDLE_WEEK_VOLUME_2024_2025_V1_RESULTS](CANDLE_WEEK_VOLUME_2024_2025_V1_RESULTS.md) | Ни высокий, ни низкий объём недели не прошли отбор 2024 |
| [CANDLE_MONTH_VOLUME_2024_2025_V1](CANDLE_MONTH_VOLUME_2024_2025_V1.md) | Вырос ли объём месяца к предыдущему, и следующий месяц |
| [CANDLE_MONTH_VOLUME_2024_2025_V1_RESULTS](CANDLE_MONTH_VOLUME_2024_2025_V1_RESULTS.md) | Ни рост, ни падение месячного объёма не прошли совместный отбор 2024 |
| [CANDLE_MONTH_BODY_2024_2025_V1](CANDLE_MONTH_BODY_2024_2025_V1.md) | Доля тела в диапазоне месяца и следующий месяц |
| [CANDLE_MONTH_BODY_2024_2025_V1_RESULTS](CANDLE_MONTH_BODY_2024_2025_V1_RESULTS.md) | Малое тело месяца в плюсе, но у SBER и GAZP меньше четырёх сделок |
| [CANDLE_MONTH_HIGH_2024_2025_V1](CANDLE_MONTH_HIGH_2024_2025_V1.md) | В какой половине месяца поставлен high, и следующий месяц |
| [CANDLE_MONTH_HIGH_2024_2025_V1_RESULTS](CANDLE_MONTH_HIGH_2024_2025_V1_RESULTS.md) | Ранний максимум отобран на 2024 и не подтверждён на 2025 |
| [CANDLE_TWO_MONTH_2024_2025_V1](CANDLE_TWO_MONTH_2024_2025_V1.md) | Два месяца подряд в одну сторону и третий месяц |
| [CANDLE_TWO_MONTH_2024_2025_V1_RESULTS](CANDLE_TWO_MONTH_2024_2025_V1_RESULTS.md) | Ни два роста, ни два падения не набрали совместный порог 2024 |
| [CANDLE_PAIR_MONTH_2024_2025_V1](CANDLE_PAIR_MONTH_2024_2025_V1.md) | Лидер и аутсайдер месяца среди SBER и SBERP |
| [CANDLE_PAIR_MONTH_2024_2025_V1_RESULTS](CANDLE_PAIR_MONTH_2024_2025_V1_RESULTS.md) | Плюс аутсайдера пары держится на одной сделке |
| [CANDLE_MONTH_BREADTH_2024_2025_V1](CANDLE_MONTH_BREADTH_2024_2025_V1.md) | Доля растущих сессий месяца и следующий месяц |
| [CANDLE_MONTH_BREADTH_2024_2025_V1_RESULTS](CANDLE_MONTH_BREADTH_2024_2025_V1_RESULTS.md) | Меньшинство растущих дней не прошло из-за SBMX |
| [CANDLE_WEEK_BREADTH_2024_2025_V1](CANDLE_WEEK_BREADTH_2024_2025_V1.md) | Доля растущих сессий недели и следующая неделя |
| [CANDLE_WEEK_BREADTH_2024_2025_V1_RESULTS](CANDLE_WEEK_BREADTH_2024_2025_V1_RESULTS.md) | Ни большинство, ни меньшинство растущих дней недели не прошли отбор 2024 |
| [CANDLE_MONTH_FIRST_2024_2025_V1](CANDLE_MONTH_FIRST_2024_2025_V1.md) | Первая сессия месяца и остаток того же месяца |
| [CANDLE_MONTH_FIRST_2024_2025_V1_RESULTS](CANDLE_MONTH_FIRST_2024_2025_V1_RESULTS.md) | Рост первой сессии отобран на 2024 и не подтверждён на 2025 |
| [CANDLE_MONTH_LAST_2024_2025_V1](CANDLE_MONTH_LAST_2024_2025_V1.md) | Последняя сессия месяца и весь следующий месяц |
| [CANDLE_MONTH_LAST_2024_2025_V1_RESULTS](CANDLE_MONTH_LAST_2024_2025_V1_RESULTS.md) | Ни рост, ни падение последней сессии не прошли совместный отбор 2024 |
| [CANDLE_OIL_MONTH_2024_2025_V1](CANDLE_OIL_MONTH_2024_2025_V1.md) | Знак месяца LKOH и следующий месяц ROSN |
| [CANDLE_OIL_MONTH_2024_2025_V1_RESULTS](CANDLE_OIL_MONTH_2024_2025_V1_RESULTS.md) | Ни рост, ни падение месяца LKOH не прошли отбор для ROSN |
| [CANDLE_WEEK_SHIFT_2024_2025_V1](CANDLE_WEEK_SHIFT_2024_2025_V1.md) | Неделя целиком выше или ниже предыдущей |
| [CANDLE_WEEK_SHIFT_2024_2025_V1_RESULTS](CANDLE_WEEK_SHIFT_2024_2025_V1_RESULTS.md) | Ни сдвиг вверх, ни сдвиг вниз не прошли совместный отбор 2024 |
| [CANDLE_MONTH_SHIFT_2024_2025_V1](CANDLE_MONTH_SHIFT_2024_2025_V1.md) | Месяц целиком выше или ниже предыдущего |
| [CANDLE_MONTH_SHIFT_2024_2025_V1_RESULTS](CANDLE_MONTH_SHIFT_2024_2025_V1_RESULTS.md) | Плюс после сдвига вниз держится на одном месяце у SBER и SBMX |
| [CANDLE_PREF_MONTH_2024_2025_V1](CANDLE_PREF_MONTH_2024_2025_V1.md) | Знак месяца SNGSP и следующий месяц SNGS |
| [CANDLE_PREF_MONTH_2024_2025_V1_RESULTS](CANDLE_PREF_MONTH_2024_2025_V1_RESULTS.md) | Плюс после роста SNGSP держится на одной сделке |
| [CANDLE_STREAK_HOLD_2024_2025_V1](CANDLE_STREAK_HOLD_2024_2025_V1.md) | Три сессии одного знака и пять следующих |
| [CANDLE_STREAK_HOLD_2024_2025_V1_RESULTS](CANDLE_STREAK_HOLD_2024_2025_V1_RESULTS.md) | Ни три роста, ни три падения не прошли совместный отбор 2024 |
| [CANDLE_WEEK_FLIP_2024_2025_V1](CANDLE_WEEK_FLIP_2024_2025_V1.md) | Две недели противоположного знака и третья неделя |
| [CANDLE_WEEK_FLIP_2024_2025_V1_RESULTS](CANDLE_WEEK_FLIP_2024_2025_V1_RESULTS.md) | Плюс после падения и роста не проходит 51% и одну сделку SBER |
| [CANDLE_RELATIVE_WEEK_2024_2025_V1](CANDLE_RELATIVE_WEEK_2024_2025_V1.md) | Неделя бумаги сильнее или слабее недели IMOEX |
| [CANDLE_RELATIVE_WEEK_2024_2025_V1_RESULTS](CANDLE_RELATIVE_WEEK_2024_2025_V1_RESULTS.md) | Опережение индекса в минусе, отставание не набирает порог |
| [CANDLE_PRIOR_BREAK_2024_2025_V1](CANDLE_PRIOR_BREAK_2024_2025_V1.md) | Закрытие за вчерашним high или low и пять сессий |
| [CANDLE_PRIOR_BREAK_2024_2025_V1_RESULTS](CANDLE_PRIOR_BREAK_2024_2025_V1_RESULTS.md) | Плюс SBMX после пробоя вверх не проходит вместе с SBER и GAZP |
| [CANDLE_HIGH_PLACE_2024_2025_V1](CANDLE_HIGH_PLACE_2024_2025_V1.md) | Час первого дневного максимума и пять следующих сессий |
| [CANDLE_HIGH_PLACE_2024_2025_V1_RESULTS](CANDLE_HIGH_PLACE_2024_2025_V1_RESULTS.md) | Утренний максимум в минусе, середина и конец дня реже двадцати сделок |
| [CANDLE_DAY_VWAP_2024_2025_V1](CANDLE_DAY_VWAP_2024_2025_V1.md) | Закрытие 16:59 против VWAP сессии и пять следующих |
| [CANDLE_DAY_VWAP_2024_2025_V1_RESULTS](CANDLE_DAY_VWAP_2024_2025_V1_RESULTS.md) | Плюс GAZP выше VWAP не проходит вместе с SBER |
| [CANDLE_NIGHT_WEEK_2024_2025_V1](CANDLE_NIGHT_WEEK_2024_2025_V1.md) | Неделя, которую сделала ночь, и следующая неделя |
| [CANDLE_NIGHT_WEEK_2024_2025_V1_RESULTS](CANDLE_NIGHT_WEEK_2024_2025_V1_RESULTS.md) | Ночная неделя в минусе, дневная не набирает 51% |
| [CANDLE_WEEK_AVERAGE_2024_2025_V1](CANDLE_WEEK_AVERAGE_2024_2025_V1.md) | Закрытие недели против средней двадцати предыдущих |
| [CANDLE_WEEK_AVERAGE_2024_2025_V1_RESULTS](CANDLE_WEEK_AVERAGE_2024_2025_V1_RESULTS.md) | Плюс выше средней держится на одной неделе и не проходит 51% |
| [CANDLE_MONTH_EDGE_2024_2025_V1](CANDLE_MONTH_EDGE_2024_2025_V1.md) | Закрытие месяца за high или low предыдущего |
| [CANDLE_MONTH_EDGE_2024_2025_V1_RESULTS](CANDLE_MONTH_EDGE_2024_2025_V1_RESULTS.md) | Плюс внутри диапазона и ниже low держится на одном месяце |
| [CANDLE_MONTH_AGREE_2024_2025_V1](CANDLE_MONTH_AGREE_2024_2025_V1.md) | Оба месяца SBER и GAZP одного знака и следующий месяц SBMX |
| [CANDLE_MONTH_AGREE_2024_2025_V1_RESULTS](CANDLE_MONTH_AGREE_2024_2025_V1_RESULTS.md) | Два падения дают три плюсовые сделки, это меньше порога четыре |
| [CANDLE_WEEK_LOW_2024_2025_V1](CANDLE_WEEK_LOW_2024_2025_V1.md) | День, в который напечатан минимум недели |
| [CANDLE_WEEK_LOW_2024_2025_V1_RESULTS](CANDLE_WEEK_LOW_2024_2025_V1_RESULTS.md) | Плюс после минимума в понедельник держится на одной неделе GAZP |
| [CANDLE_PREF_SPREAD_2024_2025_V1](CANDLE_PREF_SPREAD_2024_2025_V1.md) | Неделя SBERP сильнее или слабее недели SBER |
| [CANDLE_PREF_SPREAD_2024_2025_V1_RESULTS](CANDLE_PREF_SPREAD_2024_2025_V1_RESULTS.md) | Плюс после опережения SBERP не проходит 51% и одну сделку |
| [CANDLE_LKOH_WEEK_2024_2025_V1](CANDLE_LKOH_WEEK_2024_2025_V1.md) | Знак недели LKOH и следующая неделя ROSN |
| [CANDLE_LKOH_WEEK_2024_2025_V1_RESULTS](CANDLE_LKOH_WEEK_2024_2025_V1_RESULTS.md) | Плюс после падения LKOH не проходит 51% и одну сделку |
| [CANDLE_WEEK_HIGH_2024_2025_V1](CANDLE_WEEK_HIGH_2024_2025_V1.md) | День, в который напечатан максимум недели |
| [CANDLE_WEEK_HIGH_2024_2025_V1_RESULTS](CANDLE_WEEK_HIGH_2024_2025_V1_RESULTS.md) | Плюс SBER после максимума в понедельник держится на одной неделе |
| [CANDLE_WEEK_EXPAND_2024_2025_V1](CANDLE_WEEK_EXPAND_2024_2025_V1.md) | Неделя шире или уже предыдущей |
| [CANDLE_WEEK_EXPAND_2024_2025_V1_RESULTS](CANDLE_WEEK_EXPAND_2024_2025_V1_RESULTS.md) | Широкая неделя в минусе, узкая не проходит 51% |
| [CANDLE_YEAR_OPEN_2024_2025_V1](CANDLE_YEAR_OPEN_2024_2025_V1.md) | Закрытие недели против открытия календарного года |
| [CANDLE_YEAR_OPEN_2024_2025_V1_RESULTS](CANDLE_YEAR_OPEN_2024_2025_V1_RESULTS.md) | И выше, и ниже открытия года все три бумаги в минусе |
| [CANDLE_WEEK_GAP_2024_2025_V1](CANDLE_WEEK_GAP_2024_2025_V1.md) | Понедельник открылся за диапазоном прошлой недели |
| [CANDLE_WEEK_GAP_2024_2025_V1_RESULTS](CANDLE_WEEK_GAP_2024_2025_V1_RESULTS.md) | Открытие за прошлой неделей реже восьми сделок и в минусе |
| [CANDLE_RANGE_STREAK_2024_2025_V1](CANDLE_RANGE_STREAK_2024_2025_V1.md) | Три недели подряд всё шире или всё уже |
| [CANDLE_RANGE_STREAK_2024_2025_V1_RESULTS](CANDLE_RANGE_STREAK_2024_2025_V1_RESULTS.md) | Плюс SBMX после трёх расширений не проходит вместе с SBER и GAZP |
| [CANDLE_SNGSP_WEEK_2024_2025_V1](CANDLE_SNGSP_WEEK_2024_2025_V1.md) | Знак недели SNGSP и следующая неделя SNGS |
| [CANDLE_SNGSP_WEEK_2024_2025_V1_RESULTS](CANDLE_SNGSP_WEEK_2024_2025_V1_RESULTS.md) | После роста SNGSP побед больше половины, средний net отрицательный |
| [CANDLE_DAY_AGREE_2024_2025_V1](CANDLE_DAY_AGREE_2024_2025_V1.md) | Утро и вторая половина одного знака, пять следующих сессий |
| [CANDLE_DAY_AGREE_2024_2025_V1_RESULTS](CANDLE_DAY_AGREE_2024_2025_V1_RESULTS.md) | Плюс SBER после двух половин падения держится на одной сделке |
| [CANDLE_RESOURCE_WEEK_2024_2025_V1](CANDLE_RESOURCE_WEEK_2024_2025_V1.md) | Недельный лидер и аутсайдер LKOH, ROSN и PLZL |
| [CANDLE_RESOURCE_WEEK_2024_2025_V1_RESULTS](CANDLE_RESOURCE_WEEK_2024_2025_V1_RESULTS.md) | И лидер, и аутсайдер недели в минусе |
| [CANDLE_WEEK_OF_MONTH_2024_2025_V1](CANDLE_WEEK_OF_MONTH_2024_2025_V1.md) | Первая, вторая, третья, четвёртая и пятая недели месяца |
| [CANDLE_WEEK_OF_MONTH_2024_2025_V1_RESULTS](CANDLE_WEEK_OF_MONTH_2024_2025_V1_RESULTS.md) | Плюс первой и четвёртой недели не проходит у всех трёх бумаг |
| [CANDLE_WEEK_WICK_2024_2025_V1](CANDLE_WEEK_WICK_2024_2025_V1.md) | Нижняя или верхняя тень недели и следующая неделя |
| [CANDLE_WEEK_WICK_2024_2025_V1_RESULTS](CANDLE_WEEK_WICK_2024_2025_V1_RESULTS.md) | Плюс SBMX после нижней тени не проходит 51% и не проходит у SBER и GAZP |
| [CANDLE_CASH_WEEK_2024_2025_V1](CANDLE_CASH_WEEK_2024_2025_V1.md) | Знак недели SBMM и следующая неделя акций |
| [CANDLE_CASH_WEEK_2024_2025_V1_RESULTS](CANDLE_CASH_WEEK_2024_2025_V1_RESULTS.md) | После роста SBMM все три бумаги в минусе, падений фонда не было |
| [CANDLE_VOLUME_STEP_2024_2025_V1](CANDLE_VOLUME_STEP_2024_2025_V1.md) | Объём недели больше или меньше предыдущей |
| [CANDLE_VOLUME_STEP_2024_2025_V1_RESULTS](CANDLE_VOLUME_STEP_2024_2025_V1_RESULTS.md) | Тяжёлая неделя в минусе, лёгкая не проходит 51% |
| [CANDLE_WEEK_SPLIT_2024_2025_V1](CANDLE_WEEK_SPLIT_2024_2025_V1.md) | Недели SBER и GAZP разного знака и следующая неделя SBMX |
| [CANDLE_WEEK_SPLIT_2024_2025_V1_RESULTS](CANDLE_WEEK_SPLIT_2024_2025_V1_RESULTS.md) | Оба расхождения в минусе и реже десяти сделок |
| [CANDLE_TWO_DAY_2024_2025_V1](CANDLE_TWO_DAY_2024_2025_V1.md) | Два дня разного знака и пять следующих сессий |
| [CANDLE_TWO_DAY_2024_2025_V1_RESULTS](CANDLE_TWO_DAY_2024_2025_V1_RESULTS.md) | Плюс после двух дней держится на одной сделке и не проходит 51% |
| [CANDLE_BODY_STEP_2024_2025_V1](CANDLE_BODY_STEP_2024_2025_V1.md) | Тело недели больше или меньше тела предыдущей |
| [CANDLE_BODY_STEP_2024_2025_V1_RESULTS](CANDLE_BODY_STEP_2024_2025_V1_RESULTS.md) | Плюс SBMX после большего тела не проходит вместе с GAZP |
| [CANDLE_LONG_GAP_2024_2025_V1](CANDLE_LONG_GAP_2024_2025_V1.md) | Пауза длиннее выходных и пять сессий после неё |
| [CANDLE_LONG_GAP_2024_2025_V1_RESULTS](CANDLE_LONG_GAP_2024_2025_V1_RESULTS.md) | После длинной паузы одна-две сделки, это меньше четырёх |
| [CANDLE_STEP_HOLD_2024_2025_V1](CANDLE_STEP_HOLD_2024_2025_V1.md) | Закрытие выше или ниже вчерашнего и пять сессий |
| [CANDLE_STEP_HOLD_2024_2025_V1_RESULTS](CANDLE_STEP_HOLD_2024_2025_V1_RESULTS.md) | Плюс после шага закрытия держится на одной сделке |
| [CANDLE_GAP_HOLD_2024_2025_V1](CANDLE_GAP_HOLD_2024_2025_V1.md) | Открытие за вчерашним high или low и пять сессий |
| [CANDLE_GAP_HOLD_2024_2025_V1_RESULTS](CANDLE_GAP_HOLD_2024_2025_V1_RESULTS.md) | Открытие выше вчерашнего high не проходит 51%, ниже low реже восьми |
| [CANDLE_UP_VOLUME_2024_2025_V1](CANDLE_UP_VOLUME_2024_2025_V1.md) | Объём растущих сессий недели против падающих |
| [CANDLE_UP_VOLUME_2024_2025_V1_RESULTS](CANDLE_UP_VOLUME_2024_2025_V1_RESULTS.md) | И перевес объёма на росте, и перевес на падении в минусе |
| [CANDLE_EFFICIENCY_2024_2025_V1](CANDLE_EFFICIENCY_2024_2025_V1.md) | Прямота недели выше или ниже предыдущей |
| [CANDLE_EFFICIENCY_2024_2025_V1_RESULTS](CANDLE_EFFICIENCY_2024_2025_V1_RESULTS.md) | Плюс SBMX после более прямой недели не проходит вместе с GAZP |
| [CANDLE_VWAP_OPEN_2024_2025_V1](CANDLE_VWAP_OPEN_2024_2025_V1.md) | Открытие недели против VWAP предыдущей |
| [CANDLE_VWAP_OPEN_2024_2025_V1_RESULTS](CANDLE_VWAP_OPEN_2024_2025_V1_RESULTS.md) | Плюс выше прошлой VWAP не проходит 51% |
| [CANDLE_MINER_MONTH_2024_2025_V1](CANDLE_MINER_MONTH_2024_2025_V1.md) | Знак месяца PLZL и следующий месяц акций |
| [CANDLE_MINER_MONTH_2024_2025_V1_RESULTS](CANDLE_MINER_MONTH_2024_2025_V1_RESULTS.md) | Падение PLZL прошло 2024 и не подтвердилось на 2025 без одной сделки |
| [CANDLE_MIDWEEK_2024_2025_V1](CANDLE_MIDWEEK_2024_2025_V1.md) | Закрытие среды против открытия понедельника и пять сессий |
| [CANDLE_MIDWEEK_2024_2025_V1_RESULTS](CANDLE_MIDWEEK_2024_2025_V1_RESULTS.md) | И среда выше понедельника, и среда ниже в минусе |
| [CANDLE_MONDAY_SHARE_2024_2025_V1](CANDLE_MONDAY_SHARE_2024_2025_V1.md) | Доля понедельника в диапазоне недели |
| [CANDLE_MONDAY_SHARE_2024_2025_V1_RESULTS](CANDLE_MONDAY_SHARE_2024_2025_V1_RESULTS.md) | Большая доля понедельника не набирает двадцать сделок, малая в минусе |
| [CANDLE_GAP_SIZE_2024_2025_V1](CANDLE_GAP_SIZE_2024_2025_V1.md) | Размер разрыва выходных относительно диапазона пятницы |
| [CANDLE_GAP_SIZE_2024_2025_V1_RESULTS](CANDLE_GAP_SIZE_2024_2025_V1_RESULTS.md) | Большой разрыв реже восьми сделок, обычный в минусе |
| [CANDLE_INDEX_DAYS_2024_2025_V1](CANDLE_INDEX_DAYS_2024_2025_V1.md) | Доля сессий недели, совпавших по знаку с IMOEX |
| [CANDLE_INDEX_DAYS_2024_2025_V1_RESULTS](CANDLE_INDEX_DAYS_2024_2025_V1_RESULTS.md) | Частое совпадение с индексом в минусе, редкое реже двадцати сделок |
| [CANDLE_SNGS_SPREAD_2024_2025_V1](CANDLE_SNGS_SPREAD_2024_2025_V1.md) | Неделя SNGSP сильнее или слабее недели SNGS |
| [CANDLE_SNGS_SPREAD_2024_2025_V1_RESULTS](CANDLE_SNGS_SPREAD_2024_2025_V1_RESULTS.md) | Опережение SNGS прошло 2024 и на 2025 ушло в минус |
| [CANDLE_INDEX_STREAK_2024_2025_V1](CANDLE_INDEX_STREAK_2024_2025_V1.md) | Два месяца IMOEX одного знака и следующий месяц акций |
| [CANDLE_INDEX_STREAK_2024_2025_V1_RESULTS](CANDLE_INDEX_STREAK_2024_2025_V1_RESULTS.md) | Два месяца роста реже четырёх, падение не проходит у SBER и SBMX |
| [CANDLE_HIGHER_HIGH_2024_2025_V1](CANDLE_HIGHER_HIGH_2024_2025_V1.md) | Сколько раз за неделю обновился дневной максимум |
| [CANDLE_HIGHER_HIGH_2024_2025_V1_RESULTS](CANDLE_HIGHER_HIGH_2024_2025_V1_RESULTS.md) | Плюс после обновлений максимума держится на одной неделе |
| [CANDLE_ROSN_WEEK_2024_2025_V1](CANDLE_ROSN_WEEK_2024_2025_V1.md) | Знак недели ROSN и следующая неделя акций |
| [CANDLE_ROSN_WEEK_2024_2025_V1_RESULTS](CANDLE_ROSN_WEEK_2024_2025_V1_RESULTS.md) | Плюс SBER и SBMX после роста ROSN не проходит у GAZP |
| [CANDLE_VOLUME_DAY_2024_2025_V1](CANDLE_VOLUME_DAY_2024_2025_V1.md) | День наибольшего объёма недели и следующая неделя |
| [CANDLE_VOLUME_DAY_2024_2025_V1_RESULTS](CANDLE_VOLUME_DAY_2024_2025_V1_RESULTS.md) | Плюс после объёмного дня держится на одной неделе |
| [CANDLE_VOLUME_SIGN_2024_2025_V1](CANDLE_VOLUME_SIGN_2024_2025_V1.md) | Знак сессии с наибольшим объёмом и следующая неделя |
| [CANDLE_VOLUME_SIGN_2024_2025_V1_RESULTS](CANDLE_VOLUME_SIGN_2024_2025_V1_RESULTS.md) | Плюс SBER после растущей объёмной сессии держится на одной неделе |
| [CANDLE_INSIDE_COUNT_2024_2025_V1](CANDLE_INSIDE_COUNT_2024_2025_V1.md) | Число внутренних дней недели и следующая неделя |
| [CANDLE_INSIDE_COUNT_2024_2025_V1_RESULTS](CANDLE_INSIDE_COUNT_2024_2025_V1_RESULTS.md) | Две внутренние сессии не набирают восемь недель |
| [CANDLE_MONTH_LOW_2024_2025_V1](CANDLE_MONTH_LOW_2024_2025_V1.md) | Положение минимума месяца и следующий месяц |
| [CANDLE_MONTH_LOW_2024_2025_V1_RESULTS](CANDLE_MONTH_LOW_2024_2025_V1_RESULTS.md) | Поздний минимум месяца прошёл 2024 и не подтвердился в 2025 |
| [CANDLE_HIGH_SIGN_2024_2025_V1](CANDLE_HIGH_SIGN_2024_2025_V1.md) | Знак сессии недельного максимума и следующая неделя |
| [CANDLE_HIGH_SIGN_2024_2025_V1_RESULTS](CANDLE_HIGH_SIGN_2024_2025_V1_RESULTS.md) | Плюс SBMX после растущего максимума не проходит у SBER и GAZP |
| [CANDLE_SBERP_MONTH_2024_2025_V1](CANDLE_SBERP_MONTH_2024_2025_V1.md) | Знак месяца SBERP и следующий месяц SBER |
| [CANDLE_SBERP_MONTH_2024_2025_V1_RESULTS](CANDLE_SBERP_MONTH_2024_2025_V1_RESULTS.md) | Плюс SBER после падения SBERP держится на одном месяце |
| [CANDLE_MONTH_ABOVE_2024_2025_V1](CANDLE_MONTH_ABOVE_2024_2025_V1.md) | Доля закрытий выше открытия месяца и следующий месяц |
| [CANDLE_MONTH_ABOVE_2024_2025_V1_RESULTS](CANDLE_MONTH_ABOVE_2024_2025_V1_RESULTS.md) | Плюс GAZP после низкой доли не проходит у SBER и SBMX |
| [CANDLE_ROSN_MONTH_2024_2025_V1](CANDLE_ROSN_MONTH_2024_2025_V1.md) | Знак месяца ROSN и следующий месяц акций |
| [CANDLE_ROSN_MONTH_2024_2025_V1_RESULTS](CANDLE_ROSN_MONTH_2024_2025_V1_RESULTS.md) | Плюс после падения месяца ROSN держится на одном месяце |
| [CANDLE_VOLUME_HIGH_2024_2025_V1](CANDLE_VOLUME_HIGH_2024_2025_V1.md) | Совпадение объёма и максимума и следующая неделя |
| [CANDLE_VOLUME_HIGH_2024_2025_V1_RESULTS](CANDLE_VOLUME_HIGH_2024_2025_V1_RESULTS.md) | Совпадение объёма и максимума не дало плюса |
| [CANDLE_WEEK_MONTH_2024_2025_V1](CANDLE_WEEK_MONTH_2024_2025_V1.md) | Закрытие недели против открытия месяца и следующая неделя |
| [CANDLE_WEEK_MONTH_2024_2025_V1_RESULTS](CANDLE_WEEK_MONTH_2024_2025_V1_RESULTS.md) | Плюс у открытия месяца держится на одной неделе |
| [CANDLE_LOWER_LOW_2024_2025_V1](CANDLE_LOWER_LOW_2024_2025_V1.md) | Число обновлений минимума за неделю и следующая неделя |
| [CANDLE_LOWER_LOW_2024_2025_V1_RESULTS](CANDLE_LOWER_LOW_2024_2025_V1_RESULTS.md) | Редкие обновления минимума не проходят совместно |
| [CANDLE_HALF_COUNT_2024_2025_V1](CANDLE_HALF_COUNT_2024_2025_V1.md) | Большинство закрытий в верхней половине дня и следующая неделя |
| [CANDLE_HALF_COUNT_2024_2025_V1_RESULTS](CANDLE_HALF_COUNT_2024_2025_V1_RESULTS.md) | Плюс GAZP после нижних закрытий держится на одной неделе |
| [CANDLE_OUTSIDE_COUNT_2024_2025_V1](CANDLE_OUTSIDE_COUNT_2024_2025_V1.md) | Внешняя сессия за неделю и следующая неделя |
| [CANDLE_OUTSIDE_COUNT_2024_2025_V1_RESULTS](CANDLE_OUTSIDE_COUNT_2024_2025_V1_RESULTS.md) | Плюс GAZP без внешней сессии держится на одной неделе |
| [CANDLE_PLZL_WEEK_2024_2025_V1](CANDLE_PLZL_WEEK_2024_2025_V1.md) | Знак недели PLZL и следующая неделя акций |
| [CANDLE_PLZL_WEEK_2024_2025_V1_RESULTS](CANDLE_PLZL_WEEK_2024_2025_V1_RESULTS.md) | Плюс SBER после падения PLZL держится на одной неделе |
| [CANDLE_LKOH_MONTH_2024_2025_V1](CANDLE_LKOH_MONTH_2024_2025_V1.md) | Знак месяца LKOH и следующий месяц акций |
| [CANDLE_LKOH_MONTH_2024_2025_V1_RESULTS](CANDLE_LKOH_MONTH_2024_2025_V1_RESULTS.md) | Плюс SBER после роста LKOH не проходит у GAZP |
| [CANDLE_WEEK_EDGE_2024_2025_V1](CANDLE_WEEK_EDGE_2024_2025_V1.md) | Закрытие недели за прошлым диапазоном и следующая неделя |
| [CANDLE_WEEK_EDGE_2024_2025_V1_RESULTS](CANDLE_WEEK_EDGE_2024_2025_V1_RESULTS.md) | Плюс SBMX после пробоя high не проходит у SBER и GAZP |
| [CANDLE_LOW_SIGN_2024_2025_V1](CANDLE_LOW_SIGN_2024_2025_V1.md) | Знак сессии недельного минимума и следующая неделя |
| [CANDLE_LOW_SIGN_2024_2025_V1_RESULTS](CANDLE_LOW_SIGN_2024_2025_V1_RESULTS.md) | Плюс после сессии минимума держится на одной неделе |
| [CANDLE_SNGS_MONTH_2024_2025_V1](CANDLE_SNGS_MONTH_2024_2025_V1.md) | Знак месяца SNGS и следующий месяц GAZP |
| [CANDLE_SNGS_MONTH_2024_2025_V1_RESULTS](CANDLE_SNGS_MONTH_2024_2025_V1_RESULTS.md) | Месяц SNGS не дал плюса у GAZP |
| [CANDLE_INDEX_TWO_2024_2025_V1](CANDLE_INDEX_TWO_2024_2025_V1.md) | Две недели IMOEX одного знака и следующая неделя акций |
| [CANDLE_INDEX_TWO_2024_2025_V1_RESULTS](CANDLE_INDEX_TWO_2024_2025_V1_RESULTS.md) | Плюс после двух падающих недель индекса держится на одной неделе |
| [CANDLE_GAP_NEXT_2024_2025_V1](CANDLE_GAP_NEXT_2024_2025_V1.md) | Знак разрыва и неделя после недели разрыва |
| [CANDLE_GAP_NEXT_2024_2025_V1_RESULTS](CANDLE_GAP_NEXT_2024_2025_V1_RESULTS.md) | Плюс после разрыва держится на одной неделе |
| [CANDLE_VOLUME_HALF_2024_2025_V1](CANDLE_VOLUME_HALF_2024_2025_V1.md) | Половина месяца с наибольшим объёмом и следующий месяц |
| [CANDLE_VOLUME_HALF_2024_2025_V1_RESULTS](CANDLE_VOLUME_HALF_2024_2025_V1_RESULTS.md) | Поздний объём месяца проходит у SBMX и не проходит у SBER и GAZP |
| [CANDLE_PEAK_SIGN_2024_2025_V1](CANDLE_PEAK_SIGN_2024_2025_V1.md) | Знак сессии с наибольшим объёмом месяца и следующий месяц |
| [CANDLE_PEAK_SIGN_2024_2025_V1_RESULTS](CANDLE_PEAK_SIGN_2024_2025_V1_RESULTS.md) | Плюс SBER после падающей объёмной сессии не проходит у GAZP и SBMX |
| [CANDLE_CLOSE_STEPS_2024_2025_V1](CANDLE_CLOSE_STEPS_2024_2025_V1.md) | Доля шагов закрытия за месяц и следующий месяц |
| [CANDLE_CLOSE_STEPS_2024_2025_V1_RESULTS](CANDLE_CLOSE_STEPS_2024_2025_V1_RESULTS.md) | Плюс шагов закрытия не проходит у всех трёх бумаг |
| [CANDLE_LOW_MONTH_2024_2025_V1](CANDLE_LOW_MONTH_2024_2025_V1.md) | Знак сессии месячного минимума и следующий месяц |
| [CANDLE_LOW_MONTH_2024_2025_V1_RESULTS](CANDLE_LOW_MONTH_2024_2025_V1_RESULTS.md) | Плюс после сессии минимума месяца держится на одном месяце |
| [CANDLE_ABOVE_WEEK_2024_2025_V1](CANDLE_ABOVE_WEEK_2024_2025_V1.md) | Закрытия выше close прошлой недели и следующая неделя |
| [CANDLE_ABOVE_WEEK_2024_2025_V1_RESULTS](CANDLE_ABOVE_WEEK_2024_2025_V1_RESULTS.md) | Плюс SBMX ниже close прошлой недели держится на одной неделе |
| [CANDLE_MONTH_BREAK_2024_2025_V1](CANDLE_MONTH_BREAK_2024_2025_V1.md) | Закрытие недели за диапазоном прошлого месяца |
| [CANDLE_MONTH_BREAK_2024_2025_V1_RESULTS](CANDLE_MONTH_BREAK_2024_2025_V1_RESULTS.md) | Плюс SBMX за месячным high держится на одной неделе |
| [CANDLE_MONTH_WEEKS_2024_2025_V1](CANDLE_MONTH_WEEKS_2024_2025_V1.md) | Перевес растущих недель месяца и следующий месяц |
| [CANDLE_MONTH_WEEKS_2024_2025_V1_RESULTS](CANDLE_MONTH_WEEKS_2024_2025_V1_RESULTS.md) | Плюс GAZP после падающих недель не проходит у SBER |
| [CANDLE_INDEX_WEEKS_2024_2025_V1](CANDLE_INDEX_WEEKS_2024_2025_V1.md) | Перевес недель IMOEX за месяц и следующий месяц акций |
| [CANDLE_INDEX_WEEKS_2024_2025_V1_RESULTS](CANDLE_INDEX_WEEKS_2024_2025_V1_RESULTS.md) | Плюс после падающих недель индекса держится на одном месяце |
| [CANDLE_HIGH_CLOSE_2024_2025_V1](CANDLE_HIGH_CLOSE_2024_2025_V1.md) | Закрытие сессии недельного максимума и следующая неделя |
| [CANDLE_HIGH_CLOSE_2024_2025_V1_RESULTS](CANDLE_HIGH_CLOSE_2024_2025_V1_RESULTS.md) | Плюс SBMX после сильного максимума не добирает двадцать недель |
| [CANDLE_THREE_BREAK_2024_2025_V1](CANDLE_THREE_BREAK_2024_2025_V1.md) | Три закрытия за экстремумом и пять следующих сессий |
| [CANDLE_THREE_BREAK_2024_2025_V1_RESULTS](CANDLE_THREE_BREAK_2024_2025_V1_RESULTS.md) | Три закрытия за экстремумом не набирают восемь сделок вместе |
| [CANDLE_MONTH_EXPAND_2024_2025_V1](CANDLE_MONTH_EXPAND_2024_2025_V1.md) | Ширина месяца против предыдущей и следующий месяц |
| [CANDLE_MONTH_EXPAND_2024_2025_V1_RESULTS](CANDLE_MONTH_EXPAND_2024_2025_V1_RESULTS.md) | Плюс ширины месяца не проходит у всех трёх бумаг |
| [CANDLE_DAY_MATCH_2024_2025_V1](CANDLE_DAY_MATCH_2024_2025_V1.md) | Совпадение дней SBER и GAZP и следующая неделя SBMX |
| [CANDLE_DAY_MATCH_2024_2025_V1_RESULTS](CANDLE_DAY_MATCH_2024_2025_V1_RESULTS.md) | Совпадение дней SBER и GAZP не дало плюса у SBMX |
| [CANDLE_GOLD_RANGE_2024_2025_V1](CANDLE_GOLD_RANGE_2024_2025_V1.md) | Ширина месяца TGLD и следующий месяц акций |
| [CANDLE_GOLD_RANGE_2024_2025_V1_RESULTS](CANDLE_GOLD_RANGE_2024_2025_V1_RESULTS.md) | Плюс после широкого месяца золота не проходит у SBER без лучшего месяца |
| [CANDLE_LOW_CLOSE_2024_2025_V1](CANDLE_LOW_CLOSE_2024_2025_V1.md) | Закрытие сессии недельного минимума и следующая неделя |
| [CANDLE_LOW_CLOSE_2024_2025_V1_RESULTS](CANDLE_LOW_CLOSE_2024_2025_V1_RESULTS.md) | Плюс после закрытия сессии минимума держится на одной неделе |
| [CANDLE_FIRST_WEEK_2024_2025_V1](CANDLE_FIRST_WEEK_2024_2025_V1.md) | Знак первой недели месяца и остаток месяца |
| [CANDLE_FIRST_WEEK_2024_2025_V1_RESULTS](CANDLE_FIRST_WEEK_2024_2025_V1_RESULTS.md) | Плюс SBER после первой растущей недели не проходит у GAZP и SBMX |
| [CANDLE_LAST_WEEK_2024_2025_V1](CANDLE_LAST_WEEK_2024_2025_V1.md) | Знак последней недели месяца и следующий месяц |
| [CANDLE_LAST_WEEK_2024_2025_V1_RESULTS](CANDLE_LAST_WEEK_2024_2025_V1_RESULTS.md) | Плюс GAZP после растущей последней недели не проходит у SBER и SBMX |
| [CANDLE_GOLD_MONTH_2024_2025_V1](CANDLE_GOLD_MONTH_2024_2025_V1.md) | Знак месяца TGLD и следующий месяц PLZL |
| [CANDLE_GOLD_MONTH_2024_2025_V1_RESULTS](CANDLE_GOLD_MONTH_2024_2025_V1_RESULTS.md) | Рост месяца золота подтвердился на следующем месяце PLZL |
| [CANDLE_MONTH_RESOURCE_2024_2025_V1](CANDLE_MONTH_RESOURCE_2024_2025_V1.md) | То же месячное лидерство на LKOH, ROSN и PLZL |
| [CANDLE_MONTH_RESOURCE_2024_2025_V1_RESULTS](CANDLE_MONTH_RESOURCE_2024_2025_V1_RESULTS.md) | Аутсайдер формально прошёл 2025, но держится на одном месяце PLZL |

Эти документы сохраняют воспроизводимость прошлых попыток. Исследовательский результат и техническая sandbox-проверка не подтверждают будущую доходность. Отсутствующие bid/ask или свечи должны оставаться отмеченными пропусками.

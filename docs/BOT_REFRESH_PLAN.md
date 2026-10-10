# План переработки бота — 3 октября 2026

Цель: управляемый бот с выбором торгового алгоритма, рекомендациями по выбранным акциям, понятным запуском и проверяемым сопровождением сделок. Доходность конкретного алгоритма подтверждается отдельной выборкой и фактическими расходами; популярность паттерна не является результатом его проверки.

Приоритет пользователя уточнён 3 октября: сначала полный исторический экран
всех трёх текущих стратегий и подготовка безопасного реального исполнения;
админка/многопользовательский пилот отложены. Дополнение, зафиксированное до
новых ORB/VWAP результатов: [catalog-all-existing-v1](CATALOG_ALL_STRATEGIES_SCREEN_V1.md).
Текущий код исполняет только sandbox; подготовка real и модельные результаты
не означают разрешения отправлять реальные заявки.

- [x] Зафиксировать отдельный full-catalog supplement до просмотра ORB/VWAP.
- [x] Проверить все три стратегии на том же минутном SBER источнике: 18
  независимых сценариев завершены, ни один model screen не прошёл;
  исходные параметры/расходы/ворота не изменены.
- [x] Добавить отдельную read-only проверку существующего боевого дневного
  счёта с pinned SHA/runtime и обезличенными JSON-гейтами;
  [границы проверки](LIVE_PILOT_READBACK.md).
- [x] Запустить фактический read-back боевого счёта после принятого main/deploy
  новой проверки. Результат отрицательный: account checks не подтверждены.
- [ ] Получить успешный свежий account read-back; успех приложения или наличие
  credentials не заменяет этот шаг. Локальные metadata reads не являются этим допуском.
- [ ] Новый forward/OOS, executable evidence, выбранный strategy sandbox-cycle,
  immutable cash baseline/точная post-flat сверка и отдельный real executor.
  - [x] Проверить из локального контейнера actual empty-window sandbox cursor
    read без funding/заявок. Это не nonempty ownership/fee или cash-cycle proof.
  - [x] Найти и программно закрыть технические readiness пробелы: read-only
    preflight до latch, отдельный cash-success gate и opt-in восстановление
    STOP после доказанного нулевого technical SELL. Legacy/uncertain не усыновляются.
  - [ ] Проверить новый technical contract фактическим брокерским циклом в
    разрешённом окне; cash proof и guard restoration не заменяются unit tests.

## Этапы и критерии приёмки

- [x] R1. Сверить актуальный main, конфигурацию, сканер, исполнение и Mini App. Исследовательские файлы в основном checkout сохранить. Работа: `codex/strategy-bot-refresh-2026-10-03`, базовый main `61b3ac9`.
- [x] R2. Исследовать первичные источники и описать три фиксированных алгоритма: тренд/объём, пробой диапазона открытия, возврат выше дневного VWAP. Разделить подтверждённые источниками механизмы и непроверенную доходность на MOEX.
- [x] R3. Реализовать общий контракт сигналов и выбор алгоритма без изменения счетов `intraday`/`swing`. Использовать завершённые свечи; проверять время, пропуски, шаг цены и расходы.
- [x] R4. Добавить сохраняемый выбор активов и алгоритма. Новый выбор аннулирует старый отчёт и старые кандидаты; открытые позиции продолжают сопровождаться по исходным параметрам.
- [x] R5. Добавить рекомендации для выбранных активов: сигнал/ожидание/блокировка, причины, стоимость лота, модельные расходы, риск и цель. Балл пригодности не выдавать за вероятность прибыли.
- [x] R6. Вывести выбор и рекомендации в Mini App и Telegram. Проверить авторизацию, валидацию, сохранение после перезапуска и конкуренцию с текущим сканированием.
- [x] R7. Упростить запуск: `npm run setup`, `npm run doctor`, Docker Compose; сохранить существующий `.env`, журнал и TLS-проверку. Актуализировать README и индекс документации.
- [x] R8. Проверить полный набор тестов/сборку, демонстрационный проход на синтетических данных и независимое ревью. Подготовить обновление для PR с результатами.
- [ ] R9. Проверить развёртывание и фактическое поведение на доступном окружении. Отдельно подтвердить sandbox-цикл выбранной стратегии и контроль расходов. Реальный автоматический брокерский исполнитель не входит в этот программный этап.
  - [x] R9a. Развернуть проверенную версию и подтвердить серверную конфигурацию/новую панель. Подтверждён main `ccb28da` с редизайном PR #80, cash/risk PR #81 и источником PR #82; runtime read-back `verified` в deploy 37125695204.
  - [ ] R9b. Подтвердить выбранный алгоритм полным sandbox-циклом с брокерскими исполнениям и сверкой результата.
    - [x] Реализовать opt-in выход по неизменной цели, generation CAS и восстановление native stop при доказанном нулевом SELL/неотправленном SELL. Локальные регрессии пройдены; брокерский цикл этим не заменён, флаг по умолчанию false.
    - [ ] Проверить настоящий сигнал выбранной версии, покупку, защиту, штатный выход и свежую сверку flat/cash/комиссий. Технический VTBR-тест не заменяет этот цикл; счёт не пополнять автоматически ради прохождения проверки.
- [ ] R10. Проверить экономику выбранного алгоритма на новых данных, комиссии и исполнимые цены. Принимать только заранее определённые критерии, учитывать многократный поиск. Завершение программной части не означает достижения цели прибыли.
  - [x] Зафиксировать до результатов протокол [CATALOG_PARITY_REPLAY_V1](CATALOG_PARITY_REPLAY_V1.md): SBER после изменения лота, trend-momentum-v1, development-only, отдельные расходы и неизменные ворота.
  - [x] Проверить программный loader без изменения исходной SQLite и replay того же алгоритма. Архивы прежних исследований не считать новым OOS; результаты синтетики не являются рыночным экраном.
    - [x] Реализовать immutable loader, новый parity replay и офлайн CLI без env/клиентов/заявок; добавить целочисленный учёт обслуживания и неизменной выборки расходов.
    - [x] Завершить независимое/security ревью и CI точного head в PR #79.
  - [x] Выполнить development-screen на безопасном новом финализированном источнике. Оригинал с непустым SHM не открывался и не изменялся; writer barrier для него по-прежнему не доказан. Вместо обхода guard выполнен отдельный публичный минутный capture с независимой проверкой provenance.
    - [x] Реализовать и локально проверить same-cohort cash/risk path, пересчёт риска/расходов и списание месячной платы до входов; встроить фактические path gates в CLI. Это синтетическая проверка контракта, не результат рыночной выборки.
    - [x] Проверить отдельный bounded capture публичных минутных страниц MOEX: новый каталог/DB, raw provenance, строгий allowlist и immutable verification без доступа к прежней SQLite. Локальные проверки и независимое ревью завершены; это программный контракт, не полный рыночный capture.
    - [x] Применить cash/risk path к проверенной минутной истории и зафиксировать модельный экран без ретюнинга: все шесть predeclared сценариев не прошли ворота. Это отрицательный development-screen, не допуск и не доказательство биржевой полноты.
    - [ ] Новые forward/executable доказательства и отдельный полный sandbox cash-flow выбранной версии. Пустая/недостаточная модельная выборка v1 не проходит 51% или критерий прибыли.

## Проверки

Обязательны `npm run check` и `npm run build`. Тесты сигналов: независимые положительные/отрицательные примеры, будущие/старые/дублированные свечи, пропуски, расходы, новый день. Тесты управления: неавторизованные изменения запрещены, переключение во время сканирования отклоняется, сценарии старой ревизии не отправляются. Тесты запуска: `.env` не перезаписывается, секреты не появляются в диагностике.

## Источники результата

Контракты и алгоритмы — `src/strategies/`; интеграция — `src/scanner/`, `src/telegram/`, `src/web/`; руководство — `docs/QUICKSTART.md`; исследовательская база и ограничения — `docs/STRATEGIES.md`. Итоги тестов и PR добавляются в этот план после проверки.

## Уточнение расходов будущего тарифа

Пользователь планирует подключить «Трейдер» перед реальной торговлей и сообщил
0,03% за сторону (`0.0003`). Это будущий условный исследовательский сценарий,
НЕ подтверждённый текущий тариф. На 3 октября 2026 [публичные условия Т-Банка](https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/)
для акций — 0,05% (`0.0005`) и возможные 390 ₽ за расчётный месяц. Перед снижением
исполнительного floor нужны действующий тариф/персональные условия, дата начала,
плата за обслуживание и подтверждённое освобождение от неё, если применимо.
GetUserTariff содержит лимиты API, а не процент комиссии. В R10 сравнить исходный
Investor scenario и заявленные будущие расходы без переобъявления прежних
результатов успешными. Обслуживание вычитается отдельно на уровне счёта/периода,
не раздувать оборот для достижения скидки. Действующий env/floor не снижен.

## Возврат к предыдущей версии

Временное выключение: пауза сканера и kill switch. Смена алгоритма не меняет старые стопы. Откат развёртывания — предыдущий commit/image с тем же приватным журналом и `.env`; не удалять Docker volume. Перед rollback сохранить резервную копию журнала без публикации. Если есть незавершённые позиции нового выбранного актива, сначала подтвердить закрытие/совместимость сопровождения: старая версия, зависящая от watchlist, может не знать его параметры. До сверенного flat-состояния сохранять новый защитный модуль и запрет новых входов.

## Текущий результат проверки

Реализованы каталог из трёх алгоритмов, общий движок, сохраняемый выбор с CAS-ревизией, рекомендации, управление в Telegram/Mini App, подготовка и диагностика запуска. Удалены заменённые старые фильтры сканера; исторические исследования и приватные данные не удалялись.

Локальный `npm run check`: **872 теста в 62 файлах**, проверка типов успешна; `npm run build` успешна. Защитные проверки операций с конфигурацией, runtime read-back и прохождения удалённого сценария: **36 Python-тестов** (16 существующих, 15 read-back и 5 stdin-регрессий). Независимое ревью нашло и закрыло обход временного окна при задержках и обход preflight локальным deploy. Добавлены проверки после ожиданий, перед публикацией/подтверждением и тесты: ошибка сборки либо preflight не заменяет старый контейнер. Просроченный сигнал не отображается как разрешённый вход в Mini App. Цены сохраняют точный шаг вплоть до нанорубля, а денежные суммы округляются отдельно.

Из незамерженного PR #74 перенесён только необходимый совместимый парсер известной дочерней native-stop заявки с пустым `orderRequestId`; совпадение exchange ID, операций, сделок и направления остаётся обязательным. Bootstrap/fixture-исполнитель и остальные изменения PR #74 не включены. Незавершённая сверка sandbox-денег не считается доказательством готовности или прибыли.

Автономный `smoke:strategy-bot` воспроизводит сигналы всех трёх алгоритмов при модельной комиссии 0,3% за сторону. Это искусственная выборка, не экономическое доказательство. Проверка запущена также в контейнере с `--network=none`, read-only FS и без секретов.

Программное обновление опубликовано и объединено: [PR #75](https://github.com/AndStrel/trading/pull/75), затем безопасная диагностика [PR #76](https://github.com/AndStrel/trading/pull/76), main `8a38035`. Security review обоих PR завершено без замечаний; [CI main 37114190666](https://github.com/AndStrel/trading/actions/runs/37114190666) успешен. Успешные статусы deploy не доказали замену контейнера: журнал заканчивался после preflight без runtime-отчёта.

Отдельный read-only [read-back 37114443462](https://github.com/AndStrel/trading/actions/runs/37114443462) подтвердил точный checkout, работающий процесс без перезапусков и публичный HTTPS, но отказался с `running-image-revision-mismatch`: работающий старый образ не имел новой revision label. Причина воспроизведена реальным локальным Docker: поглощение stdin удалённого bash-сценария одноразовым Compose-контейнером (`interactive=true` по умолчанию). [PR #77](https://github.com/AndStrel/trading/pull/77) исправил deploy явным non-interactive запуском и перенаправлением stdin; пять регрессий исполняют настоящий remote Bash body и проверяют достижение `up`/verifier и fail-closed ошибки.

После merge #77 main `f1df7fae6c9d2dde4d6692da2212c7b7bc923e12`: [CI 37115213018](https://github.com/AndStrel/trading/actions/runs/37115213018) и [deploy 37115212980](https://github.com/AndStrel/trading/actions/runs/37115212980) успешны. Фактический runtime-отчёт — `verified`: OCI revision совпадает с main, процесс работает без перезапусков, новый HTML/JS панели готов, unauthenticated API возвращает 401. `executionMode=disabled`, `kill=true`, `unresolvedCount=0`, `ordersSubmitted=false`; изолированная candidate-проверка успешна. HTTPS доступен с VPS. Это закрывает R9a, но не означает проверку авторизованного клиентского сценария на телефоне, полный sandbox-цикл или прибыльность.

Read-only [prepare-проверка 37109499875](https://github.com/AndStrel/trading/actions/runs/37109499875) успешна до обновления: `dry-run-ok`, `execution=disabled`, `kill=true`. [Повторная проверка 37112181135](https://github.com/AndStrel/trading/actions/runs/37112181135) после обновления дошла до `candidate-app-config` и отказалась с `command-failed`; env и заявки не менялись. Проверки работающего контейнера/журнала перед этой стадией прошли, но весь dry-run не считается успешным. Локальное воспроизведение candidate-probe в новом контейнере без сети на синтетическом env успешно.

После фактической замены контейнера повторный [dry-run 37115412620](https://github.com/AndStrel/trading/actions/runs/37115412620) на main `f1df7fa` успешен: `dry-run-ok`, `execution=disabled`, `kill=true`. Профиль не применялся, env/счета не менялись, дополнительных перезапусков и заявок не было. Старый отказ больше не воспроизводится на текущем работающем образе.

Локальные `.env` в основных checkout отсутствуют; повторно запрашивать токены не требуется: штатный deploy использует существующую конфигурацию. DNS `bot.brewnote.net` верный, но обращения с локального компьютера к HTTP/HTTPS/SSH VPS давали timeout. Сервер доступен штатному GitHub workflow; отдельный read-only runtime read-back работает. R9b/R10 остаются открытыми, все алгоритмы имеют статус `unvalidated`.

### Программный протокол цели и восстановления

Следующий локально проверенный этап — [SANDBOX_TARGET_EXIT](SANDBOX_TARGET_EXIT.md):
неизменный target floor, консервативный proof после фактического BUY, один target
attempt, новый UUID/поколение native stop после доказанного zero-fill либо
атомарно запрещённого неотправленного SELL, один возможный последующий session
attempt. Архив комиссий не подменяет итоговое исполнение и учитывается один раз.
Legacy/default-off сценарии не усыновляют новый target protocol. Неизвестные
SELL/stop ACK не повторяются; невозможное восстановление остаётся инцидентом,
а не успешной защитой. Real execution отсутствует, flags/env/accounts не менялись.

Валидация общего изменения: `check` — **1 020 тестов / 65 файлов**, build — PASS;
36 Python-регрессий — PASS. Независимое read-only ревью не нашло дополнительных
P1/P2; повторило 219 связанных тестов. Найденные при интеграции проблемы native
trigger/captured close key и второго zero-fill session закрыты регрессиями.
Docker Node24 build и runtime smoke с `--network=none`, read-only FS, без секретов
и реальных томов успешны: proof/late-fee rejection/SQLite schema/default-off и
сигналы трёх алгоритмов; `brokerRequests=0`. Это НЕ выбранная рыночная выборка,
не настоящий sandbox round trip, не денежный cash-flow proof и не допуск R10.

Протокол цели объединён в [PR #78](https://github.com/AndStrel/trading/pull/78):
main `a072f576f4c7e9e2ad2ae3c7812b4e8ed98a3b64`.
[CI 37118746945](https://github.com/AndStrel/trading/actions/runs/37118746945)
и [deploy 37118746929](https://github.com/AndStrel/trading/actions/runs/37118746929)
успешны на этом SHA. Security review точного PR head `253a766` завершено без
замечаний. Runtime — `verified`, revision совпадает, новый процесс без
перезапусков; `executionMode=disabled`, `kill=true`, `unresolvedCount=0`,
`ordersSubmitted=false`, панель/401/candidate-probe готовы, HTTPS доступен с VPS.
Default-off target flag не включался. R9b и R10 этим не закрыты.

Аудит cash-flow подтвердил отсутствие неизменного pre-BUY cash baseline в
текущем журнале. Quantity-flat и вычисленный net ещё НЕ точная сверка денег.
Известное расхождение VTBR не допускает выдуманного rounding tolerance или
пополнения; необходим отдельный атомарный baseline/late-fee протокол. Сведения
о техническом runner PR #74 в SANDBOX_VTBR_ACCEPTANCE отмечены как исторические.

### Локальная проверка инструментов R10

Ветка `codex/strategy-parity-research-2026-10-03`: `npm run check` —
**1 135 тестов / 70 файлов**, build — PASS; **36 Python-регрессий** — PASS.
Новые связанные регрессии — **115**, включая три shared engine, no-lookahead,
пропуски, STOP_LIMIT gap, точное закрытие, неизменную выборку расходов,
целочисленную плату за обслуживание и строгую provenance.

Новый локальный Node24-контейнер без сети, writable root, env или приватных
томов прошёл synthetic source smoke: immutable WAL-header читается без
sidecar, исходник не меняется, отсутствующий файл не создаётся, непустые
sidecar запрещены; CLI help и старый strategy smoke успешны. Регрессия
`smoke:catalog-source` добавлена в CI для того же hardened runtime.

Запуск CLI на старой оригинальной базе отказался с `source-not-safe`, как
предписано: непустой SHM. SHA-256/mtime/ctime исходника и sidecar до/после
совпали; база не исправлялась и не копировалась, отчёт рынка не создан,
`ordersSubmitted=false`. Нужен отдельно проверенный финализированный снимок;
все экономические/forward/execution ворота остаются открытыми. CI/review PR
будут записаны по фактическому результату, не подменяются локальными тестами.

Независимое ревью инструментов R10 завершено без открытых P1/P2; отдельно
повторены 115 связанных тестов, typecheck и diff-check. Расхождение описания
18:30/выхода по цели исправлено до каких-либо рыночных результатов и закреплено
регрессией: OPEN выше цели не добавляет модельную gap-прибыль.

Инструменты объединены в [PR #79](https://github.com/AndStrel/trading/pull/79),
main `995d5eece190b4536f561451bbfc73d846ec5e1e`.
[PR CI 37120793975](https://github.com/AndStrel/trading/actions/runs/37120793975)
успешен, security review точного head `111cad1` завершено без замечаний.
[Main CI 37121206763](https://github.com/AndStrel/trading/actions/runs/37121206763)
и [deploy 37121206799](https://github.com/AndStrel/trading/actions/runs/37121206799)
успешны. Runtime read-back — `verified`: revision `995d5ee`, running,
restartCount=0, executionMode=disabled, kill=true, unresolvedCount=0,
ordersSubmitted=false; панель/candidate-probe/unauthenticated 401 готовы,
HTTPS доступен с VPS. Env, счета и флаги исполнения не менялись.

Следующий локальный этап — отдельный финализатор публичной истории с доказанной
остановкой именно writers этого файла либо согласованным snapshot-механизмом,
новым приватным staging и schema allowlist в выходной копии. Fingerprints
до/после не заменяют writer exclusion. Исходник и sidecars не чистить, не
мигрировать, не переименовывать; обычное read-only SQLite подключение не считать
гарантией их неизменности. Пока writer barrier не доказан, рынок не прогонять
и source guard не ослаблять. R9b/прибыльность/51%/forward остаются незавершёнными.

### Same-cohort cash/risk и аудит источника

Новый `catalog-cohort-viability` сохраняет исходные attempts и проверяет точный
порядок денег/расходов/риска. Profit-only sensitivity больше не подменяет
stress viability: CLI показывает отдельные base/stress ledger и реальные
модельные path gates. Месячные 390 ₽ резервируются перед первым входом, а не
только вычитаются в итоговом результате; нехватка наличных, новый риск выше
20 ₽, unresolved и overlap запрещают proof без переселекции сделок.
Admission/executable evidence всегда false; реальный floor, env, счета и
режим исполнения не меняются. Результат проверок/PR добавляется после проверки.

Writer inventory исходного журнала не нашёл открытых native handles; единственный
Docker mount основной базы принадлежит остановленному research-контейнеру.
Это наблюдение, НЕ запрет будущей записи. Синтетический тест обнаружил, что
host POSIX exclusive-lock не блокирует SQLite writer внутри OrbStack Docker
bind: универсальный lock/copy обход не принят. Оригинал не открывался SQLite,
не копировался, sidecars не чистились. Остановка quote-capture бессмысленна:
он пишет другой каталог. [SQLite предупреждает о копировании во время записи](https://sqlite.org/howtocorrupt.html).

Проверенный публичный кэш прежних исследований содержит 49 675 **10-минутных**
SBER/TQBR свечей, а одиночный файл — две дневные свечи. Они не заменяют
минутную историю; их SHA не выдаются за SHA прежних годовых архивов.
Три новые публичные HTTPS-проверки MOEX (две первые страницы `interval=1`
и candleborders) успешны: начало августа 2025 и сентябрь 2026 доступны,
500 корректных минутных строк на каждой проверенной странице. Это только
проверка доступности, НЕ полнота frozen window и НЕ новый OOS.
Следующий безопасный путь — новый bounded raw-page capture MOEX с точной
provenance, строгой минутной валидацией и новым allowlisted финализированным
файлом. Старый MOEX annual importer без доработки не подходит: текущий lot/tick,
normalized-row SHA и last-wins duplicate map нельзя объявлять raw/as-of proof.

### Синхронизация объединённого редизайна

По запросу пользователя подтянут [PR #80](https://github.com/AndStrel/trading/pull/80)
(`3401e14be3cfd8d3f00d0283ec7aaea708437508`). Локальная исследовательская
ветка перебазирована на этот main; незавершённый cash/risk draft сохранён
отдельными локальными коммитами, не опубликован и не развёрнут.
[Main CI 37122736437](https://github.com/AndStrel/trading/actions/runs/37122736437)
и автоматический [deploy 37122736340](https://github.com/AndStrel/trading/actions/runs/37122736340)
успешны на точном SHA. Повторного deploy/restart не было: выполнена только
свежая [read-only проверка 37122987889](https://github.com/AndStrel/trading/actions/runs/37122987889).
Её фактический отчёт `verified`: revision `3401e14`, running, restartCount=0,
executionMode=disabled, kill=true, unresolvedCount=0, ordersSubmitted=false;
панель/JS/401/candidate probe готовы, HTTPS доступен с VPS. Это не подтверждение
открытия приложения в настоящем Telegram на каждом телефоне.

После синхронизации локальный `check` — **1 216 тестов / 73 файла**, build PASS,
36 Python-регрессий PASS. Этот локальный набор включает сохранённый
исследовательский draft; production использует только accepted main `3401e14`.
Проверено точное копирование трёх новых HTML/CSS/JS assets в dist.
Независимый source audit восьми файлов редизайна не нашёл воспроизводимых P1/P2;
Security Review exact PR head `7ec7ec2` завершён без findings/review threads.
Счета, env, флаги и реальные заявки не менялись. R9b/R10 остаются открытыми.

Same-cohort денежный контракт объединён в
[PR #81](https://github.com/AndStrel/trading/pull/81), main
`994ae34dd60d77f56a262ecd69630e6ff76583e7`.
[PR CI 37123582254](https://github.com/AndStrel/trading/actions/runs/37123582254)
успешен на exact head `df119e8`; независимый review повторил 1 216 тестов,
110 связанных регрессий/build/diff-check без открытых P1/P2. Security Review
этого head завершён без findings/threads.
[Main CI 37123911830](https://github.com/AndStrel/trading/actions/runs/37123911830)
и [deploy 37123911809](https://github.com/AndStrel/trading/actions/runs/37123911809)
успешны. Фактический runtime `verified`: revision `994ae34`, running,
restartCount=0, executionMode=disabled, kill=true, unresolvedCount=0,
ordersSubmitted=false; Mini App/JS/401/candidate/HTTPS готовы.
Это программный контракт, НЕ положительный результат выбранной стратегии.

Следующий этап — [FROZEN_MOEX_MINUTE_CAPTURE](FROZEN_MOEX_MINUTE_CAPTURE.md):
новый bounded публичный source на прежнем frozen window, реальные raw bytes
и request-window SHA/provenance, allowlisted новый файл. Исходная SQLite
не открывается/не копируется/не исправляется. Алгоритм и ворота не меняются.

### Полный каталог и локальный broker runtime — 3 октября

[PR #84](https://github.com/AndStrel/trading/pull/84) объединён в main
`f1d56be84d2d8a4f7776cbd8d1b56ba6b0379e63` после exact-head CI/review.
[Main CI 37128476243](https://github.com/AndStrel/trading/actions/runs/37128476243)
и [deploy 37128476346](https://github.com/AndStrel/trading/actions/runs/37128476346)
успешны; runtime соответствует revision, running/restartCount=0,
execution disabled, kill=true, ordersSubmitted=false.

Все три текущие стратегии проверены на заранее объявленном SBER-источнике:
18 альтернативных model screens, 14 пустых, четыре с одной убыточной модельной
сделкой. Ни один не прошёл gates; четыре результата не являются четырьмя
независимыми рыночными сделками. Параметры, расходы и ворота не ретюнились.
Это development-only screen, не новый OOS и не прибыльность выбранного счёта.

Фактический [live read-only preflight 37128587399](https://github.com/AndStrel/trading/actions/runs/37128587399)
не прошёл: `accountChecksPassed:false`, `broker-read-unconfirmed`,
`liveSubmissionAllowed:false`. Дополнительная no-token диагностика показала
container TCP timeouts к брокеру до TLS; VPS tbank достигает TCP, но штатная
проверка CA не проходит. Это не доказательство блокировки провайдером/невалидного
токена. TLS не отключался, host CA store не менялся.

По запросу пользователя собран и фактически запущен актуальный main локально:
узкий market relay без второго Telegram poller, live/sandbox credentials,
общего `.env`, journal или production volumes. Only loopback, read-only FS,
минимальная read-capsule; [контракт запуска](LOCAL_READONLY_RUNTIME.md).
Authenticated market read успешен, no-auth/account-method guards подтверждены.
Отдельные `GetAccounts`/`GetInfo` read успешны, заданные оператором профили
проверены; персональные broker metadata в Git не сохраняются. Balance,
configured account IDs, позиции/заявки и live credential этим не подтверждены.
Broker writes не выполнялись. Затем восстановлен existing private SSH/socket
channel: старый verified stale socket сохранён, новый доступен только root:node,
secret/env/server process не менялись. Server-to-local 401/400/`Shares` proof
успешен; operator view показал local configured/available. Выбран «Компьютер»
при disabled+kill и сброшен прежний report. Реальное Telegram-устройство этим
не проверено; новый scanner pass ждёт штатного окна, расписание не обходилось.

- [x] Безопасно подготовить минимальную read-capsule без изменения исходного snapshot.
- [x] Собрать current-main локальный образ с изолированным CA и проверить actual runtime.
- [x] Проверить authenticated market read, relay boundaries и два account metadata reads.
- [x] Проверить host helpers: 23 offline tests; приложение до cash slice —
  1 326 tests, typecheck/build PASS.
- [x] Проверить и восстановить безопасный tunnel, подтвердить доступность локального
  источника и выбрать его серверному scanner без переключения account/real execution.
- [ ] Получить свежий штатный scanner report из локального источника в разрешённое окно.
- [x] Immutable pre-BUY baseline и append-only post-flat cash/operations/late-fee
  proof: integrated implementation, offline tests и независимое ревью завершены.
- [ ] Actual broker-совместимость нового cash/operations протокола и новый полный
  sandbox round trip. Программная проверка не заменяет эту приёмку.
- [ ] Полный выбранный strategy sandbox cycle, новый forward/OOS/executable
  evidence, успешный account preflight и отдельный real executor. R9b/R10 открыты.

### Интегрированный денежный контракт sandbox

Объединённый [PR #85](https://github.com/AndStrel/trading/pull/85) добавляет baseline
атомарно с выигравшим BUY claim, immutable identity и append-only post-flat
observations с current epoch/ledger/native/close CAS. Перед POST заново проверяется
полная стоимость входа с прежним Investor floor; gross-only наличных недостаточно.
Точный cash delta сопоставляется с fills, всеми известными расходами и полным
owned account-window operations evidence. Чужие/компенсирующие потоки, missing
данные, late fee, stale epoch и любое nano-расхождение не получают cash proof.
[Подробный контракт](SANDBOX_CASH_EVIDENCE.md).

`complete` сохраняет прежнее fills/flat значение; новый `cashProven` требует
`reconciled`. Legacy записи без pre-BUY baseline не усыновляют новый proof.
Интерфейс отделяет «По исполнениям» от денег, сверенных на момент проверки;
real actual PnL остаётся null, kill/reservations автоматически не снимаются.

Независимое review выявило и подтвердило исправления: cleanup чужого временного
файла при EEXIST/подмене inode; неограниченное ожидание отмены stream; усечение
broker Timestamp перед точным ownership comparison. Добавлены regressions,
deadline независимо ограничивает hung fetch/read/curl, fresh timestamps/closedAt
сохраняют наносекунды; tolerance или усыновления truncated history нет.
Финальный read-only review: 481 связанных тестов PASS, открытых P1/P2 не найдено;
bounded curl отдельно — 22 tests и пять независимых VM checks PASS.

Локальный полный `check`: **1 598 TS tests / 79 files + 23 offline ops tests**;
typecheck/build — PASS, **52 Python regressions** — PASS. Compiled Node24 smoke
в контейнере с network none/read-only FS/без private inputs и real volumes
проверяет arming/selection/source guards; это local draft overlay, не новый
deployed image. Отдельный настоящий curl в таком контейнере отказал без сети,
вернул только fixed error и очистил свои private temp artifacts.

Новых broker order/funding calls нет. Actual owned cursor cash proof, владение
ненулевой комиссией архивного zero-fill SELL, выбранный strategy round trip и
экономические R10 gates остаются непроверенными; unknown остаётся incomplete.
### Принятый денежный контракт и следующий локальный safety slice

PR #85 объединён после exact-head CI `37132689459` и Code Review без findings.
Security Review завершён на предыдущем head; единственный последующий diff —
платформенно независимая negative fixture для прав приватного каталога, а не
изменение production кода. Этот diff проверен отдельно. Main
`e5da8af6f8923c8e8053e509eb9edfbe19de7eaa` прошёл
[CI 37133367596](https://github.com/AndStrel/trading/actions/runs/37133367596)
и [deploy 37133367465](https://github.com/AndStrel/trading/actions/runs/37133367465).
Независимый runtime readback: exact revision, running/restartCount=0,
disabled/kill=true/unresolvedCount=0/ordersSubmitted=false; Mini App HTML/JS,
401 guards, candidate config и HTTPS готовы. После deploy повторно проверена
доступность локального relay и через защищённый operator API выбран «Компьютер»;
старый scanner report сброшен. Реальное Telegram-устройство не проверено.
Локальный постоянный relay по-прежнему использует проверенный образ `f1d56be`,
а не новую серверную revision; он не исполняет заявки.

Следующий локальный draft — [technical cash acceptance](SANDBOX_VTBR_ACCEPTANCE.md):
read-only preflight до latch/journal, cash-only success и bounded восстановление
защиты после proven zero-fill SELL для новых opted-in baseline-сценариев.
Полный локальный check: **1 656 TS tests / 82 files + 23 ops tests**, typecheck,
build и **52 Python regressions** — PASS. Независимые root/restore reviews
не нашли открытых P1/P2. Собранный CLI проверен в Node 24.21.0 контейнере с
network none/read-only root и только синтетическими inputs: реальные Saturday
`preflight` и `run` отказались без broker requests, audit files и entry claim.
Первый smoke assertion исправлен под фактическое фиксированное имя результата;
production код этим не менялся. Это draft dist overlay, не новый deployed image.

Нового broker BUY/STOP/SELL/cash cycle нет. Старое nano-расхождение не принято
и не стерто. Cash-cycle acceptance, свежий штатный scanner pass, независимый
forward evidence, R9b и R10 остаются открытыми; прибыль и real GO не заявлены.

### Принятая technical cash safety и durable local source

[PR #86](https://github.com/AndStrel/trading/pull/86) объединён после
[CI 37134254920](https://github.com/AndStrel/trading/actions/runs/37134254920),
Code Review и Security Review на exact head `a5f010c`, без findings/threads.
Main `c9cbf1294aab9e7e0032a3d71f8ad467dca3dfb1` прошёл
[CI 37134687540](https://github.com/AndStrel/trading/actions/runs/37134687540)
и [deploy 37134687566](https://github.com/AndStrel/trading/actions/runs/37134687566).
Фактический runtime: exact revision, running/restartCount=0, disabled/kill=true,
unresolvedCount=0/ordersSubmitted=false; Mini App HTML/JS/401, candidate config,
HTTPS готовы. После этого deploy снова проверен и выбран «Компьютер» через
защищённый operator API, прежний report сброшен; Telegram-device не проверен.

Actual исторический cursor-window теперь непустой: 1 page/4 items,
BUY/SELL/2 BROKER_FEE, no writes. Отдельный shape probe не подтвердил
fee-parent linkage; соответствие комиссий остаётся unknown, не false zero
и не готовый cash proof. [Точные границы](SANDBOX_CASH_EVIDENCE.md).
Legacy baseline не усыновлён, старое nano-расхождение не объяснено этим чтением.

Следующий draft устраняет source reset после deploy: отдельная tiny v1 запись
операторского предпочтения, fresh health не сохраняется, никакого fallback
на «Сервер». Ошибки load/save безопасно отказывают; lease/freshness и fetch
контракт сохранены. [Контракт local runtime](LOCAL_READONLY_RUNTIME.md).
Локальные 1 684 TS tests / 82 files + 23 ops-local, typecheck/build и compiled
Node24 synthetic restart/no-fallback smoke — PASS; независимый source review
не нашёл P1/P2. Runtime restart этого draft ещё не заявлен принятым.

- [x] Установить реальную причину source reset: preference не сохранялся.
- [x] Добавить и локально проверить durable read-only source preference.
- [ ] Exact-head CI/review, accepted deploy и фактический restart/readback
  сохранённого «Компьютер» для следующей версии.
- [ ] Штатный scanner pass, новый owned sandbox cash-cycle и R9b/R10:
  экономические/реальные ворота не менялись и не пройдены.

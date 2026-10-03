# Денежная сверка sandbox

Контракт этого этапа: не объявлять денежный результат подтверждённым только по
BUY/SELL fills, известным комиссиям или пустой позиции. Это sandbox-протокол;
он не реализует real execution, не доказывает прибыльность стратегии и не
разрешает новую заявку, снятие kill или освобождение резерва риска.

## Перед BUY

Непосредственно перед claim заново читаются positions/cash, orders и stop orders
выбранного подготовленного sandbox account. Позиции должны быть flat, действующих
заявок/защит не должно быть, денег должно хватать на вход с действующими расходами.
Используются прежние commission/slippage floors, лимиты и торговое окно.

Baseline содержит целочисленные nano, account/request identity, интервал чтения,
ledger revision, подготовленную account identity, kill generation и selection.
Он записывается только вместе с выигравшим BUY claim в одной `BEGIN IMMEDIATE`
транзакции. Pending → submitting и baseline либо сохраняются вместе, либо
откатываются вместе. Изменившиеся/устаревшие evidence не дают отправить POST.
Повторный claim baseline не перезаписывает. Старую сделку без baseline нельзя
задним числом сделать cash-proven, в том числе остатком после закрытия.

## После закрытия

Штатная сверка сохраняет fills/fees/flat evidence, затем выполняет отдельные
свежие cash/positions/orders/stops reads. Observation append-only, привязана к
той же account/request identity, актуальным ledger/native/close и текущему
операционному epoch. Смена epoch, account, selection, ledger или поколения
защиты во время ожидаемых ответов не проходит атомарную запись observation.

Дополнительно читается полный account-window через
[`GetSandboxOperationsByCursor`](https://developer.tbank.ru/invest/api/sandbox-service-get-sandbox-operations-by-cursor).
Не устанавливать фильтры, скрывающие комиссии, неторговые движения или pending
operations; `withoutCommissions`, `withoutTrades`, `withoutOvernights` — false.
Это отдельный read от прежней narrow hydration одного order.

Границы чтения: окно не длиннее семи дней, максимум 10 страниц / 1 000 items,
1 MiB на страницу и 30 секунд на весь account-window. Нет повторов,
переключения fetch/curl, перенаправлений или отключения TLS. Curl — отдельный
bounded one-shot capability только этого sandbox read endpoint; секрет не
попадает в argv/env/stdout/stderr. Deadline независимо ограничивает ожидание
fetch, stream read и configured curl; отмена/очистка best-effort не задерживает
отказ. Запоздавшая файловая очистка может завершиться после отказа по deadline.
Превышение границ, незавершённая пагинация,
повтор cursor/operation, некорректный ответ или неизвестная операция — не proof.

BUY/SELL ownership проверяется по сохранённым trade stages: instrument, trade
ID, время, цена и количество. Fresh stage timestamps и causal close boundary
сохраняют наносекунды; усечённые старые снимки не становятся точным proof.
Комиссии должны принадлежать этим операциям;
summary commission не суммируется повторно с соответствующей fee operation.
Архивированные failed-close fees входят ровно один раз. Если их принадлежность
не подтверждена broker evidence, результат остаётся incomplete.
Пополнение, вывод и иные посторонние потоки не маскируются взаимным сокращением.

Сравниваются точные целочисленные величины:

```text
actual delta = post-flat cash − immutable pre-BUY cash
expected delta = SELL proceeds − BUY cost − all confirmed fees
```

Нет floating epsilon, invented rounding allowance или пополнения ради совпадения.
Совпадения cash delta недостаточно без полного ownership/operations proof.

## Значения результата

- `complete` сохраняет прежний смысл: fills/известный net/flat подтверждены.
  Это не денежный proof и не допуск следующей сделки.
- `cashProven:true` возможно только при `cashReconciliation.status:reconciled`:
  текущие account-window evidence, ownership и точные деньги согласованы.
- `mismatch` означает несовпадение денег; `incomplete` — отсутствие или
  устаревание необходимого доказательства. Ни то ни другое не считается нулём
  расходов или успешной сделкой.

Поздняя fee/новая ledger revision делает прежнюю денежную сверку неактуальной;
нужна новая append-only observation и новое full-window evidence. Даже reconciled
— согласованность **на момент проверки**, не гарантия окончательного broker
settlement: будущие/ещё не отражённые операции нельзя предсказать.

Mini App показывает только safe primitive `cashProven`/`cashStatus`; baseline,
account IDs, operation IDs и raw reasons не выводятся. До proof сумма подписана
«По исполнениям». Общий actual real PnL остаётся null.

## Приёмка

Offline tests должны покрывать atomic claim/rollback, stale revision/epoch,
legacy отсутствие baseline, точный плюс/минус, late fees, чужие/компенсирующие
потоки, неизвестную/частичную/дублированную pagination и bounded transports.
Это программная приёмка, не факт брокерского round trip.

Следующие отдельные ворота: actual read-only broker contract, новый полный
цикл выбранной версии с baseline до первой BUY, свежий cash/operations proof,
forward/OOS/executable-price экономика и отдельный real executor. Известное
старое nano-расхождение не считается устранённым этим новым контрактом.

## Фактический read contract 3 октября

Из отдельного локального контейнера с read-only rootfs выполнены только
`GetSandboxAccounts` и bounded `GetSandboxOperationsByCursor` заранее
подготовленного sandbox account. Identity совпала; полное окно последних
24 часов вернуло одну страницу без items. Raw payload, account identity и
credentials не публиковались; заявок/пополнений/изменений счёта не было.

Это подтверждает только endpoint/transport и empty-window pagination contract.
Не проверены nonempty trade/fee schema, ownership, baseline и точная денежная
сверка после новой сделки. `cashProven:false`; пустое окно не является
успешным торговым циклом. Новые технические ворота описаны в
[VTBR acceptance](SANDBOX_VTBR_ACCEPTANCE.md).

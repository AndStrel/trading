# Fresh public minute capture для catalog replay

Статус: программный контракт проверен локально и независимым ревью; полный
capture и рыночный экран ещё не подтверждены. Это не разрешение торговли.
Подготовка не меняет алгоритм/ворота
[CATALOG_PARITY_REPLAY_V1](CATALOG_PARITY_REPLAY_V1.md).

## Зачем отдельный путь

Старая SQLite имеет непустой SHM. Её loader правильно отвергает; обычный
read-only SQLite SELECT не гарантирует неизменность sidecars. Внешний native
host lock не блокировал Docker writer в воспроизведённом тесте OrbStack.
Копирование живой базы или очистка sidecars не являются разрешённым обходом.
Сохранённые десятиминутные/дневные кэши не восстанавливают минутные данные.

Новый capture работает только с публичным HTTPS MOEX ISS, без токенов, env,
брокерских клиентов и заявок. Источник фиксирован: SBER/TQBR, interval=1,
UTC-период `[2025-08-01T00:00:00.000Z, 2026-09-27T00:00:00.000Z)`.
Лот 1 с 01.08.2025 — [датированное уведомление MOEX](https://www.moex.com/n92172);
шаг 0,01 ₽ остаётся явным модельным допущением. Сегодняшняя metadata не
подменяет исторические условия. MOSCOW UTC+03 — время candle begin/end.

## Контракт

- Только новый отсутствующий output-каталог с существующим parent; никакого
  overwrite, resume, миграций или доступа к прежней базе.
- Пагинация отдельно по московским 2025/2026 годам; локальная последняя дата
  запроса включает 27.09 для UTC boundary tail. Затем строгий фильтр исходного
  UTC `[from,to)`, с явным учётом исключённых boundary rows.
- Raw fetch response entity bytes сохраняются до JSON-разбора. Redirects,
  чужой endpoint, неуспешный HTTP и malformed response запрещены.
- Каноническая минута; end=begin+59s; OHLCV, безопасное целое volume, шаг
  цены, порядок и отсутствие дублей обязательны. Пропуски учитываются без fill.
- Пагинация заканчивается только EMPTY terminal page. Короткая непустая
  страница не доказывает окончания; первая успешная страница не доказывает
  полноты окна или биржевого календаря.
- Потолки: 2 000 запросов, 1 000 000 raw rows, 2 MiB на ответ, 256 MiB всего,
  кооперативный бюджет 15 минут. Просроченный результат не объявляется READY;
  синхронный filesystem I/O нельзя прервать точно в момент дедлайна. Поэтому
  это проверяемый elapsed-budget/no-late-success контракт, не OS hard-kill.
  Дополнительные retries/resume отсутствуют.
- Private file permissions; raw SHA+request+receivedAt в manifest. SHA
  каждого реального year manifest записывается в archive metadata и candle
  links. Это собственный request-window archive, не официальный annual ZIP.
- Новый DB содержит ровно две разрешённые исторические таблицы, DELETE
  journal, закрыт и проверен штатным immutable loader перед публикацией.
  Финально повторно проверяются все сохранённые raw/manifest bytes после
  последнего callback и неизменность проверенной DB. Partial capture остаётся
  неполным; READY нельзя сохранить при отказе. Late failure удаляет только
  созданный этой попыткой READY, не raw/DB/неизвестные sidecars.

## Локальное использование

Parent создаётся пользователем отдельно. Не выбирать существующий каталог
с данными и не запускать старый importer против оригинала.

```sh
npm run build
npm run history:capture:catalog -- --output /absolute/path/new-public-capture
npm run backtest:catalog -- --database /absolute/path/new-public-capture/history.sqlite --cost all
```

Окончательное имя databasePath берётся из успешного JSON capture, не
угадывается по наличию временных файлов. Публичные raw pages и локальные
исследовательские отчёты остаются вне Git; `.trading/` игнорируется.
Раздельные page retrieval times не доказывают атомарный биржевой snapshot.
OHLCV не доказывает bid/ask/глубину, доступный fill, торговый статус или
отсутствие аукционов. Все результаты development-only, admission false.

## Проверки и результат

Окончательная локальная проверка 03.10.2026: `npm run check` — 1 304 теста
в 75 файлах, `npm run build` — PASS, 36 Python-регрессий — PASS,
`git diff --check` — PASS. Независимое ревью повторило 133 связанных теста
(capture 68, CLI 20, immutable loader 45), сборку и diff-check; открытых
воспроизводимых P1/P2 нет.

Закрыты три найденные пограничные проблемы: поздний elapsed-budget отказ
удаляет только собственный READY; provenance повторно проверяется после
последнего observer; temporary/final sidecar guards используют lstat, включая
все шесть вариантов dangling symlink. Это проверка программного контракта,
не биржевой полноты, исполнимости или доходности. Реальный bounded capture
фиксируется отдельно после выполнения; пока его нет, полный рыночный экран
не объявляется выполненным.

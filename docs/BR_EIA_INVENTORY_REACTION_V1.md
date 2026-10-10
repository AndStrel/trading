# BR EIA inventory-release reaction v1 — frozen before outcome calculation

Research only; no live or sandbox orders. Hypothesis: the first directional
reaction in MOEX Brent futures to the U.S. EIA Weekly Petroleum Status Report
contains information that continues over the next hour. The signal is a
fixed event response, not a fitted threshold or a claim that inventories have
a one-directional effect.

## Event calendar and release time

Use EIA's official Weekly Petroleum Status Report release archive and release
schedule. Event dates below are the archived publication dates. Standard
releases use 10:30 a.m. America/New_York; use the exact posted U.S. Eastern
time for the listed 2025/2026 holiday exceptions. To avoid uncertainty about
publication occurring *after* the scheduled minute, start the signal only
five minutes after scheduled release time. Convert from
`America/New_York` to `Europe/Moscow` using IANA time zones.

2024 included standard-time events only; exclude archive-boundary Jan 4 and
all dates shifted by U.S. holidays / disruption: Jan 18, Feb 22, May 30,
Jun 20, Sep 5, Oct 17, Nov 14, Dec 27.

2025 events: Jan 2 (11:00), Jan 8, 15, 23 (12:00), 29; Feb 5, 12, 20
(12:00), 26; Mar 5, 12, 19, 26; Apr 2, 9, 16, 23, 30; May 7, 14, 21,
29 (12:00); Jun 4, 11, 18, 25; Jul 2, 9, 16, 23, 30; Aug 6, 13, 20,
27; Sep 4 (12:00), 10, 17, 24. All unmarked events are 10:30 Eastern.

2026 events in archive: Mar 25; Apr 1, 8, 15, 22, 29; May 6, 13, 20,
28 (12:00); Jun 3, 10, 17, 24; Jul 1, 8, 15, 22, 29; Aug 5, 12, 19,
26; Sep 2, 10 (12:00), 16, 23. All unmarked events are 10:30 Eastern.

Only the release dates and exceptions above are eligible; no substitute dates
or event-time changes after inspecting prices. The official EIA archive is
https://www.eia.gov/petroleum/weekly/ and the official release schedule is
https://www.eia.gov/petroleum/supply/weekly/schedule.php .

## Fixed signal and execution

For each event, after the five-minute publication guard, require all five
consecutive MOEX RFUD BR one-minute candles. Signal return is the fifth
candle's close divided by the first candle's open, minus one. Positive means
long; negative means short; exact zero means cash. There is at most one
attempt per report. Enter at the open of the next scheduled tradable minute.
If an anchor/entry is missing or no scheduled same-day exit path exists, keep
the event in the audit and do not infer a price.

Use the unmodified BR bracket already tested in the late-session study: stop
0.80% adverse and target 1.50% favorable from entry. Check each candle from
entry through the 60th holding minute; on a same-minute double touch, stop
wins. An adverse stop gap fills at the worse of stop/open; a target fills no
better than its level. If neither is hit, exit at the open 60 minutes after
entry. No overnight holding, leverage, scaling, or second signal.

Investor futures commission is 0.10% of contract ruble value per side. Base
adverse slippage is 0.05% per side; stress is 0.10% per side. Apply the same
costs multiplicatively as the existing BR studies. Returns on quoted BR
price are only a directional screen, not exact ruble P&L or evidence of
execution.

## Admission screen

Report every event status, signal, entry, exit, side, year, contract and exit
reason; summarize base/stress net wins, mean, profit factor, aggregate and
aggregate without the best trade. Screen requires at least 100 completed
trades on 50 distinct dates, zero missing/cancelled/unresolved attempts,
at least 51% base-net winners, positive base and stress means, profit factor
above one, positive aggregate without the best trade, and positive base mean
in each year and exact contract. Any failure rejects this exact rule; do not
retune on the event dates. Even a pass is only a candidate for genuinely
forward validation with contemporaneous bid/ask, fills, RUB commission and
margin accounting.

This is exploratory data reuse: the underlying BR years have been used for
other research, and 2026 is not an untouched holdout. No event price outcomes
were calculated before this protocol was written.

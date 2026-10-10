# Si post-clearing gap fade — historical-session test v1

This is an exploratory test of a real historical mechanism on previously
studied data, not an independent holdout. It was registered only after a
separate 2026 attempt was invalidated because that period no longer had the
clearing pause. The 2026 metrics are explicitly excluded from this test's
design and evaluation; all signal and exit parameters below are carried over
unchanged from the original frozen rule.

## Frozen data universe

Use the existing hash-checked public MOEX ISS RFUD one-minute snapshots in
`.trading/si-opening-breakout-v1/`. The archive contains 232 weekday snapshots
spanning 2023-07-03–2023-12-08 and 2024-07-01–2024-12-10; the sorted filename
and compressed-byte SHA-256 inventory digest was frozen as
`bcffb767570bf75bd61c922494dd80d15739563773cb600dd0cd5532498ca5a3` before
calculating this strategy's outcomes. Each page's embedded SHA-256 must also
validate. Do not fetch or replace any source file.

Use SiU3 through 2023-09-08, SiZ3 from 2023-09-11; SiU4 through 2024-09-10,
SiZ4 from 2024-09-11. Evaluate the 10:00–17:00 Moscow-time archive window.
2024-11-04 is a verified no-trading day. Exclude the separately scheduled
holiday session 2023-11-06 from the ordinary-weekday sample. Any other date
without an official no-session classification is missing data, not an
assumed holiday. The historical intermediate clearing pause from 14:00 to
14:05 existed in this period; it was cancelled when MOEX moved to continuous
trading on 2026-03-23.

## Rule — unchanged

For each included session compare `open(14:05)` with `close(13:59)`. If the
reopen gap is positive, short Si; if negative, go long; if exactly zero,
remain in cash. The signal is available at 14:05; enter at the next minute's
open, 14:06. No threshold or parameter search.

Use a 0.50% adverse stop and 1.50% favorable target from entry. Check the
14:06 candle onward through 16:54. If both thresholds touch in one minute,
count the stop first. A stop crossed adversely at the minute open fills at
that worse open; otherwise fill at the stop. A target fills at its level,
never better. If neither barrier is touched, exit at the 16:55 open. Missing
required signal, holding, or exit data stays explicit as missing/cancelled/
unresolved. Do not hold overnight.

## Costs and gate

Use `siTradeReturn`: Investor futures commission 0.10% of notional per side;
base adverse slippage 0.05% per side; stress slippage 0.10% per side. Net is
on full quote notional, not guarantee deposit. Minute OHLC does not prove
executable bid/ask fills, market impact, margin safety, tax, or account P&L.

Report all statuses, trades, exit types, net winners, mean/sum, profit factor,
by year and contract, and results without the best trade. The development
gate is at least 100 completed trades across 50 dates, zero unresolved
attempts, >=51% base-net winners, positive base and stress means, PF > 1,
positive sum without the best trade, and positive base mean in both years and
all contracts. Failure rejects this exact rule; do not tune it on these
dates. Passing would permit only an untouched-period check and executable
quote/fill validation, never live trading.

Sources: [MOEX historical 14:00–14:05 clearing pause](https://www.moex.com/n12165?nt=106),
[MOEX switch to uninterrupted trading from 2026-03-23](https://www.moex.com/ru/derivatives/unified-trading-session),
[MOEX 2023 calendar](https://www.moex.com/n51887),
[MOEX 2024 calendar](https://www.moex.com/n64121).

# BR first-hour reversal (2024–2025) — exploratory protocol

Protocol frozen before calculating this rule's historical returns on 2026-09-29.
This is a read-only research experiment, not an order instruction.

## Selection warning

This direction transfer was selected after the separate BR first-hour
continuation rule failed in 2026. It is therefore exploratory, not an
independent hypothesis or holdout. These older years may also overlap prior BR
research. A favorable result would require genuinely untouched-period and
execution validation; it cannot establish profitability by itself.

## Data and session eligibility

Use only the already archived exact-contract MOEX ISS RFUD one-minute OHLCV
snapshots for 2024-01-03–2024-09-25 and 2025-03-24–2025-09-25, 10:00–17:00 MSK.
Contracts are those fixed in each source manifest; never stitch contracts.
Exclude the 2024-04-27 special session regardless of outcome. Official
no-session dates remain in the accounting as `no_session`; absent snapshots
are not fetched or imputed. Hash and report both source manifests and the
protocol before calculating outcomes.

## Rule

Require every minute from 10:00 through 10:59. At 11:00 calculate
`close(10:59) / open(10:00) - 1`. A positive return means short; a negative
return means long; exactly zero means cash. Enter at the 11:01 open. Missing
entry is `cancelled_entry`.

Exit at the first 0.80% adverse stop, or at the 16:55 open if no stop occurred.
There is no profit target. Examine entry-minute onward through 16:54, skipping
the known clearing break 14:00–14:04 (no synthetic bars). Stop is tested on
OHLC and a gap through the stop fills at the worse of stop or that minute's
open. A missing required minute before stop/time exit is unresolved; do not
forward-fill. Stop has priority where OHLC ambiguity applies. No position
spans a date or contract.

Costs use the repository's futures screening proxy: 0.10% commission per side,
0.05% slippage per side (base) and 0.10% per side (stress), deducted from
quote-normalized returns. This is not exact ruble P&L and minute OHLC does not
prove executable bid/ask fills.

## Admission gate

Report every session disposition, missing/incomplete history, attempts,
unresolved/cancelled positions, trades, exits, contract/year/side breakdown,
base/stress win rate and mean, total, profit factor, and total excluding the
best date. The exact rule fails development admission if any unresolved
attempt exists or if fewer than 100 trades/50 dates, base win rate <51%, base
or stress mean <=0, profit factor <=1, total excluding best date <=0, or any
year is non-positive. No retuning on these outcomes.

# Si prior-session liquidity sweep fade v1 — frozen before calculation

Research only. Hypothesis: traders' stops clustered just beyond the previous
ordinary session's high/low can be swept and then price can reverse back into
the prior range. This is an exploratory SMC-style mechanism on **previously
studied** historical prices, not an independent holdout. Do not use any
results from the invalidated 2026 clearing-gap attempt to select or tune this
rule.

## Fixed data and calendar

Use only the existing 232 compressed, hash-checked MOEX ISS RFUD 1-minute
snapshots in `.trading/si-opening-breakout-v1/`; the sorted filename plus
compressed-byte SHA-256 inventory digest must equal
`bcffb767570bf75bd61c922494dd80d15739563773cb600dd0cd5532498ca5a3`.
Each embedded page hash must validate; do not download or replace source data.
The archived periods are 2023-07-03–2023-12-08 and
2024-07-01–2024-12-10, ordinary weekdays only. Contracts: SiU3 through
2023-09-08, SiZ3 from 2023-09-11; SiU4 through 2024-09-10, SiZ4 from
2024-09-11. Never compare or trade across a contract change. Exclude the
special holiday session 2023-11-06; 2024-11-04 is a verified no-session date.

Use the immediately previous eligible ordinary session on the same contract
as reference. Its 10:00–16:59 session must contain every expected minute
except the scheduled 14:00–14:04 clearing break (415 candles total). If not,
the next day has `missing_reference`; do not fall back to an older session.
The first archived session for each contract is `warmup` because its previous
session is outside the frozen archive; warmup dates are not signal trials.
Only use the fixed 10:00–15:30 signal window. All times are Moscow time.

## Signal and execution

Let `prevHigh` and `prevLow` be the reference session's high and low. Scan
each current-session minute chronologically. The first qualifying event on a
date is the only attempt:

- **High sweep, short:** current minute high is at least one 1-RUB tick above
  `prevHigh`, and that minute closes strictly below `prevHigh`.
- **Low sweep, long:** current minute low is at least one tick below
  `prevLow`, and that minute closes strictly above `prevLow`.

If both conditions occur in the same minute, mark the date ambiguous and do
not trade. If both occur in different minutes, take only the first in time.
Enter at the next scheduled tradable minute's open. The scheduled 14:00–14:04
clearing break is skipped: a 13:59 signal enters at 14:05 open. Any other
missing next scheduled candle is a cancelled attempt. If that entry is
already at/beyond the planned stop, also cancel; do not skip to a later signal.

Stop is one 1-RUB tick beyond the signal candle's swept extreme. Risk is the
absolute entry-to-stop distance. Target is exactly 2R from entry. Check the
entry minute onward through 16:54; if stop and target touch within the same
minute, stop wins. A stop crossed adversely at a minute open fills at the
worse open; otherwise at the stop. Target fills at its level, never better.
If neither barrier is reached, exit at the 16:55 open. The 14:00–14:04
clearing break is skipped during signal and holding scans and is not a
missing-price interval. Any other missing required holding or exit candle is
unresolved; do not infer a fill. One trade maximum per session, no overnight
holding, no leverage or scaling.

## Costs and decision gate

Reuse `siTradeReturn`: Investor futures commission 0.10% per side, base
adverse slippage 0.05% per side, stress slippage 0.10% per side. Returns are
on full notional, not guarantee deposit. OHLC stop/target fills are a
simulation, not executable bid/ask evidence.

Report every status, signal and trade; stops, targets, time exits; long/short;
year and contract; base/stress net win rate, mean, profit factor, sum, and sum
without the best trade. Development admission requires at least 100 completed
trades on at least 50 dates, zero missing-reference/missing-signal dates,
cancelled/ambiguous entries, or unresolved holdings,
>=51% base-net winners, positive base and stress mean, profit factor >1,
positive aggregate without the best trade, and positive base mean in both
years and every contract. Otherwise reject this exact rule; do not retune on
these observations. Passing would permit only a prospective/untouched-period
check and executable quote validation, not live orders.

Sources: [MOEX historic 14:00–14:05 clearing pause](https://www.moex.com/n12165?nt=106),
[MOEX 2023 holiday calendar](https://www.moex.com/n51887),
[MOEX 2024 holiday calendar](https://www.moex.com/n64121).

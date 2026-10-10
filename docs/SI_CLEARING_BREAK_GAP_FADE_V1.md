# Si post-clearing gap fade v1 — frozen before calculation

Research only; no orders. This is an exploratory test on previously studied
2026 Si history, not an independent holdout. Hypothesis: a price gap observed
when MOEX RFUD resumes after its scheduled 14:00–14:05 clearing break is
partly temporary and fades during the afternoon.

## Data and dates

Use only the sealed exact-contract MOEX ISS RFUD 1-minute Si archive for
2026-03-23 through 2026-09-25. Source-report SHA-256 must equal
`ed8c32be0f099e8caeb8d773b6edaa7cac08e397c326fe2135ba810e56c36b74`.
Use the existing calendar-to-contract map. Exclude the fixed special-session
dates 2026-05-01 and 2026-06-12. The scheduled 14:00–14:05 non-trading break
is not treated as missing holding data.

## Signal and execution

For each ordinary weekday require the 13:59 candle, the first post-break
14:05 candle, the 14:06 entry candle, every minute from 14:06 through 16:54,
and the 16:55 time-exit candle. Define the clearing gap as
`open(14:05) / close(13:59) - 1`. If positive, short Si; if negative, go long;
if exactly zero, remain in cash. No gap threshold or parameter search. Signal
is available at the 14:05 open; enter at the next minute's open, 14:06.

Use a 0.50% adverse stop and 1.50% favorable target from entry. Check the
14:06 candle onward through 16:54. If stop and target both touch in one
minute, count the stop first. A stop crossed adversely at the minute open
fills at that worse open; otherwise fill at the stop. A target fills at its
level, never at a better price. If neither barrier is touched, exit at the
16:55 open. Any missing required holding/exit candle is unresolved, not a
win. Do not hold overnight.

## Costs and decision gate

Reuse `siTradeReturn`: Investor futures commission 0.10% of notional per
side, base adverse slippage 0.05% per side, stress slippage 0.10% per side.
Return is on full quote notional, not guarantee deposit. Minute OHLC is not
executable bid/ask or fill evidence; market impact, margin, tax, and actual
account P&L are unknown.

Report all dates/statuses, trades, exits, net winners, mean/sum, profit
factor, by-contract and March–May / June–September blocks, and performance
without the best trade. Discovery admission requires at least 100 completed
trades on 50 dates, zero unresolved attempts, at least 51% base-net winners,
positive base and stress means, profit factor above one, positive sum without
the best trade, and positive mean in both blocks. Failure rejects this exact
rule; no retuning on the same 2026 archive. Even a pass would require an
untouched period and executable quote/fill validation before any live use.

References: [MOEX RFUD clearing schedule](https://www.moex.com/n12165?nt=106),
[MOEX unified derivatives schedule](https://www.moex.com/ru/derivatives/unified-trading-session).

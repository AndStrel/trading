# BR five-minute shock fade v1 — fixed-cost screen

## Hypothesis and frozen rule

Short bursts in an actively traded crude-oil future can temporarily overshoot available liquidity; fading an unusually large five-minute move may capture its partial reversal. This is a new exploratory hypothesis. Existing BR strategy outcomes are known, but no prior report tested this fixed trigger-and-exit rule. The test is a development screen across the available histories, not a clean prospective validation.

Use one-minute OHLC candles for exact monthly BR contracts on MOEX RFUD. For each regular session, require every minute from 10:00 through 12:59. Starting at 10:00, inspect consecutive, non-overlapping five-minute blocks (10:00–10:04, 10:05–10:09, etc.) through 12:55–12:59. Select the first block whose close(ending minute)/open(starting minute) move has absolute magnitude of at least 0.40%. Enter at the next minute's open in the opposite direction. At most one entry per session. If no block qualifies, stay in cash. If the next-minute open is missing, count a cancelled entry.

From entry minute through the next 29 minutes, check a 0.30% adverse stop and a 0.60% favorable target. If both are touched in the same minute, resolve to the stop. For a stop gap, fill at the worse of the threshold and that minute's open; fill a target no better than its threshold. If neither level is hit, exit at the open 30 minutes after entry. Any missing required candle after entry is unresolved; do not interpolate it. The last eligible signal window ends at 12:59, so the 30-minute exit does not cross the scheduled 14:00–14:04 clearing break.

Apply the repository's tested BR futures assumptions: commission 0.10% per side; base adverse slippage 0.05% per side; stress adverse slippage 0.10% per side. This is percent of entry notional, not return on margin or ruble account P&L. Candle OHLC cannot prove bid/ask fills, queue, market impact, taxes, or variation margin.

## Data lock and evaluation

Use 2025-03-24–2025-09-25 and 2026-03-23–2026-09-25. The report hashes before calculation are:

- 2025 MOEX source report: `0accb82bf1f5ac7808df713620cab57a4217e440d9a369f4817c863476f95969`.
- 2026 MOEX source report: `d8721ce74334619fc1c7f6f960a85d6e77e7ddcb050958163a9b9d8081caf57a`.

The predeclared no-session dates are 2025-05-01, 2025-05-09, 2025-06-12 and 2026-05-01, 2026-06-12. For this screen, exclude all other dates with incomplete 10:00–12:59 signal coverage and report the count by year. Preserve cancelled and unresolved trades as failures of data sufficiency.

Report eligible sessions, coverage gaps, cash dates, entries, unresolved/cancelled paths, completed trades, long/short, target/stop/time exits, gross/base/stress win rates, means, total returns, profit factor, and return without the best trade, both overall and by year. Require at least 100 completed trades on at least 50 dates, zero cancelled and unresolved entries, at least 51% base-net profitable trades, positive base and stress means overall and in each year, profit factor above 1, positive base total after removing the best trade, and at least 90% signal coverage in each year. A failure rejects this fixed rule; do not tune it on the same data. A pass would only justify prospective collection and untouched-period plus executable-fill validation, not live orders.

References: [MOEX ISS](https://www.moex.com/a2920), [T-Invest tariff guide](https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/).

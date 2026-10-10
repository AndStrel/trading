# Si from Brent first-hour lead v1 — protocol before outcome inspection

Fixed on 2026-09-26 before inspecting the paired Si/BR strategy returns. This
is an offline, read-only intraday experiment, not an order instruction.
Hypothesis: an early rise in USD Brent can precede ruble strengthening,
and an early fall can precede ruble weakening. This economic link is uncertain
and may fail, reverse, or be overwhelmed by other news. Trade only Si; BR is
an observable external signal, not a second position.

## Sources and eligible dates

Use public MOEX ISS RFUD one-minute candles, 10:00–17:00 MSK, from the
already sealed local archives. Ordinary weekdays 2026-03-23 through
2026-09-25 are eligible. Exclude the known special sessions 2026-05-01 and
2026-06-12 regardless of outcome. Select SiM6 through 2026-06-10, SiU6
2026-06-11 through 2026-09-10, and SiZ6 thereafter. Use the BR monthly
contract fixed by calendar month: March BRJ6, April BRK6, May BRM6, June
BRN6, July BRQ6, August BRU6, September BRV6. Do not stitch price levels
between contracts.

Locked source-report SHA-256 values before the paired calculation:

- Si: `ed8c32be0f099e8caeb8d773b6edaa7cac08e397c326fe2135ba810e56c36b74`
- BR: `d8721ce74334619fc1c7f6f960a85d6e77e7ddcb050958163a9b9d8081caf57a`

Both source archives preserve raw pages and their hashes. Require every
BR 10:00–10:59 minute for the signal and every Si minute needed through
exit. Missing data cause cancelled/unresolved attempts, not inferred fills.
The two BR dates with later missing minutes (2026-07-03 and 2026-08-31) are
not excluded if the *first hour* BR signal is complete; BR is not traded.

## Signal and simulated execution

At 11:00 calculate `BR close(10:59) / BR open(10:00) - 1`. If BR rose,
short Si; if BR fell, long Si; if BR is exactly unchanged, remain in cash.
No magnitude threshold, parameter search, or use of Si's own first-hour
return. Enter Si at 11:01 minute open. One decision and at most one Si
position per ordinary date. Missing entry is a cancelled attempt.

Stop at 0.50% adverse from the Si entry quote; take profit at 1.00%
favorable. From the entry minute, check Si OHLC in order. If stop and target
both touch within the same minute, count the stop first. Stop fill is no
better than its level and worsens to that minute's open for an adverse gap.
Target fill is its level, never better. If neither hits, exit at the exact
16:55 minute open. Missing holding or exit minute is unresolved. No
overnight positions, leverage, or guaranteed stop execution assumed.

Investor futures broker commission: 0.10% of Si notional per side. Base
slippage: 0.05% per side; stress: 0.10% per side. Apply commission to modeled
execution fills; divide Si ruble-equivalent P&L by full entry notional, not
guarantee deposit. The Si quote has a fixed 1-ruble tick value; historical
spreads, market impact, actual fills, margin calls, and taxes remain
unmeasured by minute candles.

## Report and gate

Report all eligible decisions, cash days, signals, cancelled/unresolved
attempts, trades, stop/target/time exits, long/short and contract/month
splits, base/stress net winners, mean, sum of trade returns, profit factor,
and result without the best date and best month. Cash dates count as zero
in portfolio-level analysis. A development candidate requires at least
100 completed trades on 50 dates, zero unresolved/cancelled attempts,
at least 51% base-net winners, positive base and stress mean, profit factor
above one, positive total without the best date and best month, and positive
base mean in both March–May and June–September blocks. A passing result
permits only an untouched independent-period check and executable-order
audit; it never authorizes live trading.

References: [MOEX Si specification](https://www.moex.com/a3873),
[MOEX BR specification](https://www.moex.com/ru/derivatives/commodity/oil/),
[T-Invest tariff](https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/).

# Si opening-compression breakout v1 — protocol before outcome inspection

Fixed on 2026-09-26. This is a read-only intraday research experiment, not an
instruction to place an order. Its mechanism differs from the rejected
first-hour continuation: it waits for a *later breakout* from a compressed
opening range, rather than entering in the direction of the first-hour close.
The thresholds below are hypotheses, not values fitted to 2023–2024 returns.

## Period and source

Use Moscow weekdays 2023-07-03 through 2023-12-08 and 2024-07-01 through
2024-12-10, inclusive. Use SiU3 through 2023-09-08, SiZ3 from 2023-09-11;
SiU4 through 2024-09-10, SiZ4 from 2024-09-11. Do not cross a contract or
calendar day. Download exact-contract one-minute OHLCV from public MOEX ISS
RFUD, 10:00–17:00 MSK, preserving raw responses and SHA-256 hashes. Require
complete 10:00–10:59 history and strictly increasing unique timestamps.
Unknown no-candle dates are data gaps until a published exchange calendar
verifies a non-trading session. Never infer prices from adjacent minutes.

## Decision and simulated execution

At 11:00 calculate opening high, low, and range `(high-low)/open(10:00)`.
Trade only if range is at most 0.60%. From 11:00 through 13:59 inclusive,
take the first minute whose **close** is at least `high * 1.0005` (long) or
at most `low * 0.9995` (short). If both somehow occur on one minute, skip the
date as ambiguous. Enter at the following minute's open; a missing following
open is a cancelled attempt, not a fill. At most one attempt per date.

Stop is 0.70% adverse from the entry quote; take-profit is 1.00% favorable
from the entry quote. Inspect OHLC from the entry minute onward. If both
thresholds occur inside one minute, count the stop first. For a triggered
stop, use the worse of the stop and that minute's open; for a triggered target,
use the target, never a better price. Otherwise exit at the 16:55 minute open.
Missing mandatory exit data is unresolved and blocks admission. All positions
close during the same day; no overnight exposure or leverage is assumed.
Minute candles do not prove actual queue position or stop execution.

Investor futures commission: 0.10% of notional per side. Base slippage:
0.05% per side; stress: 0.10% per side. Apply commission to execution fills
and calculate net return on full entry notional using the already-tested
`siTradeReturn` convention. This is not return on guarantee deposit. Historical
spread, market impact, financing, taxes, and broker-specific fill behavior
remain unmeasured; a positive candle replay alone cannot authorize live use.

## Predeclared evaluation

Report all weekdays, no-session days, source gaps, complete decisions,
signals, cancelled/unresolved attempts, trades, stop/target/time exits, each
year and contract, long/short, base/stress net win rate, mean, total trade
returns, profit factor, and result without the best day. Count no-trade days
as cash for portfolio analysis. A candidate requires at least 100 complete
trades on 50 dates, zero unresolved attempts, at least 51% net winners,
positive base and stress mean, profit factor above one, positive aggregate
after removing the best day, and positive mean in each year and contract.
Passing this *development* gate would still require a separate untouched
period, execution-quality audit, and risk limits before real trading.

References: [MOEX ISS](https://www.moex.com/a2920),
[T-Invest futures tariff](https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/).

## Data-calendar clarification after the first full run

The original protocol SHA-256 was
`da5c2c025f0e900b6f16735b9142574a072ebba10dd27b6476161ac2c11180bf`.
The first run found that **every one of the 232 date snapshots** lacks
14:00–14:04 candles. [MOEX states that the futures market has a scheduled
14:00–14:05 interim clearing break](https://www.moex.com/n12165?nt=106).
Those five minutes are therefore exempt from the continuous holding-candle
requirement. No stop/target can be inferred *inside* that non-trading break;
the first available 14:05 minute is checked as usual, with an adverse gap
through a stop filled no better than its open. All other missing minutes
remain unresolved. This clarification was made after observing the first
aggregate report and may affect trade outcomes; the amended result is
exploratory, **not independent validation**. The entry and risk thresholds
remain unchanged.

The first run also found zero candles on 2024-11-04. [MOEX confirms that
3–4 November were non-trading days](https://www.moex.com/n74370), so this
date is classified as a verified no-session day. This changes no trade PnL.
The missing 10:00–10:59 minute on 2023-09-13 remains an unresolved data gap.

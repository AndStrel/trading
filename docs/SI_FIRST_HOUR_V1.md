# Si first-hour continuation v1 — protocol before outcome calculation

Fixed on 2026-09-26 before inspecting candidate returns. This is a read-only,
no-leverage, intraday research experiment, not an order instruction. No 2026
outcomes may be used to change this v1 rule.

## Mechanism and scope

Hypothesis: a material first-hour move in the liquid USD/RUB futures contract
persists during the main session often and far enough to pay trading costs.
This is uncertain; the null is no positive net advantage. Use only weekdays
from 2025-07-01 through 2025-12-10 inclusive. Select `SiU5` through
2025-09-10 and `SiZ5` from 2025-09-11. No positions span dates, contracts,
or expiration. Both contracts are cash-settled, but their guarantee deposits
and variation-margin mechanics require separate risk audit before any live use.

Source: public MOEX ISS RFUD one-minute OHLCV candles for each exact contract.
Paginate until an empty page, retain source hashes, validate strictly increasing
unique timestamps, OHLC bounds, nonnegative volume, and contract/date mapping.
Do not stitch contract price levels or use data from the other contract to set
today's signal. Moscow timestamps are Europe/Moscow UTC+03 in this period.

## Signal and model execution

At 11:00 MSK require all 60 completed minutes 10:00–10:59 for that day's
contract. First-hour return is `close(10:59) / open(10:00) - 1`. If it is at
least +0.3%, take one long; if at most −0.3%, take one short; otherwise stay in
cash. One decision and at most one position per day. No parameter search.

Enter at the exact 11:01 minute open and exit at the exact 17:00 minute open.
Missing entry is a cancelled attempt; missing exit is an unresolved position.
Both are reported and block admission. Do not forward-fill, infer a fill from
high/low, or exclude a signal because of a future halt. The event study has no
intraday stop; therefore even a positive result is not an executable strategy
until a separately specified risk-controlled replay is validated. No overnight
positions, margin leverage, or assumption of a guaranteed close price.

Published Investor-tariff futures commission is modeled as 0.10% of contract
notional on each side. Base slippage is 0.05% of quote on each side; stress is
0.10% on each side. For long: buy at `entry*(1+slippage)`, sell at
`exit*(1-slippage)`. For short: sell at `entry*(1-slippage)`, buy at
`exit*(1+slippage)`. Subtract `commission*(abs(entry_fill)+abs(exit_fill))`;
divide PnL by entry quote notional. This is return on full notional, not on
the smaller blocked guarantee deposit. A counterfactual zero-cost result may
be shown for decomposition, never as the primary result. Historical spread,
market impact, actual order fills, funding/variation margin, and taxes are
not measured by minute candles.

## Report and gate

Report all eligible decisions, signals, cancelled/unresolved attempts, full
trades, long/short split, each contract and month, base/stress net win rate,
mean net, mean win/loss, profit factor, sum net, and result without the best
date and best contract. Show exact source coverage and hashes. Calendar days
with no signal count as cash days in any portfolio-level analysis.

The development result is only worth independent checking if there are at
least 100 completed trades on 50 distinct dates, no unresolved attempts,
at least 51% net winners, positive mean and sum net, profit factor > 1,
positive stress mean, and positive sum after removing the best date and after
removing either contract. The same economic gates must hold separately before
and after the predetermined contract change; if sample size is insufficient,
the result is unconfirmed, not profitable. These gates do not correct for
prior project experiments or establish live-trading suitability. A passing
development result permits only a sealed 2026 test and risk-control design.

References: [MOEX ISS](https://www.moex.com/a2920), [broker futures costs and
margin mechanics](https://www.tbank.ru/invest/help/brokerage/account/forts/trade-futures/).

## Dated data-quality clarification after first run

The first run found zero candles on 2025-11-04. [MOEX's published schedule](https://www.moex.com/n94881)
confirms that no exchange trading occurred that day. It is therefore recorded
as `no_session`, not an unexplained data outage. This clarification was made
after viewing the first aggregate outcome; it changes no signal, entry, exit,
or PnL. Any other weekday with zero candles remains an unresolved data gap.
The pre-clarification protocol SHA-256 recorded by the first run was
`6c6cfdb643d8d86ad7c962066d07cc33f20d4bf946eb5b4a62dcf1e53e3de892`.

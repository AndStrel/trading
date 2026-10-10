# BR first-hour continuation with risk controls — protocol before returns

Fixed on 2026-09-26 **before calculating BR strategy outcomes**. This is a
read-only intraday research experiment, not an order instruction. Hypothesis:
Brent's first-hour direction reflects information that continues during the
regular session often and far enough to cover realistic costs. The null is no
positive net advantage. No parameter search or post-result threshold change
is allowed under this v1 label.

## Source, calendar, and contract rule

Use the already archived public MOEX ISS RFUD one-minute OHLCV for calendar
weekdays 2026-03-23 through 2026-09-25, 10:00–17:00 MSK. Use the nearest
monthly BR contract fixed by calendar month: March BRJ6, April BRK6, May
BRM6, June BRN6, July BRQ6, August BRU6, September BRV6. Do not stitch
prices across contracts. The two known special weekend-style sessions on
2026-05-01 and 2026-06-12 are reported separately and excluded from this
ordinary-session rule, regardless of their outcomes. Source report SHA-256
before strategy inspection:
`d8721ce74334619fc1c7f6f960a85d6e77e7ddcb050958163a9b9d8081caf57a`.
The archive has 133 ordinary sessions, 131 with all 421 minutes; 2026-07-03
and 2026-08-31 are incomplete and must not be silently discarded.

## Signal, execution, and risk

Require all 60 completed one-minute bars from 10:00 through 10:59. At 11:00
compute `close(10:59) / open(10:00) - 1`. If positive, take one long; if
negative, one short; if exactly zero, remain in cash. Enter at 11:01 minute
open, never at the 10:59 close. One decision and at most one position per
ordinary session. A missing entry is a cancelled attempt.

From the entry minute onward, exit at the first of: a stop 0.80% adverse from
the entry quote, a target 1.50% favorable from the entry quote, or the 16:55
minute open. Trigger stops and targets from the minute OHLC. If both are
touched within one minute, count the stop first. A stop fill is no better
than its level and is worsened to that minute's open if the market gaps
through it. A target fill is its level, never a better price. Any absent
minute before an exit makes the attempted trade unresolved; do not forward
fill or exclude it from the attempt count. No position spans a date or
contract. No leverage, guaranteed stop execution, or fill at the quote is
assumed.

Investor-tariff broker commission is modeled at 0.10% of notional per side.
Base slippage is 0.05% of quote per side; stress slippage is 0.10% per side.
Apply commission to modeled execution prices and report returns relative to
full entry quote notional, not guarantee deposit. This quote-normalized
measure is a **screening proxy**, not an exact ruble P&L: BR is quoted in USD
per barrel and its ruble tick value varies with the indicative USD/RUB rate.
Historical tick value, broker fee rounding, actual spread/market impact,
margin calls, and taxes are not established by these minute candles.

## Gate

Report all ordinary/special sessions, complete/incomplete history, cash
decisions, signals, cancelled/unresolved attempts, completed trades,
stop/target/time exits, each month/contract and side, base and stress net
win rate, mean, total trade returns, profit factor, and result without the
best date and best month. Zero trading days count as cash in portfolio-level
analysis. A development candidate requires at least 100 completed trades
on 50 distinct dates, zero unresolved/cancelled attempts, at least 51%
base-net winners, positive base and stress mean, profit factor above one,
positive total after removing the best date and the best month, and positive
base mean in both March–May and June–September blocks. A passing quote-proxy
result permits only independent-period validation plus historical ruble
tick-value and execution-quality audits. It does **not** authorize live
trading or establish the user's profitability goal.

References: [MOEX BR specification](https://www.moex.com/ru/derivatives/commodity/oil/),
[MOEX indicative variation-margin algorithm](https://fs.moex.com/f/22731/algoritm-rascheta-indikativnoy-varmarzhi.pdf),
[T-Invest futures tariff](https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/),
[T-Invest ruble tick value](https://www.tbank.ru/invest/help/brokerage/account/forts/variation-margin/).

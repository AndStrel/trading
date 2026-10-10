# Brent futures tariff sensitivity — 2026-09-29

This is a **post-result cost sensitivity**, not a new strategy test. Every
previously recorded entry, exit, direction, and unresolved decision stayed
unchanged. We applied 0.05% adverse slippage per side to each complete trade
and recomputed the existing quote-normalized futures return at several
commission rates. This omits any monthly tariff subscription, exact RUB
contract valuation/rounding, taxes, margin, and actual spread/fill quality;
therefore the cheaper cases are optimistic screening scenarios, not a
recommendation to change an account tariff.

| Frozen Brent rule | Trades | Winners at 0.04%/side | Mean at 0.04%/side | Winners at 0.025%/side | Mean at 0.025%/side | unresolved/cancelled |
|---|---:|---:|---:|---:|---:|---:|
| First-hour continuation, 2026 | 131 | 56 (42.7%) | −0.032% | 56 (42.7%) | −0.002% | 2 |
| First-hour reversal, 2024–25 exploratory | 216 | 78 (36.1%) | −0.207% | 79 (36.6%) | −0.177% | 39 |
| Five-minute shock fade | 122 | 38 (31.1%) | −0.187% | 38 (31.1%) | −0.157% | 0 |
| Overnight-gap continuation | 197 | 76 (38.6%) | −0.238% | 76 (38.6%) | −0.208% | 11 |
| Opening-compression transfer | 12 | 3 (25.0%) | −0.430% | 3 (25.0%) | −0.400% | 1 |
| Late-session momentum | 130 | 51 (39.2%) | −0.173% | 52 (40.0%) | −0.143% | 0 |
| EIA release reaction | 84 | 30 (35.7%) | −0.152% | 33 (39.3%) | −0.122% | 19 |

The standard lower-turnover Trader commission is 0.04% per side; its
instrument-list exception is 0.08%. The listed low-turnover Premium rate is
0.025% per side, with a 0.06% exception. The official tariff page also gives
lower rates only at higher daily turnover. Even the 0.025%/side scenario,
before any monthly service charge, leaves **every** rule below 51% net winners;
the reported mean remains negative for all seven. The next-cost scenarios
therefore do not rescue these specific rules, and cheaper fees alone are not
the missing predictive edge.

This does not rule out a different intraday mechanism. It does rule out
relabeling these already-tested Brent signals as viable merely by changing the
fee assumption. There were no broker calls or orders.

Official sources, checked 2026-09-29: [T-Invest account tariffs](https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/)
and [futures trading commissions](https://www.tbank.ru/invest/help/brokerage/account/forts/trade-futures/).

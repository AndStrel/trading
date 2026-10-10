# Si first-hour reversal v1 — fixed exploratory protocol

Fixed before evaluating this candidate's returns. Read-only research; no orders.
Hypothesis: the direction of Si's 10:00–10:59 move may be partly reversed
before the same day's close. This is distinct from the previously tested
first-hour continuation rule, but the 2026 source is already used for other
hypotheses and is **not an independent holdout**.

Use the sealed MOEX ISS RFUD exact-contract one-minute archive from
2026-03-23 through 2026-09-25. Exclude only the preidentified special
sessions 2026-05-01 and 2026-06-12. SiM6 through 2026-06-10, SiU6 through
2026-09-10, SiZ6 thereafter. Require all 60 signal minutes, the exact
11:01 entry and 16:55 exit minute, and every holding minute between them.
Missing data are cancelled or unresolved attempts, never inferred fills.

At 11:00 compare the 10:59 close with the 10:00 open. If positive, short
one Si contract; if negative, long one; if exactly zero, stay in cash.
Enter at the 11:01 minute open and exit at the 16:55 minute open, without
stop, target, overnight carry, or leverage. One decision per date. These
print proxies do not establish execution at those prices.

Investor futures commission: 0.10% of notional per side. Adverse slippage:
0.05% per side base and 0.10% per side stress. Net P&L is divided by full
entry notional. Report all attempted trades, data gaps, net winners,
mean/sum, profit factor, by-contract and quarterly blocks, and result
without the best date. Gate: at least 100 completed trades on 50 dates,
zero unresolved/cancelled attempts, at least 51% net winners, positive
base and stress means, profit factor above one, positive net sum without
best date, and positive base mean in both March–June and July–September.
Passing only warrants a later untouched-period and executable-price audit.

Source report SHA-256: `ed8c32be0f099e8caeb8d773b6edaa7cac08e397c326fe2135ba810e56c36b74`.
Broker fee and Si tick specification: [T-Invest tariffs](https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/), [MOEX](https://www.moex.com/a3873).

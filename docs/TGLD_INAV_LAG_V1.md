# TGLD lagging published RUB iNAV v1 — locked exploratory protocol

Fixed before the joint outcome calculation. Research only; **not an order
instruction**. TGLDB is MOEX's rub-denominated iNAV for TGLD, a closer
reference than GLDRUB_TOM but still a rounded indicative value and not a
guarantee of executable arbitrage. The hypothesis is that TGLD's return
since 10:00 lags a non-falling published iNAV and catches up before close.

Use exact public one-minute TGLD trade candles and TGLDB INAV candles for
the 133 ordinary weekdays 2026-03-23 through 2026-09-25. TGLD changes
board from TQTF to TQBR on 2026-06-22 as already fixed in its source reader.
The TGLD source report SHA-256 is
`1baacb89255d94003992d01cb0236924ea8963767b65cd87a3f0382dfca13210`;
the TGLDB source manifest SHA-256 is
`47704b65734c19f9ebd2b545bd035615b4fb9a219827bcab5f2add8fd7bc5abc`.
All raw pages are hash-checked when read. Exclude only dates lacking either
exact 10:00 **completed close** anchor; do not fabricate prices.

At each TGLD printed minute from 10:15 through 14:00, use the matching
completed TGLDB minute. `fundMove = fundClose/fund10Close - 1` and
`navMove = navClose/nav10Close - 1`. The first date-minute with
`navMove >= 0` and `navMove - fundMove >= 0.25%` is the sole long signal.
The threshold and windows match the earlier gold-lag test; no parameter is
tuned from the iNAV outcomes. Enter at the first TGLD trade-minute open
one or two minutes after the signal; if absent, cancel without retry.
Exit at the first trade-minute open 16:55–17:00, otherwise unresolved.
No short, stop, target, leverage or overnight position.

Model the favorable conditional first-15-applications zero TGLD broker fee,
0.10% adverse execution per side base and 0.20% stress; round buys up and
sells down to the 0.01 RUB observed grid. Compare at least 100 completed
trades/50 dates, zero cancelled/unresolved attempts, >=51% base-net winners,
positive base/stress means and positive both time blocks. A passing result
would still need an untouched period, live bid/ask and paper fills, account
fee verification, and **MOEX index-data usage rights** before any live use.
The 2026 TGLD price archive has already been studied, so this is not a fresh
holdout. The published minute timestamps do not prove when a retail client
could receive the data.

Sources: [MOEX TGLDB](https://www.moex.com/ru/index/TGLDB),
[T-Invest TGLD fee information](https://www.tbank.ru/invest/help/services/capital/about/how-to-invest/).

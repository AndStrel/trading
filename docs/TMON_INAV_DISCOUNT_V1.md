# TMON discount to published iNAV v1 — exploratory protocol before returns

Research only, no orders. Frozen after the iNAV **source-only** checkpoint and
before inspecting the joint TMON/iNAV signal outcomes. Hypothesis: an unusually
cheap TMON trade print relative to the most recently published TMONA iNAV may
partly revert before the same day's close. This is not guaranteed arbitrage:
iNAV is rounded to kopecks, usually static intraday, and may lag the value at
which a market maker would transact.

Use pre-cached public MOEX ISS TMON TQTF/TQBR one-minute trade candles and
TMONA INAV one-minute indicator candles for ordinary weekdays 2026-03-23
through 2026-09-25. Exclude only the preidentified special sessions
2026-05-01 and 2026-06-12. TMON source manifest SHA-256:
`1af6cf14621282f93be857d1ab06df9e269b64f53bb842691d93e82a81ddd521`.
TMONA source manifest SHA-256:
`e1508ad98f28aae499d187ffb34564b03911ea0f63099683187b9b177463102e`.
All raw pages must pass their stored hashes.

Between 10:15 and 14:00 MSK, at each TMON printed minute with a matching
TMONA minute, compare the **completed** TMON close to the completed iNAV close.
The first minute where `TMON close / iNAV close - 1 <= -0.0015` is the one
signal for that date. Enter long at the open of the first TMON printed minute
one or two minutes later. If absent, cancel and do not retry. Exit at the
open of the first printed minute between 16:55 and 17:00 inclusive. An
absent exit is unresolved; no stop, target, short, overnight carry or leverage.
The 0.15% threshold is above the modeled 0.10% base adverse round trip,
leaving 0.05% before tick rounding; it was **not** chosen from this sample.

Favorable conditional case: zero TMON broker commission (verify the exact
account/instrument quote before any real decision), 0.05% adverse execution
per side base and 0.10% stress, adverse rounding on the observed trade-price
grid. Both sides' fills are modeled from subsequent minute trade prints,
**not** historical bid/ask or actual broker fills. Report all 133 dates,
cash/signal/cancelled/unresolved counts, completed trade net-win rate, mean
and total base/stress returns, March–May versus June–September and result
without best five. Development gate: at least 100 completed trades on 50
dates, zero cancelled/unresolved attempts, at least 51% base net winners,
positive base/stress means and positive both blocks and best-five-removed
aggregate. A pass only warrants independent-period and live quote/paper-fill
checks. The 2026 TMON price archive has already been used in other research,
so this is not an untouched holdout.

References: [MOEX TMON iNAV](https://www.moex.com/a8503),
[T-Invest fund commissions](https://www.tbank.ru/invest/help/services/capital/about/how-to-invest/).

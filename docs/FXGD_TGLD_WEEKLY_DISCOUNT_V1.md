# Frozen protocol: FXGD vs TGLD weekly gold-vehicle discount v1

Research only; no orders. FXGD and TGLD are both gold-linked fund units on MOEX, not bullion.

Hypothesis: when FXGD’s close / TGLD close on the prior weekday is more than one robust-sigma below its trailing 252-session median, some of that **wrapper discount** mean-reverts over the next 20 weekday sessions. Long FXGD only; TGLD is the indicator. This is not PLZL-vs-TGLD miner lag, not TGLD buy-and-hold, and not a SBERP/SNGSP equity-preferred retune.

## Source

Public MOEX ISS daily `interval=24`. Probe TQTF then TQBR for FXGD (same probe as TGLD). TGLD uses the already frozen 2022–2025 snapshot. Scope 2022-01-01–2025-12-31. No 2026. Abort **before scoring** if FXGD 2023–2025 weekday counts are outside 150–400 in any year, or if aligned weekday calendars differ.

## Signal

Reuse `simulateWeeklySberpDiscount` with TGLD as the reference series and FXGD as the traded series. Same 252-session MAD rule, weekly first-weekday entry, 20-session exit, five-slot cap, Investor 0.3% + 0.05% slippage per side, stress 0.10%. Do not change windows after seeing results.

Windows: discovery 2023-01-01–2024-12-31 (entries only; ratios may use 2022); validation 2025-01-01–2025-12-31 via `from`; combined 2023–2025.

Controls: always-long FXGD weekly; FXGD buy-and-hold; TGLD buy-and-hold; SBMM buy-and-hold; all on 2023-01-01–2025-12-31.

## Gates

≥50 completed trades in ≥30 weeks (three-year gold wrappers; 100 may be infeasible if the discount rarely opens). Combined and each of discovery/validation: win rate ≥51%, mean net > 0, stress mean > 0, PF > 1 or all wins, without-best-five sum > 0, active-week win rate ≥51%, ending > 1_000_000. Each of 2023, 2024, 2025 with entries has mean net > 0; a year with zero entries fails. Combined ending must beat FXGD hold, TGLD hold, and SBMM hold over 2023–2025.

Do not reverse to buy FXGD when rich. Data-coverage abort is not a trading reject and does not authorize a different gold pair. No orders.

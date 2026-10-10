# Weekly SBERP reversal v1: discovery result

**SUPERSEDED: this initial run contained a look-ahead error. Do not use any performance numbers below as evidence.** The corrected temporal-integrity amendment and replacement result are in [WEEKLY_SBERP_REVERSAL_V1_AMENDED_RESULTS.md](WEEKLY_SBERP_REVERSAL_V1_AMENDED_RESULTS.md).

**Rejected in discovery; no real trades.** The rule was frozen before calculation in [WEEKLY_SBERP_REVERSAL_V1.md](WEEKLY_SBERP_REVERSAL_V1.md), SHA-256 `f19fb2607dec3e418cef07314660ef5b75c2c024b896e2b7ac8416d27a231444`. Source: MOEX ISS TQBR SBERP daily 2015–2025, 2,827 bars, row SHA-256 `099fbd5eae7e056a2aea986048792175a6bc5139264ffa65d037b908cd28631e`. Full machine-readable output: `.trading/weekly-sberp-reversal-v1.json`. No 2026 data were used.

Buying after a previous-week decline of at least 1.5% and selling at the following week's first open yielded **74 net-winning trades out of 145 (51.03%)**. Across all weeks with an entry, holding, or exit, **137 of 249 marked portfolio weeks (55.02%)** were positive. These are distinct denominators: a positive exit/entry week is not necessarily a profitable completed trade. Both observed fractions exceed 51%, but the strategy is not profitable or robust enough to meet the full research gate.

With modeled 0.3% commission and 0.05% slippage on each side, mean net per completed trade was only **+0.022%**, profit factor 1.014; removing the five best trades makes the sum **−45.97 percentage points**. With 0.1% slippage per side, mean trade return is **−0.078%**. The modeled portfolio ended at **₽0.903m from ₽1m**, with a **54.12% peak-to-trough drawdown**. The positive arithmetic mean of trades coexists with a negative compounded portfolio outcome because losses and gains are asymmetric; a 51% win fraction alone is insufficient.

| Entry period | Trades | Net winners | Mean net/trade |
| --- | ---: | ---: | ---: |
| 2015 warmup-year entries | 16 | 10 (62.5%) | +1.155% |
| 2016–2019 | 49 | 27 (55.1%) | +0.576% |
| 2020–2022 | 44 | 20 (45.5%) | −1.062% |
| 2023–2025 | 36 | 17 (47.2%) | +0.090% |

The 2015 entries are included in the combined 145-trade and portfolio figures because the predeclared rule permits them once two earlier 2015 weeks exist; the predeclared 2016–2025 breakdown excludes them. Annual mean net trades were negative in 2019, 2020, 2021, 2022, and 2025. The 2020–2022 cohort and best-five robustness gates fail. The weekly always-long control with the *same one-week holding and costs* had 46.73% winning trades, 46.38% positive active weeks, and a modeled 88.75% drawdown; it is not a usable fallback.

These are price-only tests: dividends, taxes, actual tariffs, lot constraints, and impact/fill uncertainty are not modeled. The same historical era has supported many exploratory hypotheses, so even a nominally passing percentage would need an independent untouched sample. Do not tune the threshold on 2015–2025 or turn this into an order rule. The next research step should focus on loss size/tail risk and calendar-robust profitability, not optimize win rate in isolation.

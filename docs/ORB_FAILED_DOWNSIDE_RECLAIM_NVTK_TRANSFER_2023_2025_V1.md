# Failed downside-break reclaim v1 — NVTK transfer protocol

Status: frozen before calculating the signal on NVTK. This is a transfer/discovery study, not an independent time holdout: NVTK 2023–2025 price behavior was already screened for other intraday hypotheses.

## Scope, archive and calendar

- Transfer the exact numeric signal, entry, stop, target, time-exit, cost and acceptance rules from [SBER v1](ORB_FAILED_DOWNSIDE_RECLAIM_SBER_2026_V1.md). No thresholds change.
- Instrument: NVTK (MOEX:TQBR:NVTK), long-only, at most one event per date.
- Source: local MOEX one-minute archives in `.trading/nvtk-market-data.sqlite`.
- Frozen archive hashes: 2023 `d9a209720bb861ff0cd0d46c54f6d32bb6b9c2a3d504aec6ea7b69056b5f0317`; 2024 `ff0b6dbe4ae6be5b93930545ffea848d150f67bfb3b3ba476e1f80a6672ea587`; 2025 `10b03ac3e6d7f7a6c54bc6255f4eed317d6e5e3c301d6c6fe7f7e095f12aed73`.
- Use only complete Monday–Friday main sessions, 10:00–18:40 Moscow time. Exclude weekends, exchange-closed dates and all officially designated special holiday trading dates; do not pool those separate sessions. No later-than-2025 data are included.
- Required complete interval per ordinary weekday is 10:00 through 14:30 inclusive (271 consecutive minute bars), sufficient for the 120-minute signal search and latest possible 120-minute exit. Missing bars invalidate that date; never fill gaps.
- MOEX historical calendar references: [2023](https://www.moex.com/n51887), [2024](https://www.moex.com/n64121), [2025](https://www.moex.com/n73701); the previous main-session trading period ends 18:39:59 ([MOEX schedule](https://www.moex.com/a1684)).

## Signal and costs

Use the exact frozen SBER-v1 rules: first 30-minute range; first post-range minute closing strictly below its low; reclaim close at/above that low within the next five consecutive minutes; next-minute-open long entry; stop one tick beneath the lowest low from breakdown through reclaim; 2R target rounded upward; 120-minute maximum hold; stop first if one bar touches both; gap-through-stop exit at that bar's open. Reclaim search ends at T0+120 minutes, exclusive. Reject entries opening below the range low. No second breakdown is evaluated after the first.

Primary fee model: Investor commission 0.30% plus slippage 0.05% per side. Sensitivity: Trader-like commission 0.05% plus the same slippage per side, before any monthly service charge. Both use the same signals and exits. A signal is cost-eligible only if round-trip modeled cost is at most one third of initial risk. This diagnostic cost model is not a claim that historical market-order fills or spreads are known.

## Gate

Apply the same minimum admission gate: at least 100 cost-eligible completed trades across 50 dates; at least 51% net winners; positive mean net return; no unresolved exits; stress viability; and positive result without the best observation. Report each archive year separately as well as pooled results. This transfer cannot become an independent validation; even a positive result requires a new, untouched period or future paper evidence. No parameter search, subgroup selection, or date removal is allowed after observing outcomes.

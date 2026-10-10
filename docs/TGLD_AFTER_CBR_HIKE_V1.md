# Frozen protocol: TGLD after scheduled CBR key-rate hikes v1

Research only; no orders. TGLD is a gold-linked fund unit, not bullion and not a deposit.

Hypothesis: after a **scheduled** Bank of Russia key-rate **hike**, gold-linked TGLD outperforms SBMM over the next 20 weekday sessions (real-asset / FX channel under tightening). This is **not** the rejected TGLD gold-spot lag, **not** iNAV lag, and **not** the rejected SBGB-after-cut rule with the sign flipped on the same OFZ sample.

## Frozen inputs

- Scheduled decision dates: `CBR_DECISION_DATES` (https://www.cbr.ru/dkp/cal_mp/, freeze 2026-09-28). Unscheduled dates excluded.
- Key-rate path: the already stored official series `.trading/cbr-keyrate-2015-2025.json` (2015-01-01–2025-12-31). Classification is identical: `r0` on `D`, `r1` on the next series date; HIKE if `r1 > r0`.
- Prices: public MOEX ISS daily TGLD and the frozen SBMM TQTF daily bars through 2025-12-30. No 2026 TGLD prices in this test.

## Rule

On HIKE, buy TGLD at the first weekday open with date > `D`. Sell 20 weekday TGLD sessions later. One open event at a time; skip a later hike while in the trade. CUT and HOLD stay in cash. Investor costs 0.3% + 0.05% slippage per side on TGLD; stress 0.10% slippage. Paired SBMM control uses the same calendar entry/exit dates and the same costs. Missing either print → unresolved.

Windows: discovery 2022-01-01–2023-12-31; validation 2024-01-01–2025-12-31; combined 2022–2025. If TGLD daily coverage in 2022–2025 is below 150 weekday rows in any of 2023–2025, abort as a data failure before scoring returns.

## Gates

≥20 completed paired trades (meeting frequency; 100 is not feasible). Discovery, validation, and combined: ≥51% TGLD net winners, positive mean TGLD net and stress mean, profit factor >1 or all wins, positive sum without the best three, and **mean(TGLD net − SBMM net) > 0**. Fail → reject. Do not then test cuts on TGLD using this sample. Not live authorization.

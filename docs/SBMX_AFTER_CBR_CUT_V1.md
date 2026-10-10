# Frozen protocol: SBMX after scheduled CBR key-rate cuts v1

Research only; no orders. SBMX is an IMOEX ETF unit, not a deposit and not an OFZ fund.

Hypothesis: after a **scheduled** Bank of Russia key-rate **cut**, listed equity (SBMX) outperforms money-market units (SBMM) over the next 20 weekday sessions via a risk-on / discount-rate channel. This is not the rejected SBGB-after-cut duration book, not CBR first-minute SBER continuation, and not SBMX-vs-SBMM price lag.

## Frozen inputs

- Decision dates: `CBR_DECISION_DATES` (https://www.cbr.ru/dkp/cal_mp/, freeze 2026-09-28). Unscheduled dates excluded.
- Key-rate path: `.trading/cbr-keyrate-2015-2025.json` (2015-01-01–2025-12-31). Classification identical to SBGB-after-cut: `r0` on `D`, `r1` on the next series date; CUT if `r1 < r0`.
- Prices: existing MOEX ISS TQTF daily SBMX and SBMM through 2025-12-30. No 2026 prices.

## Rule

Reuse `simulateSbgbAfterCbrCut` with SBMX as the traded series, SBMM as the paired control, `requiredMove: 'cut'`. Buy SBMX at the first weekday open with date > `D`; sell 20 weekday SBMX sessions later. One open event at a time. HIKE and HOLD stay in cash. Investor 0.3% + 0.05% slippage per side; stress 0.10%. Missing either ETF session → unresolved.

Windows: discovery 2021-01-01–2023-12-31; validation 2024-01-01–2025-12-31; combined 2021–2025.

## Gates

≥20 completed paired trades (meeting frequency). Discovery, validation, and combined: ≥51% SBMX net winners, positive mean SBMX net and stress mean, profit factor >1 or all wins, positive sum without the best three, and **mean(SBMX net − SBMM net) > 0**. Fail → reject. Do not reverse to buy-after-hikes on this sample. Not live authorization.

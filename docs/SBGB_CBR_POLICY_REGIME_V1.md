# Frozen protocol: SBGB/SBMM CBR policy-regime overlay v1

Research only; no orders. This is not the rejected 20-session SBGB-after-cut event book. It is a **low-turnover duration overlay**: hold OFZ units only while the last *acted-on* scheduled move was a cut.

Hypothesis: switching between SBGB and SBMM on scheduled CBR cuts/hikes (and forcing SBMM after unscheduled decisions) beats always holding either ETF after Investor switch costs.

## Frozen inputs

- Scheduled dates: `CBR_DECISION_DATES` (https://www.cbr.ru/dkp/cal_mp/, freeze 2026-09-28), restricted to 2021-01-01–2025-12-31. Dates in 2026 unused.
- Unscheduled: `CBR_UNSCHEDULED_DECISION_DATES` in the same window (2022-02-28, 2022-04-08, 2022-05-26, 2023-08-15).
- Key-rate path: `.trading/cbr-keyrate-2015-2025.json`. Classification identical to SBGB-after-cut: `r0` on `D`, `r1` on the next series date; CUT / HIKE / HOLD.
- Prices: frozen SBGB and SBMM TQTF daily bars. Align on shared weekdays.

## Rule

Start in **SBMM** at the first aligned weekday open ≥ the window start (pay Investor entry). After each scheduled `D`, at the **first weekday open with date > D**:

- CUT → hold SBGB (switch from SBMM if needed; stay if already in SBGB).
- HIKE → hold SBMM (switch from SBGB if needed).
- HOLD → no switch.

After each unscheduled `D`, at the first weekday open > `D`, hold SBMM (switch off SBGB if needed). Same-day opens are not used. Investor 0.3% + 0.05% slippage **per side of each ETF traded** on a switch (sell then buy). Stress 0.10% slippage. Liquidate the live sleeve at the last aligned open ≤ window end.

Windows: discovery 2021-01-01–2023-12-31; validation 2024-01-01–2025-12-31; combined 2021–2025. Separate ₽1m books. Also report SBGB and SBMM `buyAndHoldLqdt` on each window.

## Gates

Combined overlay ending > combined SBGB hold and > combined SBMM hold. Combined close-marked max drawdown milder than −25%. 2022 calendar-year overlay book (2022-01-01–2022-12-31, separate ₽1m) ending > ₽1m. Discovery and validation overlay endings each > their window’s SBMM hold. Do not then invert to “SBGB after hikes”. Passing still needs NAV/fill audit and is not live authorization.

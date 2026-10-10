# Frozen protocol: SBGB after scheduled CBR key-rate cuts v1

Research only; no orders. SBGB is an OFZ ETF unit, not a deposit.

Hypothesis: after a **scheduled** Bank of Russia key-rate **cut**, duration (SBGB) outperforms money-market units (SBMM) over the next 20 weekday sessions. This uses the published policy rate, not SBER’s first five minutes, and not the rejected SBGB/SBMM price-lag filter.

## Frozen inputs

- Decision dates: the scheduled list already frozen in `CBR_DECISION_DATES` (source https://www.cbr.ru/dkp/cal_mp/, freeze 2026-09-28). Unscheduled dates in `CBR_UNSCHEDULED_DECISION_DATES` are excluded.
- Key-rate path: official daily series https://www.cbr.ru/hd_base/keyrate/ for 2015-01-01 through 2025-12-31, stored locally before SBGB returns are computed.
- Prices: existing MOEX ISS TQTF daily SBGB and SBMM bars through 2025-12-30. No 2026 prices.

Classification, using only the rate series: for decision date `D`, `r0` is the series rate on `D`; `r1` is the series rate on the earliest series date strictly after `D`. CUT if `r1 < r0`, HIKE if `r1 > r0`, HOLD if equal. Missing `r0` or `r1` → unresolved event, not a trade.

## Rule

If the event is CUT, buy SBGB at the **first weekday session open with calendar date > D** (the 13:30 MSK release is already known; do not use D’s open). Sell at that series’ open 20 weekday sessions later. At most one open event position; if a later CUT arrives while still in the trade, skip it. HIKE and HOLD stay in cash for that event. No shorts.

Investor costs on SBGB: 0.3% commission + 0.05% slippage per side; stress 0.10% slippage. Same costs on the SBMM **paired control** that buys/sells SBMM on the same calendar entry/exit dates. If either ETF lacks the entry or exit session, the event is unresolved.

Windows: discovery 2021-01-01–2023-12-31 (SBGB listing starts 2021); validation 2024-01-01–2025-12-31; combined 2021–2025. Separate event lists; do not retune after seeing returns.

## Gates

Meeting frequency makes 100 trades impossible; that limit is waived **in this protocol only**, with the floor **≥20 completed paired trades** and ≥8 distinct years-or-blocks covering both discovery and validation. Require ≥51% SBGB net winners, positive SBGB mean net and stress mean, profit factor >1 or all wins, positive sum without the best three (small n), and **mean(SBGB net − SBMM net) > 0** on the same windows. Discovery and validation must each have positive mean SBGB net and positive mean excess vs SBMM.

Failing any gate rejects the rule. Passing still requires tariff/NAV/fill audit and is not live authorization. Do not reverse to “buy after hikes” on this sample.

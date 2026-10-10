# Frozen protocol: SBMX / SBGB / SBMM dual momentum v1

Research only; no orders. Relative-plus-absolute momentum across **equity ETF, OFZ ETF, and cash ETF**. This is not the rejected SBMX/TGLD/SBMM gold dual-momentum sample, not SBGB-after-cut, and not SMA60.

Hypothesis: once per month, holding whichever of SBMX, SBGB, SBMM had the highest 120-weekday total return — or SBMM if that winner’s 120-day return is ≤ 0 — beats always holding any one of them after Investor switch costs, with 2022 included.

## Source

Frozen SBMX, SBGB, and SBMM TQTF daily bars. Align all three on shared weekdays. No 2026. Abort if 2022–2025 aligned yearly counts are outside 150–400.

## Rule

Reuse `simulateDualMomentumThree` with SBGB in the second sleeve slot (same 120-day lookback, first aligned weekday of each month, start in SBMM, Investor 0.3% + 0.05% per side on each ETF traded, skip month if prior session older than 7 days). Liquidate at the last aligned open of the window.

First signal is the first calendar-month open with 121 prior aligned weekday closes. Combined book: that day through 2025-12-30. Separate ₽1m books for 2022 (from first signal if in 2022, else fail unobserved-2022), 2023, 2024, 2025.

Controls: `buyAndHoldLqdt` SBMX, SBGB, SBMM on the combined window.

## Gates

Combined overlay ending > each of the three holds. Combined close-marked max drawdown milder than −25%. 2022 book exists and ends above ₽1m. 2023–2025 books each end above ₽1m. Do not then mix gold back in on this sample. Passing still needs fill/NAV audit and is not live authorization.

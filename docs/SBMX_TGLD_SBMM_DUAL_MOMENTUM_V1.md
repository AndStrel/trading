# Frozen protocol: SBMX / TGLD / SBMM dual momentum v1

Research only; no orders. Classic relative-plus-absolute momentum across **equity ETF, gold-linked ETF, and cash ETF**. Not SMA60 on SBMX, not TGLD or PLZL buy-and-hold, not CBR overlays.

Hypothesis: once per month, holding whichever of SBMX, TGLD, SBMM had the highest 120-weekday total return — or SBMM if that winner’s 120-day return is ≤ 0 — beats always holding any one of them after Investor switch costs, including the 2022 window that exists after warmup.

## Source

Frozen SBMX TQTF 2021–2025, TGLD TQTF 2022–2025, SBMM TQTF. Align all **three** on shared weekdays. No 2026. Abort if 2023–2025 aligned yearly counts are outside 150–400.

## Rule

Lookback **120** weekday closes, frozen (about six months; TGLD listing does not support 252 days before 2023). On the first aligned weekday of each calendar month, using only prior closes: `ret(x) = close[t-1] / close[t-121] - 1`. Choose `argmax(ret(SBMX), ret(TGLD), ret(SBMM))`; if that return ≤ 0, choose SBMM. Execute at that day’s open. If the previous session is older than 7 calendar days, skip the month (keep the live sleeve). Start in SBMM on the first signal day (pay entry). Switch with Investor 0.3% + 0.05% slippage per side on each ETF traded. Stress 0.10%. Liquidate at the last aligned open of the window.

First signal month is the first calendar month in which 121 prior aligned weekday closes exist for all three. Combined book: that first signal day through 2025-12-30. Also report separate ₽1m books for 2023, 2024, 2025 (each starts SBMM at that year’s first aligned open, signals still use full history) and a 2022 book from first signal day through 2022-12-31 if the first signal is in 2022; if the first signal is in 2023, 2022 is marked `unobserved` and fails the 2022 gate.

Controls: `buyAndHoldLqdt` SBMX, TGLD, SBMM on the same combined window.

## Gates

Combined overlay ending > each of the three holds on that window. Combined close-marked max drawdown milder than −25%. 2022 book must exist and end above ₽1m. 2023, 2024, 2025 books each end above ₽1m. Do not then change 120 or drop gold. Passing still needs fill/NAV audit and is not live authorization.

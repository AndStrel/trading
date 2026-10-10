# Frozen protocol: TGLD continuous hold vs SBMM v1

Research only; no orders. TGLD is a gold-linked fund unit, not bullion.

Question: after a **single** Investor round trip, does parking ₽1m in TGLD from the first aligned weekday of 2022 through 2025-12-30 beat the already implemented SBMM cash sleeve on the same calendar? This is not an intraday lag, not a CBR overlay, and not weekly churn.

Use existing hashed daily bars (TGLD TQTF 2022–2025, SBMM TQTF). Align on shared weekdays. `buyAndHoldLqdt` with Investor 0.3% + 0.05% slippage per side, once at the window open and once at the final close. Separate ₽1m books for 2022, 2023, 2024, 2025, and combined 2022–2025. Report marked weekly win rate and max drawdown via `auditWeeklyPortfolio`.

Admit TGLD as an optional paper `gold_sleeve` only if **all** hold: combined TGLD ending > combined SBMM ending; combined TGLD max drawdown milder than −25%; every calendar year 2022–2025 has TGLD ending equity > ₽1m. Otherwise reject gold as a parking sleeve. Do not then switch to 2023–2025 only. No orders.

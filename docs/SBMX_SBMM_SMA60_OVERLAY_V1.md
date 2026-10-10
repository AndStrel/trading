# Frozen protocol: SBMX vs SBMM 60-session SMA overlay v1

Research only; no orders. This is a **trend overlay into cash**, not SBMX buy-and-hold, not Halloween, not CBR duration, and not weekly SBER 252-day trend.

Hypothesis: holding SBMX only when the prior weekday close is strictly above the SMA of the previous 60 weekday closes, and holding SBMM otherwise, survives 2022 and beats both always-SBMX and always-SBMM after Investor **switch** costs.

## Source

Frozen SBMX and SBMM TQTF daily bars. Align on shared weekdays. 2021 is warmup only (must contain ≥60 weekday closes before 2022-01-01). No 2026. Abort if aligned 2022–2025 years fall outside 150–400 weekday rows.

## Rule

At each aligned weekday open from 2022-01-01 through 2025-12-30, the signal uses **only already closed bars**: `sma60` = mean of closes `[t-60, t-1]`; long SBMX iff `close[t-1] > sma60`. If the previous session is older than 7 calendar days, keep the existing sleeve (no switch). Execute at **today’s open**. Start in SBMM on the first 2022 aligned open (pay entry). On a signal change, sell the live sleeve and buy the other at the same open (Investor 0.3% + 0.05% slippage per side on each ETF traded). Stress 0.10%. Do not change 60 after seeing results. Liquidate at the last aligned open ≤ 2025-12-30.

Windows: separate ₽1m books for 2022, 2023, 2024, 2025 (each starts in SBMM at that year’s first aligned open, using the full history for SMA), and combined 2022-01-01–2025-12-30. Also report SBMX and SBMM `buyAndHoldLqdt` on each window.

## Gates

Combined overlay ending > combined SBMX hold and > combined SBMM hold. Combined close-marked max drawdown milder than −25%. Every calendar year 2022–2025 overlay book ends above ₽1m. Do not then drop 2022 or retune 60. Passing still needs fill/NAV audit and is not live authorization.

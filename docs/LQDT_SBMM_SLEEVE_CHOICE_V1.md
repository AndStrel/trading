# Frozen protocol: LQDT vs SBMM sleeve choice v1

Research only; no live orders. Both are ruble money-market ETF units, not deposits.

The paper cash sleeve already allows LQDT or SBMM. This round chooses the **default ticker** using a single continuous hold each, not weekly rotation (rotation already lost to hold).

Source: frozen LQDT daily `.trading/lqdt-daily-2022-2025.json` and SBMM daily `.trading/sbmm-daily-2021-2025.json`. Align on shared weekdays from **2022-07-22** (LQDT TQTF start) through **2025-12-30**. No 2026. `buyAndHoldLqdt` with Investor 0.3% + 0.05% slippage per side, one entry and one exit.

Default ticker rule, fixed before comparing endings:

1. Discard a fund if its combined max drawdown is −5% or worse (money-market parking should not look like equity).
2. Among remaining funds, pick the higher combined ending equity.
3. If both remain and endings differ by less than 1% of the larger ending, pick the milder drawdown.
4. If both are discarded, keep the current default LQDT and report failure.

Also print 2023, 2024, 2025 sub-windows for description; they do not override the combined choice. Changing the MCP default is allowed only if this rule names a ticker. No orders.

# Frozen protocol: SBMX vs SBMM 20-session relative lag v1

Research only; no orders. SBMX is an IMOEX equity ETF unit; SBMM is a money-market ETF unit. Neither is a deposit.

Hypothesis: when SBMX’s last completed 20 eligible sessions underperform SBMM by more than the modeled Investor round-trip cost, some of that **equity-vs-cash lag** mean-reverts over the next 20 sessions. This transfers the frozen SBGB/SBMM lag *rule* onto a different asset class. It is not a retune of SBER weekly relative-strength, not duration, and not a CBR event overlay.

## Source

Public MOEX ISS TQTF daily candles, `interval=24`, SBMX and SBMM. Align on shared weekdays only; no imputation. 2021–2022 are warmup. No 2026.

Windows, fixed before SBMX returns: discovery 2023-01-01–2024-12-31, validation 2025-01-01–2025-12-31, combined 2023–2025. Separate ₽1m books. Abort before scoring if 2023–2025 SBMX weekday rows are outside 150–400 per year.

## Signal

Identical to SBGB/SBMM v1 with SBMX as the traded leg: first weekday of each week; 21 prior aligned sessions; prior close ≤7 calendar days old; enter long SBMX iff `sbgbRatio * breakevenRatio < sbmmRatio` using SBMX closes in place of SBGB; `breakevenRatio = [(1+0.0005)(1+0.003)] / [(1-0.0005)(1-0.003)]`; buy at that open; exit open 20 aligned sessions later; max five overlapping slots at ≤1/5 equity. Reuse `simulateSbgbSbmmRelativeLag`.

Costs: 0.3% + 0.05% slippage per side on SBMX; stress 0.10% slippage.

Controls: always-long SBMX weekly; SBMX buy-and-hold; SBMM buy-and-hold.

## Gates

Same as SBGB/SBMM v1, including rejection if combined ending equity ≤ SBMX hold or ≤ SBMM cash sleeve. Do not change lag, years, or sign after seeing returns. No orders.

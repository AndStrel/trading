# Frozen protocol: GAZP vs SBMX 20-session relative momentum v1

Research only; no orders. GAZP is a listed gas share; SBMX is an IMOEX ETF unit.

Hypothesis: when GAZP’s last 20 eligible sessions **outperform** SBMX by more than the Investor round-trip cost, that **relative strength continues** over the next 20 sessions. Long GAZP only. This is not a lag/mean-reversion book, not a sign flip of LKOH/MOEX/ROSN lag samples, and not GAZP weekly-trend reuse.

## Source

Public MOEX ISS daily `interval=24`: GAZP TQBR via the existing SBER-family importer (2015–2025 snapshot; 2026 excluded) and frozen SBMX TQTF 2021–2025. Align on shared weekdays. Warmup uses 2021–2022. Abort if 2023–2025 GAZP yearly counts are outside 150–400.

Windows: discovery 2023-01-01–2024-12-31, validation 2025-01-01–2025-12-31, combined 2023–2025. Separate ₽1m books.

## Signal

Extend `simulateSbgbSbmmRelativeLag` with mode `relative-momentum`: open only when `gazpRatio > sbmxRatio × breakevenRatio` (the lag mode’s inequality reversed, same breakeven). Same weekly first-weekday entry, 20-session exit, five-slot cap, Investor 0.3% + 0.05% slippage per side, stress 0.10%. Do not change the ratio window after seeing results.

Controls: always-long GAZP weekly; GAZP buy-and-hold; SBMX buy-and-hold; SBMM buy-and-hold on the aligned calendar.

## Gates

Same sample/win-rate/mean/stress/profit-factor/year gates as LKOH/SBMX lag v1. Also reject if combined ending ≤ GAZP hold, ≤ SBMX hold, or ≤ SBMM cash sleeve. Do not then test lag on this pair using this sample. No orders.

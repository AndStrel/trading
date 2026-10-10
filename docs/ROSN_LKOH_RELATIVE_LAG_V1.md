# Frozen protocol: ROSN vs LKOH 20-session relative lag v1

Research only; no orders. ROSN and LKOH are both listed oil-company shares.

Hypothesis: when ROSN’s last 20 eligible sessions underperform LKOH by more than the Investor round-trip cost, some of that **oil-peer lag** mean-reverts over the next 20 sessions. Long ROSN only. This is not LKOH-vs-SBMX oil-vs-index, not the aborted ROSN-vs-USD book, and not a sign flip of those samples.

## Source

Already imported public MOEX ISS daily `interval=24` TQBR: ROSN `.trading/rosn-daily-2021-2025.json` and LKOH `.trading/lkoh-daily-2021-2025.json`. Align on shared weekdays. 2021–2022 warmup. No 2026. Abort if 2023–2025 weekday source counts are outside 150–400 per year.

Windows: discovery 2023-01-01–2024-12-31, validation 2025-01-01–2025-12-31, combined 2023–2025. Separate ₽1m books.

## Signal

Reuse `simulateSbgbSbmmRelativeLag` with ROSN as the traded series and LKOH as the reference. Same breakeven ratio, weekly first-weekday entry, 20-session exit, five-slot cap, Investor 0.3% + 0.05% slippage per side, stress 0.10%.

Controls: always-long ROSN weekly; ROSN buy-and-hold; LKOH buy-and-hold; SBMM buy-and-hold on the aligned calendar.

## Gates

Same sample/win-rate/mean/stress/profit-factor/year gates as LKOH/SBMX v1. Also reject if combined ending ≤ ROSN hold, ≤ LKOH hold, or ≤ SBMM cash sleeve. Do not reverse to buy-strength on this sample. No orders.

# Frozen protocol: LKOH vs SBMX 20-session relative lag v1

Research only; no orders. LKOH is a single oil-company share; SBMX is an IMOEX ETF unit.

Hypothesis: when LKOH’s last 20 eligible sessions underperform SBMX by more than the Investor round-trip cost, some of that **oil-vs-index lag** mean-reverts over the next 20 sessions. This is not LKOH buy-and-hold, not SBMX-vs-cash lag, and not a SBER/GAZP relative-strength retune.

## Source

Public MOEX ISS daily `interval=24`: LKOH TQBR and SBMX TQTF. Align on shared weekdays only. 2021–2022 warmup. No 2026. Abort if 2023–2025 LKOH weekday rows are outside 150–400 per year.

Windows: discovery 2023-01-01–2024-12-31, validation 2025-01-01–2025-12-31, combined 2023–2025. Separate ₽1m books.

## Signal

Reuse `simulateSbgbSbmmRelativeLag` with LKOH as the traded series and SBMX as the reference series. Same breakeven ratio, weekly first-weekday entry, 20-session exit, five-slot cap, Investor 0.3% + 0.05% slippage per side, stress 0.10%.

Controls: always-long LKOH weekly; LKOH buy-and-hold; SBMX buy-and-hold; SBMM buy-and-hold on the LKOH/SBMX aligned calendar.

## Gates

Same sample/win-rate/mean/stress/profit-factor/year gates as SBMX/SBMM v1. Also reject if combined ending ≤ LKOH hold, ≤ SBMX hold, or ≤ SBMM cash sleeve. Do not reverse to “buy strength” on this sample. No orders.

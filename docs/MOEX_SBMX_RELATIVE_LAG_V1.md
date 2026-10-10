# Frozen protocol: MOEX vs SBMX 20-session relative lag v1

Research only; no orders. MOEX is the exchange operator share; SBMX is an IMOEX ETF unit.

Hypothesis: when MOEX’s last 20 eligible sessions underperform SBMX by more than the Investor round-trip cost, some of that **exchange-vs-index lag** (fee/volume vs beta) mean-reverts over the next 20 sessions. This is not LKOH-vs-SBMX oil lag, not SBMX-vs-SBMM cash lag, and not FXGD data substitution.

## Source

Public MOEX ISS daily `interval=24`: MOEX TQBR and frozen SBMX TQTF. Align on shared weekdays. 2021–2022 warmup. No 2026. Abort if 2023–2025 MOEX weekday rows are outside 150–400 per year.

Windows: discovery 2023-01-01–2024-12-31, validation 2025-01-01–2025-12-31, combined 2023–2025. Separate ₽1m books.

## Signal

Reuse `simulateSbgbSbmmRelativeLag` with MOEX as the traded series and SBMX as the reference. Same breakeven ratio, weekly first-weekday entry, 20-session exit, five-slot cap, Investor 0.3% + 0.05% slippage per side, stress 0.10%.

Controls: always-long MOEX weekly; MOEX buy-and-hold; SBMX buy-and-hold; SBMM buy-and-hold on the aligned calendar.

## Gates

Same sample/win-rate/mean/stress/profit-factor/year gates as LKOH/SBMX v1. Also reject if combined ending ≤ MOEX hold, ≤ SBMX hold, or ≤ SBMM cash sleeve. Do not reverse to buy-strength on this sample. No orders.

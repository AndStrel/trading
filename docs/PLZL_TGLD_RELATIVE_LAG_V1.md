# Frozen protocol: PLZL vs TGLD 20-session relative lag v1

Research only; no orders. PLZL is a gold-mining share; TGLD is a gold ETF unit.

Hypothesis: when PLZL’s last 20 eligible sessions underperform TGLD by more than the Investor round-trip cost, some of that **miner-vs-gold-ETF lag** mean-reverts over the next 20 sessions. This is not TGLD buy-and-hold, not LKOH/SBMX oil-vs-index, and not a TGLD-after-CBR retune.

## Source

Public MOEX ISS daily `interval=24`: PLZL TQBR and TGLD TQTF. Align on shared weekdays only. 2022 warmup (TGLD history starts then). No 2026. Abort if 2023–2025 PLZL weekday rows are outside 150–400 per year.

Windows: discovery 2023-01-01–2024-12-31, validation 2025-01-01–2025-12-31, combined 2023–2025. Separate ₽1m books.

## Signal

Reuse `simulateSbgbSbmmRelativeLag` with PLZL as the traded series and TGLD as the reference series. Same breakeven ratio, weekly first-weekday entry, 20-session exit, five-slot cap, Investor 0.3% + 0.05% slippage per side, stress 0.10%.

Controls: always-long PLZL weekly; PLZL buy-and-hold; TGLD buy-and-hold; SBMM buy-and-hold on the aligned calendar.

## Gates

Same sample/win-rate/mean/stress/profit-factor/year gates as LKOH/SBMX v1. Also reject if combined ending ≤ PLZL hold, ≤ TGLD hold, or ≤ SBMM cash sleeve. Do not reverse to “buy strength” on this sample. No orders.

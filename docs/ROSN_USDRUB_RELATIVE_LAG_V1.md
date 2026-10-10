# Frozen protocol: ROSN vs USD/RUB 20-session relative lag v1

Research only; no orders. ROSN is a listed oil-exporter share; USD000UTSTOM is the MOEX USD/RUB TOM FX print, not a fund.

Hypothesis: when ROSN’s last 20 eligible sessions underperform the USD/RUB rate by more than the Investor round-trip cost, some of that **exporter-vs-FX lag** mean-reverts over the next 20 sessions. Long ROSN only. This is not LKOH-vs-SBMX oil-vs-index, not SBMX-after-CBR-cut, and not a USD position.

## Source

Public MOEX ISS daily `interval=24`: ROSN TQBR; USD000UTSTOM CETS (`engines/currency/markets/selt/boards/CETS`). Align on shared **weekdays** only. 2021–2022 warmup. No 2026. Abort if 2023–2025 ROSN or USD weekday-aligned source rows (raw yearly counts) are outside 150–400 per year.

Windows: discovery 2023-01-01–2024-12-31, validation 2025-01-01–2025-12-31, combined 2023–2025. Separate ₽1m books.

## Signal

Reuse `simulateSbgbSbmmRelativeLag` with ROSN as the traded series and USD000UTSTOM as the reference series. Same breakeven ratio, weekly first-weekday entry, 20-session exit, five-slot cap, Investor 0.3% + 0.05% slippage per side, stress 0.10%. Do not trade the FX print.

Controls: always-long ROSN weekly; ROSN buy-and-hold; SBMM buy-and-hold on the ROSN/USD aligned calendar. There is no USD buy-and-hold book (FX is the indicator only).

## Gates

Same sample/win-rate/mean/stress/profit-factor/year gates as LKOH/SBMX v1. Also reject if combined ending ≤ ROSN hold or ≤ SBMM cash sleeve. Do not reverse to buy ROSN after USD weakness on this sample. No orders.

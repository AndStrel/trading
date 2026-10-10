# Frozen protocol: ROSN continuous hold vs SBMM v1

Research only; no orders. ROSN is a listed oil-exporter share. This is not ROSN-vs-LKOH lag, not the aborted ROSN-vs-USD book, and not SBMX/MOEX/PLZL/TGLD parking already rejected.

Question: after **one** Investor round trip, does parking ₽1m in ROSN from the first aligned weekday of 2022 through 2025-12-30 beat the SBMM cash sleeve on the same calendar, with 2022 included? Same admission gates as [TGLD continuous hold](TGLD_CONTINUOUS_HOLD_V1.md).

Use hashed ROSN TQBR daily 2021–2025 and SBMM TQTF daily. Align shared weekdays. `buyAndHoldLqdt`, 0.3% + 0.05% slippage per side once each way. Separate ₽1m books for 2022, 2023, 2024, 2025, and combined 2022–2025.

Admit as optional paper `oil_sleeve` only if combined ROSN ending > SBMM ending, combined max drawdown milder than −25%, and every year 2022–2025 ends above ₽1m. Otherwise reject. Do not drop 2022 after seeing it. No orders.

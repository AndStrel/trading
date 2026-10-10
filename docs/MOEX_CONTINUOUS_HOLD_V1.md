# Frozen protocol: MOEX continuous hold vs SBMM v1

Research only; no orders. MOEX is the exchange operator share, not the SBMX index ETF already rejected as an equity sleeve.

Question: after **one** Investor round trip, does parking ₽1m in MOEX from the first aligned weekday of 2022 through 2025-12-30 beat the SBMM cash sleeve on the same calendar, with 2022 included? Same admission gates as [SBMX continuous hold](SBMX_CONTINUOUS_HOLD_V1.md). Not a MOEX-vs-SBMX lag filter.

Use hashed MOEX TQBR daily 2021–2025 and SBMM TQTF daily. Align shared weekdays. `buyAndHoldLqdt`, 0.3% + 0.05% slippage per side once each way. Separate ₽1m books for 2022, 2023, 2024, 2025, and combined 2022–2025.

Admit as optional paper `exchange_sleeve` only if combined MOEX ending > SBMM ending, combined max drawdown milder than −25%, and every year 2022–2025 ends above ₽1m. Otherwise reject. Do not drop 2022 after seeing it. No orders.

# Frozen protocol: SNGSP continuous hold vs SBMM v1

Research only; no orders. SNGSP is Surgutneftegas preferred shares. This is not the rejected SNGSP/SNGS MAD-discount book, not ROSN ordinary-share parking, and not SBERP.

Question: after **one** Investor round trip, does parking ₽1m in SNGSP from the first aligned weekday of 2022 through 2025-12-30 beat the SBMM cash sleeve on the same calendar, with 2022 included? Same admission gates as [TGLD continuous hold](TGLD_CONTINUOUS_HOLD_V1.md). Dividends are **not** credited (same as other holds); a pass would still need a dividend audit before paper.

Use hashed SNGSP TQBR daily 2015–2025 and SBMM TQTF daily. Align shared weekdays. `buyAndHoldLqdt`, 0.3% + 0.05% slippage per side once each way. Separate ₽1m books for 2022, 2023, 2024, 2025, and combined 2022–2025.

Admit as optional paper `sngsp_sleeve` only if combined SNGSP ending > SBMM ending, combined max drawdown milder than −25%, and every year 2022–2025 ends above ₽1m. Otherwise reject. Do not drop 2022 after seeing it. No orders.

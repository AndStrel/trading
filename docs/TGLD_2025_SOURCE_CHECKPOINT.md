# TGLD 2025 intraday source checkpoint

2025 MOEX ISS TGLD TQTF one-minute trade-candle responses, 10:00–17:00 MSK, were captured in an ignored local archive at `.trading/tgld-2025-source/`. The corresponding ignored manifest is `.trading/tgld-2025-source.json`, SHA-256 `e93d80672c969642518d1924630cfc04910e26e9d00251195eff46a3750f673a`. Each raw response has its own checked SHA-256. Of 261 weekdays, 253 have at least one candle; all 253 active days have an exact 10:00 first candle and a last candle at or after 16:55. The other eight dates are non-trading weekdays, not silently dropped observations.

This is a **source audit only**, not a strategy test. Trade candles are past transactions, not bid/ask quotes or a promise of execution. No strategy outcome has been computed from this newly captured 2025 archive at this checkpoint.

Research routing: predeclare one new intraday mechanism, signal timing, entry/exit, realistic transaction costs and admission gates before reading its outcomes. Use 2025 for discovery and treat the already partly inspected 2026 archive as a weaker confirmation period; obtain forward bid/ask paper observations for true execution validation. Do not tune a failed rule on either archive. No real orders.

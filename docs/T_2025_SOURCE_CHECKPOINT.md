# T share 2025 intraday source checkpoint

Public MOEX ISS T/TQBR one-minute trade-candle responses, 10:00–17:00 MSK, were captured in the ignored local archive `.trading/t-2025-source/`. The ignored manifest `.trading/t-2025-source.json` has SHA-256 `582cd3edb004f658a2a022e5591cec00b23eb397a05e5c1b5e48c214d8748e78`; each raw response is hash-verified on read.

Of 261 weekdays, 253 have candles, 248 have all 421 requested minutes, and all 253 active days have exact 10:00 first and ≥16:55 last candles. Five active days are incomplete internally and must not be silently treated as complete. This is a source audit, not a strategy result or a bid/ask fill audit. No outcome from this archive was inspected before this checkpoint.

Primary security and tariff references: https://www.moex.com/ru/issue.aspx?board=tqbr&code=t ; https://www.tbank.ru/bank/help/general/pro/pro-subscription/benefits/ ; https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/

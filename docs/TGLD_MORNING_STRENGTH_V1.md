# TGLD morning-strength continuation v1 — frozen before 2024 outcomes

Research only; no orders. Hypothesis: gold-related buying visible in TGLD's first half-hour may persist through the same day. This is a **separate exploratory hypothesis chosen after** the negative 2025 morning-selloff result; it is therefore part of sequential search, not an independent one-shot statistical test. Use 2024 TQTF trade candles for discovery. Do not change this rule after any result.

Require exact 10:00 and 10:30 candles. If `close10:30 / close10:00 - 1 >= +0.002`, buy TGLD at the open of the first traded minute from 10:31 through 10:33. If no such minute, cancel the day. Otherwise remain in cash. Exit at the open of the first traded minute from 16:55 through 17:00 on the **same date**. Missing exit is unresolved, not a winning trade. No stop is inferred from sparse prints; report tail losses. At most one long position and two applications per day; no leverage or overnight carry.

Use the currently published T-Invest first-15-daily-applications TGLD allowance to model zero broker commission, conditional on the allowance actually being available. Base adverse execution 0.10% per side, stress 0.20% per side. Round adverse buy **up** and sell **down** to 0.01 RUB ticks, then calculate net returns. Historical trade candles contain no bid/ask, queue position, or real fills; fund expenses are embedded in observed prices, taxes are excluded.

Discovery gate: at least 100 completed trades across 50 dates, zero unresolved exits, at least 51% base-net winners, positive mean/aggregate base net, positive stress mean, positive mean in each half-year, positive sum without five best trades, and acceptable tail loss. If discovery fails, reject without touching 2025/2026 outcome for this rule. If discovery passes, use the unchanged rule on 2025, then 2026, with explicit multiplicity caveat; finally require genuinely forward bid/ask paper fills and risk controls before any real order.

Sources: https://www.moex.com/ru/issue.aspx?code=tgld ; https://www.tbank.ru/invest/help/services/capital/about/how-to-invest/

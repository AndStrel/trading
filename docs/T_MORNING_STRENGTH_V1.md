# T share morning-strength continuation v1 — frozen before 2025 outcomes

Research only; no orders. This transfers a morning-strength mechanism to a more liquid, finer-tick single stock; the previous TGLD strength hypothesis failed. This transfer is part of a **sequential search**, not an independent one-shot discovery. The source is frozen public MOEX ISS T/TQBR 2025 one-minute trade candles, 10:00–17:00 MSK. Do not alter thresholds or costs after reading outcomes.

Require exact 10:00 and 10:30 minute candles. If `close10:30 / close10:00 - 1 >= +0.002`, enter one long position at the open of the first traded minute 10:31–10:33. If no such minute, cancel the attempt. Otherwise stay in cash. Exit at the open of the first traded minute 16:55–17:00 on the same date. Missing exit means unresolved exposure, not a successful trade. No stop is inferred from one-minute prices; report tail losses. No short, leverage, or planned overnight holding.

Do not use knowledge of later candle coverage to suppress an entry. After a simulated entry, any missing one-minute candle through the scheduled exit minute makes that attempt unresolved rather than excluding its date or silently assuming uninterrupted trading. This is conservative because a missing trade candle may be a true no-trade minute rather than a data error; report its count separately.

Two **separate, fixed** cost scenarios, not a choice after seeing returns:

1. Standard Investor: 0.30% broker commission plus 0.05% adverse execution per side; stress adverse execution 0.10% per side, same commission.
2. Conditional T-Bank Pro benefit: zero broker commission for the first 15 eligible daily T securities trades, plus the same 0.05% adverse execution per side (stress 0.10%). Pro requires a paid subscription unless already held; at the currently published 299 RUB/month or 1,990 RUB/year, that fixed cost is **not** included in trade returns. Pro status, actual tariff, eligibility, other trades, position size, and payback must be verified before any economic claim.

Round adverse buy **up** and sell **down** to an assumed 0.02 RUB tick, matching MOEX's published 2026 T specification; the historical 2025 tick needs a separate audit. If uncertain, gross outcomes and unrounded fee-adjusted outcomes must also be shown. Share dividends and corporate events are not expected to accrue over the same-day hold but could affect the price path and require audit. Taxes, historical spread, order-book depth and fills are not measured.

For each cost scenario, discovery gate: at least 100 completed trades across 50 dates; zero cancelled/unresolved attempted positions; ≥51% base-net winners; positive base aggregate/mean and stress mean; positive mean in each 2025 half-year; positive sum after excluding five best trades; acceptable tail risk. A Pro-only pass remains **conditional**, not deployable, until subscription cost and actual account eligibility are established. Only a passing 2025 candidate receives unchanged 2026 historical validation and forward bid/ask paper-fill checks. No real orders.

Sources: https://www.moex.com/ru/issue.aspx?board=tqbr&code=t ; https://www.moex.com/n99222 ; https://www.tbank.ru/bank/help/general/pro/pro-subscription/benefits/ ; https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/

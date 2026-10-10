# TCSG → T 2024 same-security source checkpoint

The Russian shares of MKPAO TKS Holding began trading on 2024-03-18 as TCSG; MOEX changed the ticker to T on 2024-11-28 for the same registered share issue. Public MOEX ISS TQBR one-minute responses (10:00–17:00 MSK) for weekdays 2024-03-18–2024-12-31 were archived locally in ignored `.trading/t-2024-source/`. The ignored manifest `.trading/t-2024-source.json` reproduced SHA-256 `63d327ca97817560862a514c18019dfdca534ed4e65aae38a96401de377d1f65`; every raw response is individually hash-checked.

There are 207 weekdays, 202 with any candles, 192 with all 421 requested minutes, 201 with an exact 10:00 first candle, and 201 with a last candle at or after 16:55. Missing dates/minutes must remain visible. Prices are on a different numerical scale before and after the November ticker change in the fetched candles; no prices are stitched **across** dates. Only within-day percentage moves can be compared without a separate corporate-action adjustment audit. The observed price grids are 0.10 RUB for TCSG and 0.02 RUB for T; these are empirical checks, not a substitute for historical exchange specifications.

No trading-rule outcome was read from this archive at this checkpoint. Candles are historical prints, not executable quotes.

Primary MOEX references: https://www.moex.com/n68303 ; https://www.moex.com/n74886

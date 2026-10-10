# TMON@/SPBRU weekday intraday v1 — rejected

The [unconditional 11:00–17:00 weekday rule](TMON_SPBRU_WEEKDAY_INTRADAY_V1.md) was fixed before opening its weekday price outcomes; protocol SHA-256 `2c62e2982ea35261a774d5da16d80ae29fc11ad5a57378de7d6a4591390360ef`. The timestamp/volume/completeness-only checkpoint `.trading/tmon-spbru-weekday-source-checkpoint.json` has SHA-256 `859ae9d5a71fad79e9cd5eaeec3ebc45592b6896d647ec692d4bff543f1d87da` and records `priceOutcomesOpened:false`. It checked the seven unchanged raw T-Invest SPBRU hourly-candle pages before the outcome calculation. Full ignored report `.trading/tmon-spbru-weekday-v1-results.json` has SHA-256 `b0dfbfd6ca3879a1c834a90257866a9c340b98a95bdae6500bf388dcb1dd33af`. Reproduce with `npm run build` and `node dist/research-tmon-spbru-weekday-v1.js`; `npm run check` passed 92 test files / 302 tests.

There were 410 Monday–Friday dates from 2025-03-01 through 2026-09-27. One 2025 entry hour was absent and the attempt was cancelled; all **409** entered dates had the scheduled exit-hour print. All hourly candles in the cached pages were marked complete and had positive volume. This is source coverage, not proof of executable prices.

| Period | Completed trades | Gross print winners / mean | Base net winners / mean | Stress net winners / mean |
| --- | ---: | ---: | ---: | ---: |
| 2025 | 217 | 73/217 (33.6%), +0.00222% | **15/217 (6.9%), −0.01211%** | 5/217 (2.3%), −0.02643% |
| 2026 through 27 September | 192 | 62/192 (32.3%), +0.00192% | **11/192 (5.7%), −0.01080%** | 4/192 (2.1%), −0.02352% |
| Combined | 409 | 135/409 (33.0%), +0.00208% | **26/409 (6.4%), −0.01149%** | 9/409 (2.2%), −0.02506% |

Base assumes the preliminary one-lot zero-brokerage quote and one adverse 0.01-RUB tick per side; stress uses two ticks per side. Even the impossible zero-expense print score falls far below the 51% net-win target in both calendar blocks. The combined base sum without the five best trades is −4.845 percentage points. Every entered date had all six holding-hour lows for a descriptive marked-path proxy; the worst base liquidation mark was about −0.083% in 2026. These lows are not known executable exits or a tested stop.

**Decision:** reject this exact weekday 11:00→17:00 rule. Do not select a particular weekday, move the hours, or reduce tick costs against the same archive and call that independent evidence. The 2025/2026 SPBRU archive is research data, not an untouched holdout. Historical prints, a preliminary zero brokerage preview, and one live orderbook snapshot do not establish contemporaneous spread, fill, queue, impact, tax or actual account fees. No sandbox or real order was placed.

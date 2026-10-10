# TMON@/SPBRU weekend intraday v1 — rejected

The [weekend-only rule](TMON_SPBRU_WEEKEND_INTRADAY_V1.md) was fixed before price outcomes, with original protocol SHA-256 `9df9ef7a691c23e5ecf0f53ca509049a525e0d0409271fd37986c451c807b59e`. A source-only clarification of the scheduled unconditional entry (no change to dates, hours, costs or gates) produced final protocol SHA-256 `81644ff577873af9ff2b9f48bff7905fba3f21a8835857d081fa6bec528eca0d`. The price-blind checkpoint `.trading/tmon-spbru-weekend-source-checkpoint.json` has SHA-256 `d97df4975ad192a14ba5b2a75d4d8059c26b3b5962ab7617b1e6af072496483c` and verifies seven locally cached raw T-Invest exchange-candle pages by their individual hashes. The unchanged price test is reproducible with `npm run build` and `node dist/research-tmon-spbru-weekend-v1.js`. Full ignored report `.trading/tmon-spbru-weekend-v1-results.json` has SHA-256 `49c461a34fcc3b70b1d2152308ffc69535ff20d248db2484f2964771452604e5`.

Of 166 Saturday/Sunday dates from 2025-03-01 through 2026-09-27, **155** had both scheduled 11:00 and 17:00 hourly trade-print candles. Eleven entry attempts were cancelled because the entry hour was absent (six in 2025, five in 2026); **no entered position lacked an exit-hour candle**. All 7,923 cached hourly candles had positive volume and were marked complete. This meets the source-only completed-pair and sample-count screens, but proves neither quote depth nor executable entry/exit fills.

| Period | Completed trades | Gross print winners / mean | Base net winners / mean | Stress net winners / mean |
| --- | ---: | ---: | ---: | ---: |
| 2025 | 82 | 27/82 (32.9%), +0.00234% | **8/82 (9.8%), −0.01199%** | 4/82 (4.9%), −0.02631% |
| 2026 through 27 September | 73 | 26/73 (35.6%), +0.00022% | **2/73 (2.7%), −0.01249%** | 0/73, −0.02519% |
| Combined | 155 | 53/155 (34.2%), +0.00134% | **10/155 (6.5%), −0.01222%** | 4/155 (2.6%), −0.02578% |

Base uses the preliminary one-lot zero-brokerage assumption and adds one adverse 0.01-RUB tick to the buy print and subtracts one from the sell print; stress uses two ticks per side. Even the zero-cost gross print win frequency misses 51% in both year blocks. Combined base sum without the five best trades is **−2.015 percentage points**; the 2026 minimum hourly-low marked liquidation proxy was −0.751% on 2026-09-27, a possible tail print that needs source-level scrutiny, not a proven executable loss. Taxes, actual historical bid/ask, market impact, order queue, account fees beyond the preliminary quote, and exact first-trade timestamps within each hour are not verified.

**Decision:** reject this precise SPBRU weekend 11:00→17:00 rule. Do not retune hours, select only Saturdays/Sundays, or reduce tick allowances on the same archive and call the result independent. This result says nothing about every possible TMON@ strategy or continuous holding, and the older MOEX/TQTF–TQBR results cannot be transferred to SPBRU. No real or sandbox order was placed.

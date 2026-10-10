# SNGSP vs SNGS weekly preferred discount v1 — rejected

The [rule](SNGSP_SNGS_WEEKLY_DISCOUNT_V1.md) was frozen before SNGS/SNGSP returns. Protocol SHA-256 `d4583158b8caca3b4304a6fbf87f2d998809103c27043f95bd9b9894945402f1`. SNGS TQBR daily SHA-256 `58c3ab8293cc50966e2fb95243e74a6a219bc177449150c8067c13f33f9a9418` (2,827 rows). SNGSP `bca856ce5d4b266bf03acfd4e324d601ec983ef8b1e0cef8ea696e5e53c2e07a` (2,827 rows, identical dates). Reproduce: `node dist/research-import-sber-daily.js SNGS`, same for `SNGSP`, then `npm run research:sngsp-sngs-weekly-discount`. Report: `.trading/sngsp-sngs-weekly-discount-v1.json`.

| Book | Trades | Win rate | Mean net | Rule ending |
| --- | ---: | ---: | ---: | ---: |
| 2016–2019 | 56 | 46.4% | +0.53% | — |
| 2020–2022 | 19 | 10.5% | −3.39% | — |
| 2023–2025 | 15 | 13.3% | −4.23% | ₽0.892m vs SBMM ₽1.548m |
| Combined 2016–2025 | 90 | 33.3% | −1.09% | ₽0.817m vs SNGSP hold ₽0.939m |

2023 and 2024 had **no** entries. Combined drawdown −30.9%. Always-long weekly SNGSP ended ₽0.505m (also not a working rule). Sample below 100 trades.

**Reject.** Dual-share MAD discount does not transfer from SBERP to SNGSP after Investor costs. Do not reverse to buy-premium. No overlay. No orders.

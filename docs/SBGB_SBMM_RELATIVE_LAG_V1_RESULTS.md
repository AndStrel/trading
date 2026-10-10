# SBGB vs SBMM 20-session relative lag v1 — rejected

The [rule](SBGB_SBMM_RELATIVE_LAG_V1.md) was frozen before SBGB outcomes. Protocol SHA-256 `6a3f4c5cc30fd43bfd43207006bf9a238f8af5fd717d4b7f9657bade5da8ee36`. Sources: MOEX ISS TQTF daily SBGB `ea9f54cd20cbb14f65fc98656bb9cae23a1df23b35a4bb044304ffb53cc1a36a` (1,248 rows) and the frozen SBMM snapshot `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce with `npm run build`, `node dist/research-import-sbgb-daily.js` if needed, then `node dist/research-sbgb-sbmm-relative-lag.js`. Report: `.trading/sbgb-sbmm-relative-lag-v1.json`.

| Book | Trades | Net winners | Mean base net | Rule ending | SBGB hold | SBMM hold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023–2024 | 59 | 20 (33.9%) | −1.17% | ₽0.907m | ₽0.992m | ₽1.283m |
| 2025 | 15 | 10 (66.7%) | +1.32% | ₽1.040m | ₽1.208m | ₽1.197m |
| Combined | 76 | 32 (42.1%) | −0.39% | ₽0.938m | ₽1.208m | **₽1.548m** |

Combined marked drawdown −16.9%. Always-long SBGB also ended below ₽1m on the combined book (₽0.936m). 2023 and 2024 means are negative; 2025 is a small, previously unsplit sample and is **not** a license to keep the rule.

**Reject.** The lag filter did not pay Investor round-trip costs and lost to both SBGB hold and the SBMM cash sleeve. Do not shorten the lag, reverse the sign, or keep only 2025. No orders.

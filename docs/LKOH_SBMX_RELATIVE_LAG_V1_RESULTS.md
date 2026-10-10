# LKOH vs SBMX 20-session relative lag v1 — rejected

The [rule](LKOH_SBMX_RELATIVE_LAG_V1.md) was frozen before LKOH returns. Protocol SHA-256 `8cad9348122fc43d0080f8902ff4da5f409c522e6ed54d1ab06d936fa4b31c93`. LKOH TQBR daily SHA-256 `c6ac11b117d326a4272da5349d0f6778146af80840d63686e18889d4f96f512a` (1,317 rows). SBMX `5f1f0e533a4bfc05d88014b3052245ffb55b430faebb9a23289521672effe64b`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce: `npm run research:import-lkoh-daily` then `npm run research:lkoh-sbmx-relative-lag`. Report: `.trading/lkoh-sbmx-relative-lag-v1.json`.

| Book | Trades | Win rate | Mean net | Rule ending | LKOH hold | SBMX hold | SBMM hold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023–2024 | 36 | 44.4% | −0.21% | ₽0.992m | ₽1.760m | ₽1.516m | ₽1.283m |
| 2025 | 33 | 54.5% | −0.96% | ₽0.939m | ₽0.809m | ₽1.015m | ₽1.197m |
| Combined | 71 | 50.7% | −0.46% | ₽0.929m | ₽1.437m | ₽1.550m | **₽1.548m** |

Combined drawdown −28.7%. Sample 71 trades is below the 100-trade floor. 2023 mean net was positive; 2024 and 2025 were not. Combined ending lost to LKOH, SBMX, and SBMM holds.

**Reject.** Oil-vs-index lag did not pay Investor round trips. Do not reverse to buy-strength on this sample. No LKOH overlay is added to paper. No orders.

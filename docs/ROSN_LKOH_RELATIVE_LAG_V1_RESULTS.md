# ROSN vs LKOH 20-session relative lag v1 — rejected

The [rule](ROSN_LKOH_RELATIVE_LAG_V1.md) was frozen before ROSN/LKOH pair returns. Protocol SHA-256 `f2a7e263b20b97682c0e0c741373077cd2cd08c82166f00eeb2bcbed99f53964`. ROSN `68f0731e9cf77b4add121411753e2d6805f081a8dec6b8d157cb865e1d274d06`. LKOH `c6ac11b117d326a4272da5349d0f6778146af80840d63686e18889d4f96f512a`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce: `npm run research:rosn-lkoh-relative-lag`. Report: `.trading/rosn-lkoh-relative-lag-v1.json`.

| Book | Trades | Win rate | Mean net | Rule ending | ROSN hold | LKOH hold | SBMM hold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023–2024 | 59 | 54.2% | +2.47% | ₽1.308m | ₽1.636m | ₽1.760m | ₽1.283m |
| 2025 | 25 | 28.0% | −3.62% | ₽0.824m | ₽0.664m | ₽0.809m | ₽1.197m |
| Combined | 84 | 46.4% | +0.66% | ₽1.077m | ₽1.104m | ₽1.437m | **₽1.548m** |

2023 mean net was strongly positive; 2024 and 2025 were not. Combined sample 84 is below 100. Combined ending lost to ROSN, LKOH, and SBMM holds. Combined drawdown −24.2%.

**Reject.** Oil-peer lag is not admitted. Do not reverse to buy-strength. No overlay. No orders.

# GAZP vs SBMX 20-session relative momentum v1 — rejected

The [rule](GAZP_SBMX_RELATIVE_MOMENTUM_V1.md) was frozen before GAZP momentum returns. Protocol SHA-256 `0d11d1065682eef02dc201313c2eea5f15056dc30010f2ed7d0ecd040afe73bd`. GAZP TQBR daily SHA-256 `d0705203ae7629cc0b919f5b2a6da8b5be333972d8c81aba8bc6d1b13923c261` (2,827 rows). SBMX `5f1f0e533a4bfc05d88014b3052245ffb55b430faebb9a23289521672effe64b`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce: `node dist/research-import-sber-daily.js GAZP` then `npm run research:gazp-sbmx-relative-momentum`. Report: `.trading/gazp-sbmx-relative-momentum-v1.json`.

| Book | Trades | Win rate | Mean net | Rule ending | GAZP hold | SBMX hold | SBMM hold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023–2024 | 21 | 38.1% | −1.81% | ₽0.921m | ₽0.811m | ₽1.516m | ₽1.283m |
| 2025 | 22 | 31.8% | −2.59% | ₽0.859m | ₽0.937m | ₽1.015m | ₽1.197m |
| Combined | 43 | 34.9% | −2.21% | ₽0.792m | ₽0.764m | ₽1.550m | **₽1.548m** |

Combined sample 43 is below 100. Combined drawdown −32.1%. The rule beat GAZP hold slightly and still lost to SBMX and SBMM.

**Reject.** Relative strength continuation did not pay Investor round trips. Do not test lag on this pair from this sample. No overlay. No orders.

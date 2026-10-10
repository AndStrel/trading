# MOEX vs SBMX 20-session relative lag v1 — rejected

The [rule](MOEX_SBMX_RELATIVE_LAG_V1.md) was frozen before MOEX returns. Protocol SHA-256 `ce95b33092c10113c8415b1d9c7d61c63e6942f012bede993ab5fbc92d673c8a`. MOEX TQBR daily SHA-256 `5e6352feb3a51a50e4004c8f8ac597496a662cb8cf679fe65a3a09bf44e6e1da` (1,317 rows). SBMX `5f1f0e533a4bfc05d88014b3052245ffb55b430faebb9a23289521672effe64b`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce: `npm run research:import-moex-daily` then `npm run research:moex-sbmx-relative-lag`. Report: `.trading/moex-sbmx-relative-lag-v1.json`.

| Book | Trades | Win rate | Mean net | Rule ending | MOEX hold | SBMX hold | SBMM hold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023–2024 | 34 | 73.5% | +4.63% | ₽1.428m | ₽2.074m | ₽1.516m | ₽1.283m |
| 2025 | 28 | 53.6% | −2.07% | ₽0.884m | ₽0.855m | ₽1.015m | ₽1.197m |
| Combined | 66 | 66.7% | +2.06% | ₽1.281m | **₽1.804m** | ₽1.550m | ₽1.548m |

Discovery trade-level means were positive, but active-week win rate was 48.6% and 2025 mean net was negative. Combined sample 66 is below 100. Combined ending lost to MOEX, SBMX, and SBMM holds. Combined drawdown −18.6%.

**Reject.** Exchange-vs-index lag is not admitted. Do not reverse to buy-strength. No overlay. No orders.

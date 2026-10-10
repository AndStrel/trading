# MOEX continuous hold vs SBMM v1 — rejected

The [rule](MOEX_CONTINUOUS_HOLD_V1.md) was frozen before MOEX hold returns. Protocol SHA-256 `3a44b221cc53ad66efa72e54f205febc1d49b19091f232fa136db6978e1c0980`. MOEX `5e6352feb3a51a50e4004c8f8ac597496a662cb8cf679fe65a3a09bf44e6e1da`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce: `npm run research:moex-continuous-hold`. Report: `.trading/moex-continuous-hold-v1.json`.

| Book | MOEX ending | SBMM ending | MOEX DD |
| --- | ---: | ---: | ---: |
| 2022 | ₽0.617m | ₽1.099m | −53.2% |
| 2023 | ₽1.973m | ₽1.085m | −13.8% |
| 2024 | ₽1.040m | ₽1.174m | −31.9% |
| 2025 | ₽0.855m | ₽1.197m | −35.2% |
| Combined 2022–2025 | ₽1.120m | **₽1.715m** | −53.2% |

2022 and 2025 calendar books ended below ₽1m. Combined lost to SBMM and breached the −25% drawdown gate.

**Reject.** Do not drop 2022. No `exchange_sleeve`. No orders.

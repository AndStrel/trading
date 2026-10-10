# SNGSP continuous hold vs SBMM v1 — rejected

The [rule](SNGSP_CONTINUOUS_HOLD_V1.md) was frozen before SNGSP hold returns. Protocol SHA-256 `c16233e8c4c9becd9940bc37195e8185c3e97e6c9a99b577edc91635aa6d84c7`. SNGSP `bca856ce5d4b266bf03acfd4e324d601ec983ef8b1e0cef8ea696e5e53c2e07a`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce: `npm run research:sngsp-continuous-hold`. Report: `.trading/sngsp-continuous-hold-v1.json`. Dividends were not credited.

| Book | SNGSP ending | SBMM ending | SNGSP DD |
| --- | ---: | ---: | ---: |
| 2022 | ₽0.669m | ₽1.099m | −47.8% |
| 2023 | ₽2.098m | ₽1.085m | −17.3% |
| 2024 | ₽1.085m | ₽1.174m | −38.4% |
| 2025 | ₽0.684m | ₽1.197m | −39.8% |
| Combined 2022–2025 | ₽1.074m | **₽1.715m** | −49.1% |

2022 and 2025 ended below ₽1m. Combined lost to SBMM and breached −25% drawdown.

**Reject.** Do not drop 2022. No `sngsp_sleeve`. No orders.

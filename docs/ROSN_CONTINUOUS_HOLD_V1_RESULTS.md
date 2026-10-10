# ROSN continuous hold vs SBMM v1 — rejected

The [rule](ROSN_CONTINUOUS_HOLD_V1.md) was frozen before ROSN hold returns. Protocol SHA-256 `6fbbe7a5e7b1036b010c93240dbd141f47ff265e7ecf92d4d8198d5e423dc9c0`. ROSN `68f0731e9cf77b4add121411753e2d6805f081a8dec6b8d157cb865e1d274d06`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce: `npm run research:rosn-continuous-hold`. Report: `.trading/rosn-continuous-hold-v1.json`.

| Book | ROSN ending | SBMM ending | ROSN DD |
| --- | ---: | ---: | ---: |
| 2022 | ₽0.605m | ₽1.099m | −59.2% |
| 2023 | ₽1.601m | ₽1.085m | −12.2% |
| 2024 | ₽1.010m | ₽1.174m | −28.1% |
| 2025 | ₽0.664m | ₽1.197m | −39.9% |
| Combined 2022–2025 | ₽0.677m | **₽1.715m** | −59.2% |

2022 and 2025 ended below ₽1m. Combined lost to SBMM and breached −25% drawdown.

**Reject.** Do not drop 2022. No `oil_sleeve`. No orders.

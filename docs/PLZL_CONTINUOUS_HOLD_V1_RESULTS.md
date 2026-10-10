# PLZL continuous hold vs SBMM v1 — rejected

The [rule](PLZL_CONTINUOUS_HOLD_V1.md) was frozen before PLZL hold returns. Protocol SHA-256 `fa2c5161e833c7a9cc9c3520c5ceda29b70e599d0b695e4244db5b06e9401387`. PLZL `001bec15575548ca470b5ae3c4e529d6990583f3fc9426fb9369626422483d4c`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce: `npm run research:plzl-continuous-hold`. Report: `.trading/plzl-continuous-hold-v1.json`.

| Book | PLZL ending | SBMM ending | PLZL DD |
| --- | ---: | ---: | ---: |
| 2022 | ₽0.582m | ₽1.099m | −65.1% |
| 2023 | ₽1.363m | ₽1.085m | −18.1% |
| 2024 | ₽1.298m | ₽1.174m | −22.2% |
| 2025 | ₽1.695m | ₽1.197m | −17.4% |
| Combined 2022–2025 | ₽1.815m | ₽1.715m | −65.1% |

Combined ending beat SBMM, but 2022 ended below ₽1m and combined drawdown breached −25%.

**Reject.** Do not drop 2022. No `miner_sleeve`. No orders.

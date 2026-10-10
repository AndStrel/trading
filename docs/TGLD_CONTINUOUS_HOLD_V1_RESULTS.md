# TGLD continuous hold vs SBMM v1 — rejected as a gold sleeve

The [rule](TGLD_CONTINUOUS_HOLD_V1.md) was frozen before comparing endings. Protocol SHA-256 `09f07cb196f3dbb450a33c8c472a09b9cbd62345eab09c4e183e42b19ec43e62`. TGLD/SBMM daily hashes unchanged. Reproduce: `node dist/research-tgld-continuous-hold.js`. Report: `.trading/tgld-continuous-hold-v1.json`.

| Window | TGLD hold | SBMM hold | TGLD max DD |
| --- | ---: | ---: | ---: |
| 2022 | ₽0.937m | ₽1.099m | **−36.9%** |
| 2023 | ₽1.405m | ₽1.085m | −9.3% |
| 2024 | ₽1.420m | ₽1.174m | −13.0% |
| 2025 | ₽1.230m | ₽1.197m | −10.2% |
| Combined 2022–2025 | ₽2.408m | ₽1.715m | **−36.9%** |

TGLD beat SBMM on the full window because of 2023–2025, but **2022 lost money** and the combined drawdown is beyond the −25% floor. Do not drop 2022 after seeing it. Gold is not added as a paper sleeve. Cash parking stays LQDT/SBMM. No orders.

# SBMX vs SBMM 20-session relative lag v1 — rejected

The [rule](SBMX_SBMM_RELATIVE_LAG_V1.md) was frozen before SBMX returns. Protocol SHA-256 `af6dc25a1d46ccdd4aa67f33959d290548f0d983bb07a32dbd1dd92dcc3d12bd`. SBMX TQTF daily SHA-256 `5f1f0e533a4bfc05d88014b3052245ffb55b430faebb9a23289521672effe64b` (1,244 rows). SBMM hash unchanged. Reproduce: `node dist/research-import-sbmx-daily.js` then `node dist/research-sbmx-sbmm-relative-lag.js`. Report: `.trading/sbmx-sbmm-relative-lag-v1.json`.

| Book | Trades | Net winners | Mean base net | Rule ending | SBMX hold | SBMM hold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023–2024 | 36 | 15 (41.7%) | −1.24% | ₽0.961m | ₽1.516m | ₽1.283m |
| 2025 | 28 | 12 (42.9%) | −1.10% | ₽0.934m | ₽1.015m | ₽1.197m |
| Combined | 66 | 29 (43.9%) | −0.71% | ₽0.894m | ₽1.550m | **₽1.548m** |

Combined drawdown −19.7%. Always-long weekly SBMX also lagged buy-and-hold. 2023’s 7/10 winners are below the year-mean gate once 2024–2025 are included and do not justify keeping the filter.

**Reject.** Equity-vs-cash lag did not pay Investor round trips and lost to both holds. No SBMX overlay is added to paper. No orders.

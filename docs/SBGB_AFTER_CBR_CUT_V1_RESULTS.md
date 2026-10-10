# SBGB after scheduled CBR cuts v1 — rejected

The [rule](SBGB_AFTER_CBR_CUT_V1.md) was frozen before SBGB window returns. Protocol SHA-256 `7d0bc8b9d90bded0cabc75946db62db69002d3cd35014108c03e57b02231a582`. Official daily key-rate series SHA-256 `91da3d92eaef46b4631f2504aee49dc47aa6520b05681e221b9aa35c90d82620` (2,758 rows, 2015-01-12–2025-12-30). SBGB/SBMM daily hashes unchanged from the prior transfer. Reproduce: `node dist/research-import-cbr-keyrate.js` then `node dist/research-sbgb-after-cbr-cut.js`. Report: `.trading/sbgb-after-cbr-cut-v1.json`.

| Book | Scheduled events | Cuts | Completed SBGB trades | Net winners | Mean SBGB net | Mean excess vs SBMM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2021–2023 | 24 | 4 | 4 | 1 (25%) | +0.29% | +0.23% |
| 2024–2025 | 16 | 5 | 4 | 3 (75%) | +1.10% | +0.42% |
| Combined | 40 | 9 | **8** | 4 (50%) | +0.69% | +0.33% |

One 2024–2025 cut is unresolved (missing paired session). Combined sample is below the predeclared floor of 20 trades. Removing the three best trades leaves a negative sum. 2025’s three winners are not a separate strategy.

**Reject.** Do not trade duration after cuts on this evidence, and do not invert the rule onto hikes. The implemented cash sleeve remains SBMM/LQDT hold, not an OFZ overlay. No orders.

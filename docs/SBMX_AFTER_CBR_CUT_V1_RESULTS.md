# SBMX after scheduled CBR key-rate cuts v1 — rejected

The [rule](SBMX_AFTER_CBR_CUT_V1.md) was frozen before SBMX event returns. Protocol SHA-256 `27cc80c596b5708fe40281bc330bbb5568d8f4dc0a18c4a89eaf971c799fe86e`. CBR key-rate SHA-256 `91da3d92eaef46b4631f2504aee49dc47aa6520b05681e221b9aa35c90d82620`. SBMX `5f1f0e533a4bfc05d88014b3052245ffb55b430faebb9a23289521672effe64b`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce: `npm run research:sbmx-after-cbr-cut`. Report: `.trading/sbmx-after-cbr-cut-v1.json`.

| Book | Events | Cuts | Trades | Win rate | Mean SBMX net | Mean excess vs SBMM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2021–2023 | 24 | 4 | 4 | 25% | −6.01% | −6.07% |
| 2024–2025 | 16 | 5 | 4 | 50% | +0.05% | −0.63% |
| Combined | 40 | 9 | 8 | 37.5% | −2.98% | −3.35% |

Eight completed trades is below the waived floor of 20. Combined stress mean is negative. Validation’s small positive SBMX mean still lost to SBMM after costs.

**Reject.** Equity after easing did not beat cash. Do not reverse to buy-after-hikes on this sample. No overlay. No orders.

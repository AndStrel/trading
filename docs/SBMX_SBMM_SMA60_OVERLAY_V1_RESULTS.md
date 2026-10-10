# SBMX vs SBMM 60-session SMA overlay v1 — rejected

The [rule](SBMX_SBMM_SMA60_OVERLAY_V1.md) was frozen before overlay equity. Protocol SHA-256 `aa9881cdc30f99116cac4d31c20602e2aff6a51f549e17d4bf281c9ad0bc44bb`. SBMX `5f1f0e533a4bfc05d88014b3052245ffb55b430faebb9a23289521672effe64b`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. 62 weekday closes before 2022. Reproduce: `npm run research:sbmx-sbmm-sma60-overlay`. Report: `.trading/sbmx-sbmm-sma60-overlay-v1.json`.

| Book | Switches | Overlay ending | SBMX hold | SBMM hold | Overlay DD |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2022 | 5 | ₽1.007m | ₽0.604m | ₽1.099m | −18.0% |
| 2023 | 6 | ₽1.429m | ₽1.500m | ₽1.085m | −8.9% |
| 2024 | 15 | ₽0.998m | ₽1.003m | ₽1.174m | −16.4% |
| 2025 | 13 | ₽1.087m | ₽1.015m | ₽1.197m | −13.0% |
| Combined | 37 | ₽1.634m | ₽0.949m | **₽1.715m** | −18.0% |

The overlay beat always-SBMX and kept combined drawdown milder than −25%, but 2024 ended just below ₽1m and combined lost to SBMM after 37 round trips.

**Reject.** Do not retune the 60-day window or drop 2022. No overlay is added to paper. No orders.

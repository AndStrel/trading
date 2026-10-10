# SBMX / SBGB / SBMM dual momentum v1 — admitted for paper only

The [rule](SBMX_SBGB_SBMM_DUAL_MOMENTUM_V1.md) was frozen before overlay equity. Protocol SHA-256 `ae2cf3071ebf41fe6359d80803c41808c9bbaa0dfdb127298297d2700d0611fc`. After `npm run research:refresh-paper-daily` on 2026-10-10 the pinned daily row hashes became SBMX `31e0501946b7e733d35f4138d196d3e191e1513e9ebfa385bce68a87f901f6ed`, SBGB `0fbfae6a340f6c58e4f9b3132d005fe99d3f63969909d5a1eed5de1cc2ca56f4`, SBMM `79be545eefeb2305911e631e15cadcb93a3bde2f514023a5bcd4284945dda016`; admission numbers on 2022–2025 were unchanged. First signal **2022-05-04**. Reproduce: `npm run research:sbmx-sbgb-sbmm-dual-momentum`. Report: `.trading/sbmx-sbgb-sbmm-dual-momentum-v1.json`. Telegram `/dual` reads snapshots without hash pins.

| Book | Switches | Overlay ending | SBMX hold | SBGB hold | SBMM hold | Overlay DD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022-05-04–2022-12-31 | 2 | ₽1.006m | ₽0.942m | ₽1.088m | ₽1.052m | −7.7% |
| 2023 | 3 | ₽1.291m | ₽1.500m | ₽0.989m | ₽1.085m | −8.0% |
| 2024 | 2 | ₽1.085m | ₽1.003m | ₽0.997m | ₽1.174m | −12.9% |
| 2025 | 2 | ₽1.129m | ₽1.015m | ₽1.208m | ₽1.197m | −9.9% |
| Combined | 12 | **₽1.646m** | ₽1.480m | ₽1.326m | ₽1.642m | −12.9% |

All frozen gates passed. Combined beat SBMX, SBGB, and SBMM holds; drawdown milder than −25%; 2022–2025 books each ended above ₽1m. Combined edge versus SBMM is small (₽1.646m vs ₽1.642m) and is **not** live authorization: NAV, lots, fills, and an untouched 2026 still required.

**Paper only.** MCP `get_paper_dual_momentum_signal` and Telegram `/dual` read the frozen sleeve from local daily snapshots. Do not mix TGLD into this sample. No broker orders.

# LQDT vs SBMM sleeve choice v1 — default remains LQDT

The [rule](LQDT_SBMM_SLEEVE_CHOICE_V1.md) was frozen before comparing endings. Protocol SHA-256 `641312070a76330ac306be8fb6ffcacc33d5bea682e0460224834dc7c0815747`. LQDT rows SHA-256 `30735af9d50b40756b1dcb0446671c61cb0f265d6aa3e2efff59dc8e72b5d519`; SBMM unchanged. Aligned weekdays 2022-07-22–2025-12-30 (875 days). Reproduce: `node dist/research-lqdt-sbmm-sleeve-choice.js`. Report: `.trading/lqdt-sbmm-sleeve-choice-v1.json`.

| Fund | Ending | Max DD |
| --- | ---: | ---: |
| LQDT | ₽1.606m | −0.71% |
| SBMM | ₽1.592m | −1.21% |

Both cleared the −5% drawdown floor. Endings differ by less than 1%, so the frozen tie-break selects **milder drawdown: LQDT**. MCP `open_paper_cash_sleeve` already defaults to LQDT; SBMM stays available as an explicit ticker. This is cash parking, not a forecast that LQDT will keep beating SBMM. No orders.

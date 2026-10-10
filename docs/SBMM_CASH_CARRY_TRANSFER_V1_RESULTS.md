# SBMM cash-carry transfer v1 — historical result

The [frozen transfer](SBMM_CASH_CARRY_TRANSFER_V1.md) reused the LQDT 20-session rule without changing costs or thresholds. Protocol SHA-256 `024e92605af8de3dd70d17d08dfa3338a355eeac346c7118ec6258893ffdecd0`. Public MOEX ISS TQTF SBMM daily candles 2021-10-05–2025-12-30, 1,057 rows, row SHA-256 `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce with `npm run build`, `node dist/research-import-sbmm-daily.js` if the ignored source is missing, then `node dist/research-sbmm-cash-carry.js`. Machine report: `.trading/sbmm-cash-carry-transfer-v1.json`.

| Book | Completed trades | Net winners | Mean base net | Ending rolling | Ending buy-and-hold |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2023–2024 discovery | 67 | 65 (97.0%) | +0.524% | ₽1.072m | ₽1.283m |
| 2025 validation | 48 | 48 (100%) | +0.763% | ₽1.076m | ₽1.197m |
| Combined 2023–2025 | 119 | 117 (98.3%) | +0.641% | ₽1.164m | **₽1.548m** |

Combined active-week win rate 119/123 (96.7%), marked drawdown −0.45%. Buy-and-hold active-week win rate 99.4% with −0.79% drawdown. The rolling rule cleared the predeclared win-rate and mean-net gates, then failed the economic gate: **inferior-to-buy-and-hold**. Status `not-admitted` as a trading rule.

This is the same qualitative result as LQDT: 2023–2025 ruble money-market units paid carry, and repeated 20-session round trips destroyed more of that carry than they saved in risk. Paper use is one continuous sleeve, not weekly re-entry. SBMM and LQDT remain distinct funds; neither is a deposit. 2026, tariffs, NAV premium, lots, taxes, and fills are unverified. No orders.

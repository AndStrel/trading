# Si first-half-hour direction v1 — rejected on 2025 archive

The [rule](SI_HALF_HOUR_LIQUIDITY_V1.md) was fixed before calculating this candidate's outcomes. It transfers a mechanism proposed for historical 2005–2014 RUB/USD trading; it does not assume that finding still holds. The 2025 MOEX SiU5/SiZ5 minute archive was already used elsewhere in this project, so the result is exploratory, not an independent holdout. All raw pages are hash-checked on replay. Reproduce with `npm run build` and `node dist/research-si-half-hour-liquidity.js`. Ignored machine report `.trading/si-half-hour-liquidity-v1.json` has SHA-256 `68a88ccce38cb93a3848a8e884a56908032064b6cc646274f25d16e1100149b3`.

There were 117 weekdays in the predefined interval, including one verified no-session date; 116 had complete first-half-hour history and exact entry/exit candles. No cancellations or unresolved exits occurred. The sign-only rule traded on all 116 dates.

| Contract | Trades | Base net winners | Stress net winners | Mean gross | Mean base net | Mean stress net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SiU5 | 52 | 12 | 9 | +0.111% | −0.189% | −0.289% |
| SiZ5 | 64 | 27 | 24 | +0.096% | −0.204% | −0.303% |
| Combined | 116 | **39 (33.6%)** | **33 (28.4%)** | +0.103% | **−0.197%** | **−0.297%** |

**Decision:** reject this rule. It meets the raw 100-trade count but fails both the 51% net-win and positive-mean gates on each contract and combined. Gross positivity is insufficient to pay the assumed Investor-tariff commission and adverse execution. Do not tune the sign threshold or entry/exit minutes against this same sample. The result does not disprove the cited academic mechanism in its original market/period or a different independently specified strategy. No stop, live spread, fill, margin or tax evidence exists, and no order was placed.

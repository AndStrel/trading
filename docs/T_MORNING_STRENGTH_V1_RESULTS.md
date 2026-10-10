# T share morning-strength v1 — 2025 discovery result

**Reject under both cost scenarios.** The [rule](T_MORNING_STRENGTH_V1.md) was fixed before outcome inspection. The ignored report `.trading/t-morning-strength-v1-2025.json` reproduced SHA-256 `42032f10fc3d94b1b7b2c45880530d6348df6dcaef7390b792f153109745be31`. [Source checkpoint](T_2025_SOURCE_CHECKPOINT.md).

Of 261 weekdays, eight lacked required signal anchors, 196 stayed in cash, 56 completed same-day trades, and one signaled entry became unresolved because a minute was missing while holding. No entry cancellation. Gross winners were 31/56 (55.36%); mean gross return +0.18588% per completed trade. This is not net profitability.

| Frozen cost scenario | Net winners | Mean net/trade | Stressed mean | Sum without best five | Worst trade |
| --- | ---: | ---: | ---: | ---: | ---: |
| Investor 0.30% commission/side | 19/56 (33.93%) | −0.51902% | −0.61858% | −35.94969 pp | −4.74172% |
| Conditional Pro, zero broker commission | 29/56 (51.79%) | +0.07966% | **−0.02050%** | **−5.47396 pp** | −4.16845% |

The Pro row is conditional on paid Pro benefits, actual account eligibility and room within 15 daily eligible trades. Its 299 RUB/month or 1,990 RUB/year subscription cost is **not** in the per-trade result. Even before that cost, this scenario fails the minimum 100 trades, zero unresolved, positive stress mean, and positive sum after removing five best trades. The July–December stressed mean is −0.08165%. One −4.17% base-net tail loss is material compared with the small average gain. Investor costs fail outright; omitting assumed tick rounding still leaves mean Investor base net −0.51298%, so an uncertain historical tick cannot reverse that conclusion.

Do not tune the threshold, entry/exit windows, or slippage on 2025. Per the frozen gate, do not run this rejected rule on 2026. Past trade prints are not bid/ask fills, and actual tax/subscription/account costs remain unverified. No real orders.

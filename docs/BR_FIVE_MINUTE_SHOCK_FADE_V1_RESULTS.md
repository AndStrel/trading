# BR five-minute shock fade v1 — result

**Reject this fixed hypothesis.** The frozen [protocol](BR_FIVE_MINUTE_SHOCK_FADE_V1.md) SHA-256 is `2479321ca49984ec3eb070cdfa162ff6c445caa12a5228414f472467a3a44118`. Locked source report hashes: 2025 `0accb82bf1f5ac7808df713620cab57a4217e440d9a369f4817c863476f95969`; 2026 `d8721ce74334619fc1c7f6f960a85d6e77e7ddcb050958163a9b9d8081caf57a`. Reproducible local report `.trading/br-five-minute-shock-fade-v1.json` SHA-256: `f43f37928a7852602580f63f099daee3449244ea28f891f4dbc1854186064dac`.

## Combined result

- 264 regular sessions, 11 signal-window data gaps (95.8% coverage), 131 cash sessions, 122 completed trades; no cancelled entry or unresolved exit.
- 57 long and 65 short; 23 targets, 65 stops, 34 time exits.
- Gross winners 49/122 (40.2%); base-net winners 28/122 (23.0%); stress-net winners 26/122 (21.3%).
- Mean gross −0.007%; mean base −0.307%; mean stress −0.407%. Additive base sum −37.47% of entry notional; after removing the best trade −37.77%. Profit factor 0.17.
- Average base winner +0.276%; average base loser −0.481%.

By year, the rule produced 23 trades in 2025 (4 base winners, 17.4%; mean base −0.335%) and 99 in 2026 (24 base winners, 24.2%; mean base −0.301%). The weak win rate and negative mean repeat in both years; this is not just an isolated outlier. 2025 alone is too small to establish a standalone sample, but it does not support the direction of the hypothesis.

The failed result is concentrated in risk: the 0.30% stop was reached on 65/122 trades, while wins were too small after costs. The 0.60% target returned roughly +0.30% net at base assumptions, but only 23 trades reached it. The rule misses the 51% net-win and positive-expectancy gates by a wide margin. Do not adjust thresholds on these same histories.

The 11 days with gaps inside the 10:00–12:59 trigger-discovery window were excluded before outcomes; coverage exceeded the frozen 90% threshold in both years. OHLC replay remains a screening model and does not prove executable bid/ask fills or account-level returns. No orders were sent.

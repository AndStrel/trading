# BR overnight gap fade — 2024 one-time holdout result

**Reject the reversal hypothesis.** The frozen [protocol](BR_OVERNIGHT_GAP_FADE_2024_V1.md) SHA-256 is `aa910d38dd382a2b8003c827d13dd7a5e399cf4a8c6b8dd94bd2455e037ee96e`. The source report SHA-256 is `49fe00ecb754dbb7af599a1765cbc7b762b2a4189da68a4b70124f9304fd7494`. Local report `.trading/br-overnight-gap-fade-2024-v1.json` SHA-256 is `6e022d0d6c0f2c4b6683a8c1b8d2f0d1d54c944666e3b92c1f7323d9f8e30d8d`.

The archive contains 192 source dates, including the exchange's working Saturday, 187 dates with candles, and five official no-session holidays. After one first-date exclusion and eight contract-roll exclusions, there were 128 completed trades; 16 more paths were unresolved due to missing holding candles. Gross winners: 62/128 (48.4%); base-net winners: 46/128 (35.9%); stress-net winners: 43/128 (33.6%).

Mean gross return was −0.0038%, base −0.304%, stress −0.404%. The rule hit 50 stops, 21 targets, and 57 time exits. Base profit factor was 0.36; the sum after removing the best trade was −38.87% of entry notional. Thus the reverse gap direction also fails the win-rate and expectancy gates before considering unresolved paths. This was the one planned calculation on the 2024 vintage; do not retune its threshold, barrier sizes, or holding period on these dates.

The source protocol explicitly disclosed that this direction was chosen after continuation failed on 2025–2026. This is a separated historical vintage, but not a prospective confirmation. OHLC replay is not evidence of executable spread/queue fills or account return. No orders were sent.

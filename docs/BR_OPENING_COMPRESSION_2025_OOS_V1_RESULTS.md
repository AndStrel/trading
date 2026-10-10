# BR opening-compression breakout — 2025 transfer result

**Reject this unchanged rule.** The protocol and source were SHA-256 locked before calculating outcomes. The [protocol](BR_OPENING_COMPRESSION_2025_OOS_V1.md) hash is `20286faa33a2c301e41326b0692ed294a0b706ee121578a68dffe5bf7ba28acc`; the source report hash is `0accb82bf1f5ac7808df713620cab57a4217e440d9a369f4817c863476f95969`. The reproducible local result `.trading/br-opening-compression-2025-oos-v1.json` has SHA-256 `55a4b064cd19e4c1080e4186334fb285f2d8044f1be4df9db76206e133630a2d`.

## Result

- 134 calendar weekdays: 131 verified exchange sessions and 3 official no-session dates (1 May, 9 May, 12 June); 2 sessions lacked a complete opening range.
- 41 cash days; 76 completed trades (34 long, 42 short); 27 stops, 16 targets, 33 time exits.
- Gross winners: 36/76 (47.4%). Base-net winners: 25/76 (32.9%); stress-net winners: 22/76 (28.9%).
- Mean return per completed trade: gross +0.009%, base −0.291%, stress −0.391%. Base sum −22.10% of entry notional across trades; stress sum −29.69%. These are additive notional-normalized trade returns, not account or margin returns.
- Base profit factor 0.37; base sum after removing the best trade −22.80%.
- March–May: 24 completed trades, 8 base-net winners (33.3%), mean base −0.336%, stress −0.435%.
- June–September: 52 completed trades, 17 base-net winners (32.7%), mean base −0.270%, stress −0.370%.
- 12 unresolved-holding records, including 8 entries whose later outcome cannot be recovered from the one-minute archive. Their outcomes are unknown, not silently marked as wins or losses. This separately fails the no-unresolved-execution screen.

The test misses the minimum 100 trades, the 51% net-win target, positive net expectancy in both subperiods, profit factor above one, and complete execution paths. The negative result among completed cases already rejects this transfer; resolving the missing-bar paths cannot make the tested version pass its sample or observed expectancy gates. Do not retune this rule on the same 2025 or 2026 histories.

This is candle replay using hypothetical fee and slippage assumptions. It does not establish achievable queue fills, order-book spread, ruble P&L, margin returns, tax, or live performance. No orders were sent.

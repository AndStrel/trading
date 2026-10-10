# BR overnight gap continuation v1 — result

**Reject this fixed rule.** The frozen [protocol](BR_OVERNIGHT_GAP_CONTINUATION_V1.md) SHA-256 is `b49b44521d7b33374b449aba5c28172cd4bc98b88f4043c651dbea693d4f8de0`. Locked MOEX source hashes: 2025 `0accb82bf1f5ac7808df713620cab57a4217e440d9a369f4817c863476f95969`; 2026 `d8721ce74334619fc1c7f6f960a85d6e77e7ddcb050958163a9b9d8081caf57a`. Local result `.trading/br-overnight-gap-continuation-v1.json` SHA-256 `c9721f8d12b67495d783137cb302fd568c66a31c657b72448762699fc56822d2`.

After excluding official no-session dates, special sessions, first source dates, and contract-roll dates, the replay had 197 completed trades; 11 more entries were unresolved due to missing later candles. Base-net winners were 72/197 (36.5%); gross winners 79/197 (40.1%). Mean gross return was −0.058%, mean base net −0.358%, stress mean −0.458%. There were 111 stops, 63 targets, and 23 time exits. Profit factor was 0.39; additive base sum −70.59% of entry notional.

The result was negative in both years: 2025 had 27/85 base-net winners and mean −0.405%; 2026 had 45/112 winners and mean −0.323%. The edge is negative before costs as well as after them, so a cheaper fee schedule alone cannot rescue this direction. Do not retune continuation thresholds on these periods.

This rejection motivated a single, separate 2024 test of the opposite gap direction. That follow-up is explicitly disclosed as a new hypothesis selected after viewing this screen; the 2024 source archive had not been used in the prior BR tests.

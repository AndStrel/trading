# Si main-session handoff momentum v1 — rejected

The [locked rule](SI_MAIN_SESSION_MOMENTUM_V1.md) was scored on the frozen 2026 exact-contract archive (09:00–09:59 signal, 10:01 entry, stop/target/time exit). Report SHA-256 `d0652810760ce61ab9f41a0a69afce65948df254dfb60d9e6cfa25ec45eeed0f`. Reproduce: `npm run build` and `npm run research:si-main-session-momentum`; report `.trading/si-main-session-momentum-v1.json`.

| Metric | Value |
| --- | ---: |
| Resolved trades | 132 |
| Base-net win rate | 30.3% |
| Mean base net | −0.342% |
| Mean stress net | −0.442% |
| Sum base net | −45.2% |
| March–May mean base | −0.219% |
| June–Sep mean base | −0.413% |

Post-result schedule note in the protocol applies: the 09:00 clock-time signal spans two MOEX session regimes in 2026; the post-change block has only 10 trades and cannot satisfy the 100-trade gate alone.

**Decision:** reject this handoff rule. Do not retune stop, target, or signal hour on this archive. No orders.

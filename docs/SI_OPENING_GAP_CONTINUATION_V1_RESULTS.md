# Si opening-gap continuation v1 — rejected

The [locked rule](SI_OPENING_GAP_CONTINUATION_V1.md) was scored on the frozen 2026 exact-contract archive (prior 16:55 vs next 10:00, 10:05 entry, stop/target/time exit). Report SHA-256 `69990428bf2bf334ef8e9a4585c0f793bb0f292c6a1bafe3233ad74f601125b9`. Reproduce: `npm run build` and `npm run research:si-opening-gap`; report `.trading/si-opening-gap-continuation-v1.json`.

| Metric | Value |
| --- | ---: |
| Resolved trades | 103 |
| Base-net win rate | 28.2% |
| Mean base net | −0.336% |
| Mean stress net | −0.436% |
| Sum base net | −34.6% |

The protocol’s post-result schedule note applies: under the 2026 unified session, the tested reference is a partial-session move, not a true overnight gap. Even as a same-day screen, the rule fails the 51% net-winner and positive-mean gates.

**Decision:** reject. Do not retune gap reference times or stops on this archive. No orders.

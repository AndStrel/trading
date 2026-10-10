# Si opening compression breakout v1 — rejected

The [predeclared rule](SI_OPENING_COMPRESSION_BREAKOUT_V1.md) used MOEX ISS RFUD one-minute caches (2023–2024 discovery). Protocol SHA-256 `8f699ee5df4e3acea797a130b1686b4a5e75c987067c2fa3845ad550b9da8c23`. Reproduce: `npm run build` and `npm run research:si-opening-compression-breakout`; report `.trading/si-opening-breakout-v1.json`.

| Metric | Value |
| --- | ---: |
| Completed trades | 118 |
| Unresolved holding | 2 |
| Base-net win rate | 23.7% |
| Mean base net | −0.343% |
| Profit factor | 0.20 |
| Sum base net | −40.5% |

Fails development gates on win rate, mean net, profit factor, and unresolved paths.

**Decision:** reject this compression-breakout rule on the frozen sample. No parameter retune. No orders.

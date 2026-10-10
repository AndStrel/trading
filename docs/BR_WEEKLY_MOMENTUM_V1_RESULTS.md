# BR weekly momentum continuation v1 — rejected at development gate

**Reject this fixed rule.** The frozen [protocol](BR_WEEKLY_MOMENTUM_V1.md) SHA-256 is `5222111bfe85958e513ea6e0a7924ffe450c5d26f6ad9ac885b9272b5788fc07`. Local report `.trading/br-weekly-momentum-v1.json` documents the run. Reproduce with `npm run build` and `node dist/research-br-weekly-momentum.js`.

## Combined 2024–2025 discovery

| Metric | Value |
| --- | ---: |
| Completed trades | 39 (gate: ≥50) |
| Base-net win rate | 46.2% (gate: ≥51%) |
| Mean base net | −0.186% |
| Mean stress net | −0.286% |
| Profit factor | 0.84 |
| Sum base net ex. best week | −18.4% |

2024 block mean base net was negative; 2025 block mean base net was negative. Zero cancelled or unresolved paths.

## Decision

Prior-week momentum continuation in exact-contract BR futures does not clear the frozen development gates on 2024–2025 MOEX archives. Do not retune move thresholds, entry/exit minutes, or ISO-week definitions on these samples. A sealed 2026 test is not authorized from this screen. No broker orders.

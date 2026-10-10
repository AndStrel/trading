# Si first-hour continuation v1 — rejected at development gate

The [predeclared rule](SI_FIRST_HOUR_V1.md) was reproduced from locked MOEX ISS RFUD exact-contract one-minute caches in `.trading/si-first-hour-v1/`. Protocol SHA-256 at this run: `ff5c7424604f61afbb0349919e16462687d3fe6203ea390e844ea55319bed357`. Reproduce with `npm run build` and `npm run research:si-first-hour`; full report `.trading/si-first-hour-v1.json`.

| Metric | Value | Gate |
| --- | ---: | --- |
| Completed trades | 42 | ≥100 |
| Base-net win rate | 38.1% | ≥51% |
| Mean base net | −0.198% | >0 |
| Mean stress net | −0.298% | >0 |
| Profit factor | 0.47 | >1 |
| Sum base net ex. best date | −9.9% | >0 |
| Unresolved / cancelled | 0 | 0 |

SiU5 block failed (15 trades, 6.7% winners). SiZ5 alone showed 55.6% winners but negative mean net (−0.042%) and failed the per-contract economic gate. Verified no-session date 2025-11-04 per MOEX schedule.

**Decision:** reject this fixed ±0.3% first-hour continuation with 11:01–17:00 holds. Do not retune the threshold or hours on this 2025 sample. No broker orders.

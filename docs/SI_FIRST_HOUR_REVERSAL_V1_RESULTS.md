# Si first-hour reversal v1 — rejected

The [rule and gate](SI_FIRST_HOUR_REVERSAL_V1.md) were fixed before the candidate's returns were calculated. Reproduce offline with `npm run build` and `node dist/research-si-first-hour-reversal.js`. The source-report SHA-256 is `ed8c32be0f099e8caeb8d773b6edaa7cac08e397c326fe2135ba810e56c36b74`; the full ignored report `.trading/si-first-hour-reversal-v1.json` has SHA-256 `16d4fbb338c0c8862b29008fbc7026814e8213e284337df98d30bdbb3baaaf09`.

All 133 ordinary dates produced one completed trade; there were no missing signals, entries, holding minutes or exits. Opposing the 10:00–10:59 direction at 11:01 and exiting at 16:55 gave 38/133 = **28.6% base-net winners**, far below the fixed 51% gate. Mean gross return was +0.0061% per trade, but mean base net was **−0.2940%**; stress mean was −0.3940%. Base profit factor was 0.312. Net sum without the best date was −40.9997 percentage points across the remaining simulated trades.

The failure is not isolated to a single roll: SiM6 13/57 (22.8%), SiU6 21/65 (32.3%), SiZ6 4/11 (36.4%). The March–June and July–September blocks each had 28.6% net winners and negative mean net returns. Thus both win-rate and expectancy gates fail even before executable quote and fill validation.

**Decision:** reject this precise first-hour reversal rule. The 2026 data were previously used by other research and are not an untouched holdout. Do not tune the sign threshold or entry/exit times on the same sample and relabel it as independent evidence. Historical minute prints do not establish executable bid/ask prices, market impact, margin sufficiency or taxes. No order was placed.

# TRUR 2025 same-day long v1 — rejected

The [rule and costs](TRUR_INTRADAY_V1.md) and [missing-exit bound interpretation](TRUR_2025_MISSING_EXIT_BOUND_PROTOCOL.md) were fixed before reading 2025 price outcomes. The [timestamp-only checkpoint](TRUR_2025_SOURCE_CHECKPOINT.md) found 253 active weekdays, 247 entry prints, 238 days with both prints, and 9 entered days with no observed exit. The source manifest SHA-256 was verified as `e5128b98d3d9f2252300156de49128744ff1e32de7736ce1bfedec84e255fd56`; each raw day is hash-checked on read. Reproduce with `npm run build` and `node dist/research-trur-2025-bound.js`. The ignored machine report `.trading/trur-2025-bound.json` has SHA-256 `87cdef2515ec909b627c24041820216236635310205327bbb1eae0524ec18f87`.

The fixed gate needs at least **126 strictly positive net outcomes among 247 entered dates**. For each range below, the lower end treats all nine unknown exits as losses and the upper end assumes all nine were winners. These are bounds on the **trade-print proxy**, not on actual executable quotes.

| Conditional cost case | Observed paired-print wins | Possible wins among entered days | Possible win fraction |
| --- | ---: | ---: | ---: |
| Gross, no costs | 76 | 76–85 | 30.8–34.4% |
| Base, 0.02% adverse per side | 76 | 76–85 | 30.8–34.4% |
| Stress, 0.05% adverse per side | 76 | 76–85 | 30.8–34.4% |
| Severe, 0.10% adverse per side | 53 | 53–62 | 21.5–25.1% |

**Decision:** reject this unconditional 10:01–10:03 long to 16:55–17:00 exit rule. Even the no-cost, hindsight-favorable missing-exit bound cannot reach 51%; the zero-unresolved-exit gate also fails. No need to inspect mean return or tune the windows on the same 2025 dates. This does not prove TRUR has no other possible strategy, and the low long win rate does not imply a feasible or profitable short. Actual 2025 broker fees, spread, lot size, historical tick, filling and taxes remain unverified. No orders were placed.

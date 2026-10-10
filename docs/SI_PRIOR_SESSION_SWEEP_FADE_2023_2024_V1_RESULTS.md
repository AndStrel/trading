# Si prior-session sweep fade v1 — results

**Decision: reject this exact rule.** This was a frozen, offline research run;
it did not connect to the broker, download data, or submit orders.

## Reproducibility

- Protocol: `SI_PRIOR_SESSION_SWEEP_FADE_2023_2024_V1.md`
- Protocol SHA-256: `a67e5bb7cbd22aa944d52dc095ecc80c73b510f675c2539494608c75cef1b3ed`
- Frozen local archive inventory SHA-256:
  `bcffb767570bf75bd61c922494dd80d15739563773cb600dd0cd5532498ca5a3`
- Machine report: `.trading/si-prior-session-sweep-fade-2023-2024-v1.json`
- Machine report SHA-256:
  `367cb94ff621e7497c3202f278cdff37b1fe890ba67d3d62abf539dac5a577ee`
- Archive: 232 previously used compressed daily snapshots, July–December
  2023 and July–December 2024. This is exploratory reuse, not an independent
  holdout.
- Costs: 0.10% commission per side, 0.05% adverse slippage per side (base);
  stress slippage 0.10% per side.

## Results

| Measure | Combined | 2023 | 2024 |
|---|---:|---:|---:|
| Completed trades | 149 | 71 | 78 |
| Net winners | 7 (4.7%) | 2 (2.8%) | 5 (6.4%) |
| Mean gross return/trade | +0.008% | −0.014% | +0.028% |
| Mean base-net return/trade | **−0.292%** | −0.314% | −0.272% |
| Mean stress-net return/trade | **−0.392%** | −0.414% | −0.372% |
| Base profit factor | 0.025 | 0.002 | 0.049 |
| Base-net sum | −43.55% | −22.32% | −21.23% |

Combined exits: 99 stops, 48 targets, 2 time exits. The base-net total remains
−44.19% after removing the best trade. Every tested contract had negative
mean base-net return. The development gate requires at least 51% net winners,
positive base and stressed expectancy, profit factor above one, positive
performance by year and contract, and adequate data quality. Performance
fails decisively even before considering the archive-quality failures.

## Data-quality limits

There were 4 archive-boundary warmup dates, 1 special session, and 1 verified
no-session date. Six dates were marked `missing_reference`: 2023-08-21,
2023-09-14, 2024-09-12, 2024-09-13, 2024-11-13, and 2024-11-20. One date,
2023-09-13, had a missing required signal-window minute before a signal could
be ruled in or out. No missing fill was inferred. These statuses independently
fail the predeclared data-quality gate.

## Verification and interpretation

The frozen replay reported `failed-or-insufficient-development-gate`.
`npm run build` passed; full suite passed (104 files, 336 tests). The OHLC
simulation cannot establish bid/ask executable fills. Do not tune this rule
against the same observations or infer that a 51% profitable strategy exists.

The 14:00–14:04 clearing schedule and the holiday exclusions follow the
official MOEX calendar sources linked in the protocol.

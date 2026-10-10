# TMON 2025: missing-exit bounds, not a backtest pass

The rule and rejection-only interpretation were frozen in [the protocol](TMON_2025_COVERAGE_BOUND_PROTOCOL.md) before reading candle prices. The source manifest hash was checked as `05cfe825a69277c84b1243fb1c8084840853a174bf39b8a4efdaeb6b195a1b7f`; each compressed day is individually hash-checked. Reproduce with `npm run build` and `node dist/research-tmon-2025-coverage-bound.js`. Machine report: ignored `.trading/tmon-2025-coverage-bound.json`, SHA-256 `d2363e086cf5ad2955c37405aa7c30edbd305d496750b5c8348d32c5dc8ea5fd`.

Of 253 active weekdays, 69 had no entry print. The remaining **184 entered days** comprise **141** with an observed exit-window trade and **43 unresolved exits**. A 51% net-win threshold requires at least **94/184** winners. The interval below assumes every unresolved exit lost at its lower end and every unresolved exit won at its upper end; neither assignment is known to be true.

| Conditional cost case | Wins on 141 paired-print days | Possible wins among 184 entered days | Possible win fraction | Upper bound reaches 51%? |
| --- | ---: | ---: | ---: | --- |
| Gross, no costs | 79 | 79–122 | 42.9–66.3% | Yes, inconclusive |
| Base, 0.005% adverse per side | 75 | 75–118 | 40.8–64.1% | Yes, inconclusive |
| Stress, 0.010% adverse per side | 66 | 66–109 | 35.9–59.2% | Yes, inconclusive |
| Severe, 0.030% adverse per side | 33 | 33–76 | 17.9–41.3% | **No** |

The severe-cost case cannot reach the 51% win-rate bar even if all 43 unknown exits were winners. Base and stress cannot be accepted or rejected from this archive. The observed 75/141 base wins must **not** be advertised as a 53.2% strategy success rate: availability of the exit print was learned only after entry, and no print proves the bid/ask execution price. The frozen v1 still fails its zero-unresolved-exit gate. Mean net return, benchmark superiority, actual spread and fillability remain unproven. No trading authorization follows.

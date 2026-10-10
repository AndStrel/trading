# IMOEXF first-hour to final-half-hour v1 — result

Protocol SHA-256: `56fe50fc8dd76f1ee15b3d612fd94f4b7f9053aabea4dc00eb78d05b492b1b19`. Source manifest SHA-256: `f00d01343619662f2438f5d12d5cfda693369a7a5dd2cf95e59f564271951996`.

**Decision: REJECT_THIS_RULE.** This is an OHLC screen, not an executable-fill result.

Source calendar: 573 dates, of which 568 weekdays. 549 complete first-hour windows, 15 zero signals left in cash, 534 nonzero signals requiring execution, 71 unresolved dates.

| Period | Trades | Net winners | Win rate | Mean RUB | Median RUB | Total RUB | Stress total RUB |
|---|---:|---:|---:|---:|---:|---:|---:|
| Combined | 482 | 65 | 13.49% | -61.73 | -62.66 | -29754.36 | -34574.36 |
| 2024 | 83 | 20 | 24.10% | -53.46 | -60.59 | -4437.17 | -5267.17 |
| 2025 | 243 | 32 | 13.17% | -60.43 | -59.57 | -14683.90 | -17113.89 |
| 2026 | 156 | 13 | 8.33% | -68.16 | -67.00 | -10633.29 | -12193.29 |

Combined base net P&L excluding the five best trades: RUB -30701.65.

## Admission gates

- PASS — sampleAtLeast100TradesAnd50Dates
- FAIL — baseNetWinRateAtLeast51Percent
- FAIL — baseMeanAndMedianPositive
- FAIL — everyCalendarYearNetPositive
- FAIL — stressAggregatePositive
- FAIL — excludingBestFivePositive
- FAIL — noUnresolvedOrCancelledDates

## Limitations

- Trade-print candle opens and closes are not executable bid/ask fills; fixed adverse-tick costs are only a screening model.
- Uses current published Investor broker commission and MOEX transaction fee as historical proxies; the user tariff is unverified.
- Excludes personal taxes, margin financing, queue position, and market impact.
- A pass is not an order authorization and requires prospective route-specific bid/ask shadow validation.

Reproduce after source verification with `node dist/research-imoexf-first-hour-last-half-hour-run.js`. JSON: `.trading/imoexf-first-hour-last-half-hour/results.json`.

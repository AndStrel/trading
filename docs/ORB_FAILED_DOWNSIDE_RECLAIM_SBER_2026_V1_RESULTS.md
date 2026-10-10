# Failed downside-break reclaim v1 — SBER 2026 result

Status: rejected. No event passed the frozen cost-to-risk filter, even in the lower-fee Trader-like sensitivity. The complete event series was negative after costs in both fee models.

Protocol was frozen before the signal outcomes were calculated: [protocol](ORB_FAILED_DOWNSIDE_RECLAIM_SBER_2026_V1.md). This is exploratory, not independent validation, because the same SBER 2026 archive had been examined for a different ORB hypothesis.

Base repository revision: `6f40c7f1de6a3f96854d82426d5b3c9a1e03390d`; experiment code is local and uncommitted. Frozen protocol SHA-256: `0817e635df691abcb0af847b5d406eed7819769415ad46a9da1c3259336d1605`. Calculation source SHA-256: `cea3498de962145f69f5e54716ebf2030d1a3738fc9000f24cb83609a5769813`; runner SHA-256: `95568f3e142d331529bf0be78e5ebfe33dbec1ab2690420986541c1705b03a36`; dated calendar SHA-256: `d1fcbe349ae8d483a0982c1f63d8155c52b224724589093b0ab2bb74bdd76393`.

## Data and execution evidence

- Archive: MOEX SBER, 219,170 candles, zero invalid rows, lot size 1, price step 0.01.
- Archive SHA-256: `071a696ec0319ab49b4d826b4c1784db161e9610ccdee922f756cc3c18ffe194`.
- Dates: last imported candle 2026-09-26; 246 observed dates, 66 rejected as weekend/closed/special-session dates, 180 complete ordinary weekday windows, no missing measurement/exit minutes.
- Event funnel: 94 closes below the opening-range low; 41 reclaimed within five minutes; 39 had a valid next-minute entry; 2 entries were rejected. All 39 event exits were fully observed.
- Fee models: Investor commission 0.30% per side + 0.05% slippage per side; Trader-like sensitivity 0.05% commission + 0.05% slippage per side, excluding the possible monthly service charge. The current public tariff page describes these rates as starting rates: [T-Bank tariff page](https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/).
- Exchange calendar/clock profile is the same dated 2026 ordinary-weekday schedule as the ORB report: [March 23 schedule change](https://www.moex.com/n97596), [September 14 main-session change](https://www.moex.com/n103379), [2026 holiday schedule](https://www.moex.com/n94172).
- Reproduction after `npm run build`: `T_INVEST_MARKET_DATA_PATH=.trading/market-data.sqlite node dist/research-orb-failed-downside-reclaim-2026.js`.
- The process read only the local archive; it did not contact the broker or submit orders.

## Frozen-rule result

| Measure | Investor primary | Trader-like sensitivity |
| --- | ---: | ---: |
| Eligible trades after cost/risk filter | 0 | 0 |
| Completed signal-event paths (diagnostic only) | 39 | 39 |
| Net winners in those diagnostic paths | 0 / 39 | 4 / 39 (10.3%) |
| Mean net return in diagnostic paths | −0.6780% | −0.1801% |
| Exit reasons in diagnostic paths | 21 stops, 17 targets, 1 time exit | same |
| Mean excluding the best diagnostic event | −0.6871% | −0.1893% |

The diagnostic paths apply the fixed stop/2R/time exit to every signal even when the protocol's cost/risk rule rejects it. They are not a valid trade sample and must not be represented as such. They are included to show the underlying move did not become attractive simply because the admission filter removed all events.

Across the three exchange-clock regimes (before March 23, March 23–September 13, and from September 14), the Trader-like diagnostic win rates were 0/8, 4/25, and 0/6; mean net returns were −0.173%, −0.173%, and −0.220%, respectively. None approaches the 51% gate, and no subgroup is selected as a replacement rule.

The hypothesis fails: zero eligible trades means it cannot meet the 100-trade minimum, while all-event win rates and mean net returns are negative after costs in both scenarios. Do not loosen the stop, widen the reclaim window, or retune the target on this sample. Move to a distinct mechanism or collect future paper evidence.

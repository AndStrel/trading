# ORB + RVOL v1: SBER 2026 regular-session result

Status: rejected; the frozen candidate failed both the low-fee project default and the public Investor-tariff scenario.

## Protocol and provenance

- Candidate: unchanged `orb-rvol-research-v1` from `RESEARCH_ORB_RVOL_V1.md`.
- Instrument: SBER only. The 2026 local minute archive contains no other requested liquid-20 instrument, so this is not evidence for the full basket.
- Sample cutoff: last imported candle 2026-09-26 11:47 UTC; Saturday observations excluded by the weekday-only calendar.
- Archive SHA-256: `071a696ec0319ab49b4d826b4c1784db161e9610ccdee922f756cc3c18ffe194`.
- Base repository revision: `6f40c7f1de6a3f96854d82426d5b3c9a1e03390d`; the research changes are local and uncommitted. Calendar source SHA-256: `d1fcbe349ae8d483a0982c1f63d8155c52b224724589093b0ab2bb74bdd76393`; runner SHA-256: `913e9ffef598570c43f5482bd5b6e4d22b9eb1914e6e590fc85f7d8bfc165d6c`; replay parser SHA-256: `855bb22c4fe2d2e8de2edd512ce0eb7b71bcc31d5570820d8f164f1cb7c4ec3c`; signal/exit calculation source SHA-256: `a8ecde62725f816ebcd1a82c2e1a1d2862b17f0bc7bcbd4d821e3766f121c4ff`.
- Archive: 219,170 minute candles; zero invalid rows; lot size 1; price step 0.01.
- Calendar: `moex-equities-2026-regular-weekdays-v1`. It excludes weekends and MOEX special holiday sessions. Regular weekday main-session profile is 10:00–18:40 through 2026-03-22, 10:00–18:55 from 2026-03-23 through 2026-09-13, and 09:00–18:55 from 2026-09-14. Each event stores its profile identifier.
- Frozen signal parameters: 30-minute opening range; first upward breakout; RVOL30 ≥ 1.5; 20 comparable prior sessions; 120-minute maximum hold; 2R target; one-tick stop buffer; minimum stop distance 3x estimated round-trip cost. The signal and exit rules are identical in both cost scenarios.
- Cost scenarios: (A) the code's optimistic/Trader-like project default: commission 0.05% and slippage 0.05% per side, with no monthly tariff charge; (B) public Investor plan commission 0.3% per side plus the same 0.05% slippage. MOEX/broker spread and actual account tariff were not observed; the official public tariff states Investor is from 0.3% per stock transaction and Trader is 0.05% plus possible 390 ₽ monthly fee ([T-Bank tariff page](https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/)).
- Reproduction after `npm run build` (explicit archive and costs):
  - A: `T_INVEST_MARKET_DATA_PATH=.trading/market-data.sqlite T_INVEST_COMMISSION_RATE=0.0005 T_INVEST_SCANNER_SLIPPAGE_RATE=0.0005 node dist/backtest-orb-rvol.js --year 2026 --ticker SBER`
  - B: `T_INVEST_MARKET_DATA_PATH=.trading/market-data.sqlite T_INVEST_COMMISSION_RATE=0.003 T_INVEST_SCANNER_SLIPPAGE_RATE=0.0005 node dist/backtest-orb-rvol.js --year 2026 --ticker SBER`
- The runner only read the local archive and did not contact the broker or submit orders.

## Result

| Measure | Result |
| --- | ---: |
| Archive dates observed | 246 |
| Dates rejected by calendar | 66 |
| Complete ordinary weekday sessions | 180 |
| Complete opening ranges | 180 |
| Insufficient RVOL warm-up sessions | 1 |
| Breakout events before eligibility filters | 86 |
| Missing range, signal, entry, or exit data | 0 |
| Eligible high-RVOL trades, scenario A | 10 |
| Net winners at the strategy exit, scenario A | 0 / 10 (0%) |
| Mean net result per eligible trade, scenario A | −0.5886% |
| Eligible high-RVOL trades, scenario B | 0 |
| All-event 60-minute net-positive rate, scenario B | 5 / 86 (5.8%) |
| All-event 60-minute mean net, scenario B | −0.7390% |
| Strategy exits, scenario A | 9 time exits, 1 stop, 0 targets |

The fixed-horizon event study under scenario A is also negative for all 86 breakout events: mean net return is −0.1836% at 15 minutes, −0.2090% at 30 minutes, −0.2391% at 60 minutes, and −0.3025% at 120 minutes. Among the 10 high-RVOL cost-eligible events, the 60-minute mean is −0.5837% with 0% net-positive events; the 120-minute mean is −0.5241%, also with 0% net-positive events. Under scenario B, the 60-minute mean for all 86 events falls to −0.7390%, and only 5.8% are net positive; none clears the 3x cost-to-risk eligibility gate.

The optimistic scenario A fails both the ≥51% net-win requirement and the minimum 100-trade sample gate; the Investor-fee scenario has no eligible trades and only a 5.8% net-positive rate at the fixed 60-minute horizon. No threshold adjustment or subgroup selection is justified by this result; the frozen v1 candidate is rejected for SBER on this sample. Further research should move to a distinct, predeclared mechanism rather than optimize this rule on the same 2026 observations.

## Exchange schedule sources

- MOEX changed the stock-market closing auction and the regular trading-period end on 2026-03-23: [MOEX notice](https://www.moex.com/n97596).
- MOEX moved the start of the main session to 09:00 from 2026-09-14; the notice also distinguishes weekday and weekend hours: [MOEX notice](https://www.moex.com/n103379).
- The 2026 holiday schedule identifies closed and holiday-trading dates: [MOEX notice](https://www.moex.com/n94172).

# CBR SBER first-reaction continuation v1 — rejected

**Reject this fixed rule.** The protocol was frozen before the return replay. The official-calendar schedule and one-minute price windows were not altered after results were seen. This was historical research only: public MOEX candles, no broker token or account endpoint, and no orders.

## Reproduction and provenance

- Protocol: [CBR_SBER_REACTION_MOMENTUM_V1.md](CBR_SBER_REACTION_MOMENTUM_V1.md), SHA-256 `944aeff77ecd9364ee0c14597bf35a8c34727ea9d29e7c5970724ca6cf48bfb9`.
- Reproduce after `npm run build` with `CBR_SBER_EVENT_DB=<local database> CBR_SBER_EVENT_REPORT_PATH=.trading/cbr-sber-reaction-v1.json node dist/research-cbr-sber-reaction.js`.
- Machine report: ignored local file `.trading/cbr-sber-reaction-v1.json`, SHA-256 `5d926f2a309ece760851ec21b5ab455f0aaec78aa7570262340c9b57f8978853`; it contains each event window, annual/block summaries, archive SHA-256 values, and missing timestamps.
- Sources were MOEX ISS public TQBR SBER one-minute archives, 2015–2026-09-28. All 12 archive hashes are pinned in the report and verified by the runner. 2015 and 2017 each have one invalid source row and zero duplicate rows; the other ten years have zero invalid and duplicate rows. Required timestamps absent from the validated store are unresolved, never imputed.

## Result

| Measure | Result |
|---|---:|
| Frozen event windows | 188 across 94 decision dates |
| Resolved trades | 180 across 93 dates |
| Flat signal windows | 5 |
| Missing-data windows | 3 |
| Gross-positive trades | 68/180 (37.8%) |
| Base net-positive trades | 5/180 (2.8%) |
| Mean gross return | −0.1002% per trade |
| Mean base net return | −0.8003% per trade |
| Mean stress net return | −0.9003% per trade |
| Base profit factor | 0.0126 |
| Positive date-cluster sums | 0/93 |

The historical model uses Investor commission of 0.30% per side, plus 0.05% adverse execution per side at base and 0.10% per side under stress. The current official tariff page confirms the 0.30% Investor share commission; modeled all-in costs are approximately 0.70% and 0.80% round trip, before taxes, market impact, or borrow cost. The average move was negative before costs, and fewer than 51% of trades were positive even gross. Lower fees therefore cannot rescue this exact signal and horizon.

The rule failed the gate by a wide margin: net win rate, mean/aggregate net, stress mean, profit factor, best-five-excluded sum, all annual profitability checks, and positive date-cluster performance. Annual event-window coverage was 93.75% in 2016 (above the 90% floor) and 87.5% in 2022 (below it); 2022-03-18 had no SBER candles for either window, and one 2016 signal minute was missing. All other years met the coverage floor. These gaps do not explain the negative result.

This rejects only the frozen “follow the first five-minute move for 30 minutes” SBER rule. It does not establish that every Central Bank event strategy is impossible. Do not reverse the direction, tune the horizon, or select dates on this same sample and describe it as independent confirmation. A distinct future test needs a separately motivated, frozen mechanism and a genuinely untouched validation period. OHLC candle opens remain proxies, not proof of executable bid/ask fills; historical short availability is unverified. No trading is authorized.

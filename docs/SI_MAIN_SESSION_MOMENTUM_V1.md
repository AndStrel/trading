# Si main-session handoff momentum v1 — locked before outcome

Research only; no orders. MOEX's 2026 unified derivatives schedule starts the main session at 09:00 MSK, after an earlier morning session. Hypothesis: direction during 09:00–09:59, when main-session liquidity arrives, tends to persist into the same day's 10:01–16:55 window. This is a main-session handoff hypothesis, **not** an overnight opening-gap rule.

Use exact-contract public MOEX ISS RFUD one-minute candles for 09:00–09:59, and the frozen 10:00–17:00 archive in `.trading/si-2026-continuous-source/`. Period 2026-03-23 through 2026-09-25. Exclude special-session dates and any day without exactly 60 signal candles and 421 holding-source candles. Contract selection is the frozen date map from `si2026DaySpecs`.

Signal: if 09:59 close exceeds 09:00 open, long; if below, short; if equal, cash. Enter at 10:01 open. Stop 0.5% adverse, target 1.0% favorable, checked every minute through 16:54; when both touch within a candle, stop wins; gap past stop fills at the worse opening price. Otherwise exit at 16:55 open. Missing entry/holding/exit minute makes the day unresolved, never an assumed win. No position overnight. Do not tune the direction, threshold, times, stop or target on this 2026 sample.

Costs: T-Invest Investor futures commission 0.1% per side, adverse slippage 0.05% per side, stress slippage 0.1% per side. Reuse `siTradeReturn`. Quote-normalized result is a screening proxy, not exact ruble P&L or executable-fill evidence.

Admission: at least 100 resolved trades across 50 dates, at least 51% base-net profitable trades, positive mean and aggregate base net, positive stress mean, positive means in March–May and June–September blocks, negligible unresolved cases, independent confirmation and bid/ask/fill validation before live use.

Schedule source: https://www.moex.com/ru/derivatives/unified-trading-session

## Post-result schedule correction (2026-09-26; locked rule unchanged)

MOEX announced a change effective 2026-09-14: the main derivatives session moved from 10:00 to 09:00 (https://www.moex.com/n103379?nt=112). Therefore the 09:00–09:59 signal was the morning additional session through 2026-09-11 and the first hour of the main session only from 2026-09-14. The 132-trade result tests a fixed *clock-time* signal across both regimes, not one constant main-session mechanism. The post-change block has only 10 trades and cannot meet the 100-trade admission gate by itself. No parameter or period selection is revised after the outcome.

# Si opening-gap continuation v1 — locked before outcome

Research only; no orders. Economic premise: price discovery between the previous ordinary session's 16:55 minute and the next morning may continue after the opening auction. This is a new signal, not a parameter search on rejected first-hour rules.

Source: frozen MOEX ISS RFUD exact-contract one-minute archives in `.trading/si-2026-continuous-source/`, 2026-03-23 through 2026-09-25. Require 421 candles for both days. Consider only calendar-consecutive ordinary weekdays, same contract, to avoid unobserved weekend/special-session price discovery and contract-roll gaps. Therefore Mondays and special-session successors are excluded. No new data download for the outcome.

Rule: compare today's 10:00 open with yesterday's 16:55 close. If higher, long; if lower, short; equal means cash. Enter at today's 10:05 open, regardless of interim movement. Stop at 0.5% adverse and target at 1.0% favorable, checked on every one-minute candle from 10:05 through 16:54. If both touch in one candle, stop wins; a gap past the stop fills at the worse opening price. Otherwise exit at 16:55 open. Require every holding minute, otherwise mark unresolved and do not count a win. No position overnight.

Costs: T-Invest Investor futures commission 0.1% per side, modeled adverse slippage 0.05% per side; stress slippage 0.1% per side. Use the existing deterministic `siTradeReturn` calculation. Quote-normalized returns are a screening proxy, not exact ruble P&L, and historical bid/ask, market impact, fee rounding, tax and fill probability are unavailable.

Admission: at least 100 resolved trades on at least 50 dates; at least 51% base-net profitable trades; positive mean and sum base net; positive stress mean; positive results in both March–May and June–September blocks; no material unresolved cases; independent confirmation and executable-quote validation before any live use. No re-tuning this 2026 sample after seeing results.

## Post-result schedule correction (2026-09-26; does not change the locked rule)

The mechanism label above was inaccurate. Under MOEX's 2026 unified derivatives session, ordinary trading starts before 10:00 and continues after 16:55. Thus the tested 16:55-to-10:00 difference is a *partial-session reference move*, not a true close-to-open gap or immediate post-auction continuation. The 10:05-to-16:55 holding rule remains a valid same-calendar-day simulation, but this test cannot establish a genuine overnight-gap mechanism. Official schedule: https://www.moex.com/ru/derivatives/unified-trading-session. Do not reinterpret the failed outcome or retune the hours on this same sample.

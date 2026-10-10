# BR late-session momentum v1 — locked before outcome

Research only; no broker orders. Economic hypothesis: price discovery in Brent futures during 16:00–16:59 MSK persists through 17:00–18:55, when overlapping international energy-market activity may change liquidity and volatility. The directional rule is fixed independently of the result. The 17:00–18:59 sample on 2026-09-25 was inspected only for minute-candle coverage, not profitability.

Use the frozen MOEX RFUD exact-contract BR archive for 10:00–17:00 and a new raw MOEX archive for 17:00–18:59, dates 2026-03-23 through 2026-09-25. Monthly contract map remains March BRJ6, April BRK6, May BRM6, June BRN6, July BRQ6, August BRU6, September BRV6. Exclude special-session dates and any day without all 60 minutes of signal data (16:00–16:59), all 116 needed late-session minutes (17:00–18:55), and a valid 17:01 entry/18:55 time exit. No data imputation.

Signal: if 16:59 close exceeds 16:00 open, long; if lower, short; if equal, cash. Enter at 17:01 open. Stop 0.8% adverse, target 1.5% favorable, checked on every minute 17:01–18:54. If both touch in one minute, stop wins; a gap beyond the stop fills at the worse opening price. Otherwise exit at 18:55 open. Close every position the same calendar day.

Model T-Invest Investor futures commission 0.1% per side, adverse slippage 0.05% per side; stress 0.1% slippage per side. Quote-normalized results screen the direction only: BR prices are USD/barrel, while margin and commissions are in RUB. Exact historical RUB P&L, fill probability, spread, market impact, fee rounding and taxes are not established. A failure of the gross win-rate gate rejects the idea even before conversion or costs.

Admission: at least 100 resolved trades on 50 dates, at least 51% base-net profitable trades, positive mean and aggregate base net, positive stress mean, positive results in March–May and June–September blocks, negligible unresolved cases, independent period and executable-quote/ruble-P&L verification before any live use. No post-outcome parameter tuning on this 2026 sample.

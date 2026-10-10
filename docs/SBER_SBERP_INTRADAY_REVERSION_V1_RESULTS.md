# SBER/SBERP intraday relative-value reversion v1 — rejected

Protocol SHA-256: `906b5c82e7eb08fb3b2747403b50fe998ebe7feabee522b04976836737e8a6cf`.
Replay locally with `node dist/research-sber-sberp-intraday-reversion.js` after
the source cache has been fetched. Raw MOEX ISS pages and their SHA-256 hashes
are stored in the ignored `.trading/sber-sberp-intraday-reversion-v1/` folder;
aggregate JSON is `.trading/sber-sberp-intraday-reversion-v1.json`.

**Decision: reject this exact rule.** It generated 3,777 attempts over 949
dates: 3,776 completed trades and one unresolved exit. There were **zero net
winners** after the confirmed Investor commission, even before considering
actual spread, short-borrow fees, or market impact.

| Measure | Result |
|---|---:|
| Synchronized 10-minute bars, 2023-01-03–2026-09-25 | 79,124 |
| Completed trades | 3,776 |
| Net winners | 0 (0.00%) |
| Mean gross pair return | +0.0105% (about 1.05 bp) |
| Mean base net pair return | −0.6895% per trade |
| Mean stress net pair return | −0.7895% per trade |
| Best gross trade | +0.1719% |
| Base net trades after removing best five | −26.0089 return units total |

Investor commission alone costs approximately **0.60% of total pair notional
per round trip** for equal-notional long/short legs. No observed gross trade
reached that fee-only hurdle; the best observed gross trade was only 0.1719%.
The estimated 0.05%-per-side slippage adds to the shortfall but is not needed
to reject the rule.

Yearly net win rate was 0% in 2023, 2024, 2025, and 2026. Coverage had 25
weekdays with no candles on either leg that were not independently classified
against an exchange calendar; the 3,776 completed trades themselves used only
synchronized bars, with no one-leg-only dates. Candle prints do not prove
executable bid/ask prices. No orders were placed.

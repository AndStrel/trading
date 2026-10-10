# TATN/TATNP intraday relative-value reversion transfer v1 — rejected

Protocol SHA-256: `f3246dc83fd565747ac50905b3ac78fc3d28b16940b8af8b863ebfe062dcfac3`.
Replay with `node dist/research-tatn-tatnp-intraday-reversion.js` after source
capture. Raw MOEX ISS pages and page hashes are in the ignored
`.trading/tatn-tatnp-intraday-reversion-v1/` folder; aggregate JSON is
`.trading/tatn-tatnp-intraday-reversion-v1.json`.

**Decision: reject this exact transfer.** It generated 3,862 completed trades
over 949 dates, with **zero net winners** after Investor commission and the
base slippage allowance. This is exploratory transfer on a previously studied
calendar range, not independent confirmation.

| Measure | Result |
|---|---:|
| Synchronized 10-minute bars, 2023-01-03–2026-09-25 | 79,114 |
| Completed trades | 3,862 |
| Net winners | 0 (0.00%) |
| Mean gross pair return | +0.0145% (about 1.45 bp) |
| Mean base net pair return | −0.6856% per trade |
| Mean stress net pair return | −0.7856% per trade |
| Best gross trade | +0.4835% |
| Base net trades after removing best five | −26.4609 return units total |

With equal-notional legs, Investor commission alone is approximately 0.60% of
total pair notional per round trip. **No gross trade exceeded that
commission-only hurdle**, even before slippage. The wider, slower relative
price movement in this pair therefore did not translate into a viable
round-trip under the actual tariff.

All yearly blocks had 0% net winners and negative mean base net. Coverage had
25 weekdays with no candles on either leg that were not independently
classified against an exchange calendar; all completed trades used
synchronized bars. Actual preferred-share spread, historical short
availability, borrow costs, and executable fills remain unverified and can
only worsen the estimate. No orders were placed.

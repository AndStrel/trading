# BR first-hour reversal (2024–2025) — result

The frozen exploratory rule failed. No orders were placed.

The protocol was frozen before this calculation; SHA-256
`f6a155b89c059a36c04db2dde431180d2824ba114d134630f091096d4202b3eb`.
Source-manifest SHA-256 values: 2024
`49fe00ecb754dbb7af599a1765cbc7b762b2a4189da68a4b70124f9304fd7494`; 2025
`0accb82bf1f5ac7808df713620cab57a4217e440d9a369f4817c863476f95969`.
Reproducible machine-readable report:
`.trading/br-first-hour-reversal-2024-2025-exploratory-v1.json`.

| Period | Completed trades | Net winners | Win rate | Mean base net/trade | Mean stress net/trade | Unresolved |
|---|---:|---:|---:|---:|---:|---:|
| 2024-03-24–09-25 | 104 | 38 | 36.5% | −0.252% | −0.352% | 24 |
| 2025-03-24–09-25 | 112 | 32 | 28.6% | −0.397% | −0.497% | 15 |
| Combined | 216 | 70 | 32.4% | −0.327% | −0.427% | 39 |

The 268 calendar specifications include 216 completed trades, 39 unresolved
attempts, 6 official no-session dates, one excluded special session, 3 cash
days, and 3 sessions with an incomplete opening signal. Among completed trades
there were 78 stop exits and 138 time exits. Combined quote-normalized base
return sum was −70.62 percentage points across trades (not a compounded
portfolio return); profit factor was 0.374, and removing the best trade leaves
−73.38 percentage points. Neither year was profitable. The admission gates
fail independently on win rate, net expectancy, profit factor, and unresolved
history.

This was a post-selection exploratory transfer chosen after the 2026 BR
continuation failure, and historical periods overlap the broader research
cycle. The poor outcome rejects this exact rule; it is not evidence that every
form of intraday Brent reversal is impossible. Do not tune this rule on these
dates or reinterpret unresolved sessions as successful fills.

At the latest local check, the weekday public TMON quote collector was still
running. Its attempt journal still had only two rejected snapshots and zero
accepted bid/ask observations, so there is no new execution-quality evidence.

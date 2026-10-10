# TMON discount to iNAV v1 — no signals, rejected

The [fixed rule](TMON_INAV_DISCOUNT_V1.md) was written before the joint
TMON/iNAV outcomes were calculated. Reproduce offline with `npm run build`
and `node dist/research-tmon-inav-discount.js`. The complete ignored report
`.trading/tmon-inav-discount-v1.json` has SHA-256
`f2d3fe157735e753ed8e30345ffe15d04822b3f13160edb0f294d183c5e27d78`.

Across 133 ordinary dates, there were **8,960** matched TMON trade-print and
published-iNAV minutes in the fixed 10:15–14:00 signal window. Just 11 of
those TMON closes were even below iNAV. The deepest observed discount was
**0.01255%**, versus the predeclared **0.15%** required discount. Consequently
all **133 dates remained in cash**: zero signals, entries, exits or completed
trades. This is not a 0% win rate; win rate and mean trade return are
undefined because no trade occurred. The most positive observed premium to
iNAV was 0.17261%; it is not evidence that a short sale is feasible or
profitable.

**Decision:** reject this long-discount rule for lack of signals. Lowering
the threshold after seeing the gap distribution would be parameter fitting
on the same sample and would erase the cost rationale. The result does not
rule out unobserved between-print quotes, other instruments, or a genuinely
new independently specified mechanism. Public iNAV is usually static
intraday, TMON candles are sparse trade prints, and neither is an
executable bid/ask or broker fill. The conditional zero-commission scenario
was favorable but irrelevant because no orders were triggered. No real
orders were placed.

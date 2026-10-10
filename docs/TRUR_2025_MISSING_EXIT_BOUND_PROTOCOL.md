# TRUR 2025 missing-exit bound — fixed before reading prices

This is a rejection-only diagnostic for the frozen [same-day TRUR rule](TRUR_INTRADAY_V1.md). Its [timestamp checkpoint](TRUR_2025_SOURCE_CHECKPOINT.md) found 247 entered days, 238 observable exit-window prints and 9 unknown exits. Canceled days are not trades.

For each entered day, use the first entry-window trade-candle open. On the 238 paired-print days, use the first exit-window open and calculate gross, base (0.02% adverse each side), stress (0.05% each side) and severe (0.10% each side) returns with zero **conditional** broker commission. Do not invent historical tick rounding. For win-rate lower and upper bounds, count each of the nine missing exits as a loss or a win respectively, without estimating its price. A strictly positive net result is a win. The 51% threshold is **126 of 247**, so at least **117 observed paired-print wins** are necessary even if every missing exit won.

If the upper bound falls below 51% in a required cost case, reject the frozen rule for that case. If it reaches 51%, label it inconclusive, not a pass, because the zero-unresolved gate, actual bid/ask execution, historical price step, net mean, tail risk and independent period remain unverified. Do not change windows or costs after viewing outcomes.

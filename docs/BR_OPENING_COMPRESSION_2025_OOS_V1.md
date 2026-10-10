# BR opening-compression breakout — untouched 2025 period

## Protocol frozen before outcome calculation

Apply the already fixed [Si opening-compression breakout v1](SI_OPENING_COMPRESSION_BREAKOUT_V1.md), unchanged, to a separate BR period from 2025-03-24 through 2025-09-25. This is a transfer test of an existing rule, not a newly optimized BR strategy. Its previous exploratory 2026 BR transfer is disclosed in [the 2026 result](BR_OPENING_COMPRESSION_TRANSFER_V1_RESULTS.md); the 2025 prices and trade outcomes were not used to choose this test. No thresholds may be adjusted on this period.

The source is public MOEX ISS one-minute OHLCV for exact BR contracts on RFUD, 10:00–17:00 MSK. The report SHA-256 is `0accb82bf1f5ac7808df713620cab57a4217e440d9a369f4817c863476f95969`. Contract mapping by calendar month is BRJ5 (March), BRK5 (April), BRM5 (May), BRN5 (June), BRQ5 (July), BRU5 (August), BRV5 (September). The official MOEX futures archive lists those exact security codes and their contract months. Every raw response page is retained in a compressed local archive with its SHA-256.

The source audit contains 134 weekdays and 54,384 minute candles. Three dates have no candles: 1 May, 9 May, and 12 June. MOEX's official 2025 holiday schedule says exchange trading did not take place on those dates, so classify them as verified no-session days. The remaining source dates have candles; record exact candle coverage and hash in the generated report. The protocol does not infer any missing price.

## Rule and simulation

At 11:00 compute the 10:00–10:59 opening high and low, and `(high-low)/open(10:00)`. Trade only if the range is no more than 0.60%. From 11:00 through 13:59, take the first close at least 0.05% above the opening high (long) or below the opening low (short). Enter at the following minute's open. At most one trade per session. Stop at 0.70% adverse; target at 1.00% favorable. Check the entry minute onward, resolve a same-minute stop and target as a stop, and fill a gap-through stop at the worse of its threshold or that minute's open. Otherwise exit at 16:55 open. Exempt the scheduled 14:00–14:04 interim clearing break from mandatory candle checks; every other missing required candle is unresolved. Do not carry a position overnight.

Use the existing tested `SI_BASE_COSTS` and `SI_STRESS_COSTS` (Investor futures commission 0.10% per side; base slippage 0.05% per side; stress slippage 0.10% per side). These OHLC replay fills are estimates; they do not prove queue execution, bid/ask, market impact, margin or tax. Do not convert quote-normalized return into ruble profit or margin return.

## Decision gate

Report all 131 exchange sessions, verified no-session dates, missing data, cash dates, signals, cancelled and unresolved entries, completed trades, direction, exit reason, gross/base/stress winners and means, profit factor, total net result and result without the best trade. Split results into March–May and June–September. The rule only passes this screen with at least 100 completed trades on at least 50 dates, no cancelled or unresolved entered trades, at least 51% base-net winners, positive base and stress means, profit factor above one, positive aggregate after removing the best trade, and positive base and stress means in both blocks. A failed gate rejects this exact transfer. A pass only warrants later untouched-period and executable-price validation; it does not authorize orders.

Source references: [MOEX contract archive](https://www.moex.com/ru/derivatives/futures-on-commodity/brx6), [MOEX 2025 holiday schedule](https://www.moex.com/n73701?nt=112), [MOEX ISS](https://www.moex.com/a2920).

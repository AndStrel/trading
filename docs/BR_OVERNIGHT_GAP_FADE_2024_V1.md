# BR overnight gap fade — 2024 one-time holdout

## Selection and scope

This is a single, fixed test of gap reversion on a separate source vintage. It was selected after the opposite overnight-gap continuation rule failed in 2025–2026. The gap magnitude, entry time, stop, target, holding period, cost model, and admission gate remain unchanged; only signal direction is reversed. Because the direction choice follows that prior screen, this is disclosed as a new hypothesis rather than an untouched multi-hypothesis research program. The 2024 prices were not used to choose any setting, and this is the one planned calculation on this vintage.

Use exact monthly BR contracts and public MOEX ISS one-minute OHLCV from 2024-01-03 through 2024-09-25, including the official working Saturday 2024-04-27. Monthly mapping: BRG4 January, BRH4 February, BRJ4 March, BRK4 April, BRM4 May, BRN4 June, BRQ4 July, BRU4 August, BRV4 September. The source report SHA-256 is `49fe00ecb754dbb7af599a1765cbc7b762b2a4189da68a4b70124f9304fd7494`. The empty weekdays (23 February, 8 March, 1 May, 9 May, 12 June) are confirmed non-trading holidays by MOEX's [2024 schedule](https://www.moex.com/n64121). Raw response pages are retained and individually hashed.

For each actual session, require the immediately previous actual session in the archive to use the same contract and have a 16:59 close. Exclude the first archive date and contract-roll dates; never compare across contract codes. On an eligible date calculate `open(10:00 today) / close(16:59 previous session) - 1`. If the gap is at least +0.25%, go short; if at most −0.25%, go long; otherwise remain in cash. Enter at 10:01 open. At most one trade per session.

Use the same fixed management as the rejected continuation screen: stop 0.70% adverse, target 1.00% favorable; check from entry through 16:54, stop first on an ambiguous candle, adverse stop gaps no better than the candle open, target no better than its level, otherwise exit at 16:55 open. Exempt only 14:00–14:04 scheduled clearing. Missing post-entry candles are unresolved.

Apply Investor futures commission 0.10% per side, base adverse slippage 0.05% per side, and stress slippage 0.10% per side. This replay does not prove actual executable fills or account-level margin return.

## One-shot screen

Report all eligible dates, no-session dates, first-source/contract-roll exclusions, missing references, cash, cancelled and unresolved paths, completed trades, direction, exit types, gross/base/stress winning rates and means, sums, profit factor, and aggregate without the best trade. Pass only with at least 100 completed trades on 50 dates, no cancelled or unresolved entries, at least 51% base-net winners, positive base and stress means, profit factor above one, and positive base sum after removing the best trade. Failure rejects this reversal hypothesis for this configuration. Do not tune it on the 2024 sample. A pass requires new prospective untouched data and executable-price validation before consideration; it does not authorize orders.

References: [MOEX ISS](https://www.moex.com/a2920), [MOEX 2024 trading calendar](https://www.moex.com/n64121), [MOEX BR futures archive](https://www.moex.com/ru/derivatives/futures-on-commodity/brx6), [T-Invest futures commission](https://www.tbank.ru/invest/help/brokerage/account/forts/trade-futures/).

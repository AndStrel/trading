# BR overnight gap continuation v1 — fixed rule

## Hypothesis and protocol frozen before result calculation

When the same BR futures contract opens the MOEX day session materially above or below its previous trading-session close, the overnight repricing may continue during the first full intraday session. Test the gap direction as the signal and trade BR only. This is a new development hypothesis; no result for this rule has been inspected. Existing BR results concern other entry signals.

Use exact monthly BR contracts and public MOEX ISS one-minute OHLCV, 10:00–17:00 MSK, for 2025-03-24–2025-09-25 and 2026-03-23–2026-09-25. For each date, reference the immediately previous actual trading session in the source calendar. A candidate date is eligible only when that previous session used the same exact contract and has a 16:59 close; exclude the first date in each archive, contract-roll dates, verified no-session dates, and the two 2026 special sessions (2026-05-01 and 2026-06-12). Do not bridge a contract roll or infer an unavailable close.

At 10:00 calculate `open(10:00 today) / close(16:59 previous session) - 1` for the same contract. If the gap is at least +0.25%, go long; if at most −0.25%, go short; otherwise stay in cash. The opening candle is known when it closes; enter at 10:01 open. At most one trade per session. A missing 10:00 opening is a missing signal reference; a missing 10:01 entry is cancelled.

Stop is 0.70% adverse and target is 1.00% favorable from entry. Check one-minute OHLC from entry through 16:54; if both barriers touch inside one candle, stop first. A gap-through stop fills at the worse of its threshold and that candle's open; target fills at its level. If neither triggers, exit at 16:55 open. Exempt only the scheduled 14:00–14:04 clearing break. Every other missing required holding minute or missing 16:55 open is unresolved.

Use the tested futures cost model: Investor commission 0.10% per side, base adverse slippage 0.05% per side, and stress slippage 0.10% per side. The broker's tariff guide states Investor futures commission is 0.1% of futures value per transaction; this is charged on the contract's ruble value, not the guarantee deposit. The replay still does not prove real bid/ask fills, queue, impact, variation-margin account return, or tax.

## Source lock and admission screen

Source-report SHA-256 before outcome calculation: 2025 `0accb82bf1f5ac7808df713620cab57a4217e440d9a369f4817c863476f95969`; 2026 `d8721ce74334619fc1c7f6f960a85d6e77e7ddcb050958163a9b9d8081caf57a`. Raw response pages are stored locally with hashes.

Report eligible and excluded dates with reason, missing reference/entry/holding paths, cash sessions, trades, side, stop/target/time outcomes, gross/base/stress win rate and means, sums, profit factor, and result without the best trade, both combined and by year. Pass only if there are at least 100 completed trades on at least 50 dates, no cancelled or unresolved entries, at least 51% base-net profitable trades, positive base and stress mean overall and in each year, profit factor above one, and positive base sum after removing the best trade. Failure rejects this fixed rule; do not tune thresholds on this history. Passing only permits a prospective holdout and executable-fill audit; it does not authorize orders.

References: [MOEX ISS](https://www.moex.com/a2920), [MOEX BR futures](https://www.moex.com/ru/derivatives/futures-on-commodity/brx6), [T-Invest futures commission](https://www.tbank.ru/invest/help/brokerage/account/forts/trade-futures/).

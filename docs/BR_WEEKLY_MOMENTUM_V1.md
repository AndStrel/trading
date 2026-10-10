# BR weekly momentum continuation v1 — protocol before outcome calculation

Fixed before inspecting candidate week returns. Read-only research; no orders.

## Mechanism

Hypothesis: a material prior-ISO-week move in the liquid Brent futures contract (exact RFUD month code) continues into the next ISO week often enough to pay Investor futures costs. Null: no positive net advantage after costs. This is not a retune of rejected first-hour, overnight-gap, shock-fade, or opening-compression BR rules.

## Source and period

Use locked public MOEX ISS RFUD exact-contract one-minute archives:

- Discovery A: `.trading/br-2024-continuous-source` + report SHA-256 `49fe00ecb754dbb7af599a1765cbc7b762b2a4189da68a4b70124f9304fd7494`
- Discovery B: `.trading/br-2025-continuous-source` + report SHA-256 `0accb82bf1f5ac7808df713620cab57a4217e440d9a369f4817c863476f95969`

Do **not** read or score 2026 BR paths for this development gate. Contract calendars stay those of the source modules (`br2024DaySpecs`, `br2025DaySpecs`). Verified no-session dates remain cash/no-trade, never imputed.

## Signal and execution

ISO weeks use Monday–Friday in Europe/Moscow calendar dates as listed in the archives.

For signal week W (same exact contract on the week’s first and last traded archive days):

- Entry reference: Monday (or first weekday present that week) **11:01** open.
- Exit reference: Friday (or last weekday present that week) **16:55** open.
- Prior move = `exitRef / entryRef - 1`.
- Trade only if absolute prior move exceeds the exact futures base break-even ratio implied by 0.10% commission and 0.05% slippage **per side** (same convention as `siTradeReturn` / `SI_BASE_COSTS`). Otherwise cash.
- Direction: long if prior move positive, short if negative.

For trade week W+1 (must be the immediately following ISO week, same exact contract on its first and last traded days):

- Enter at first weekday **11:01** open; exit at last weekday **16:55** open.
- Missing mandatory entry or exit minute → cancelled / unresolved; never count as a win.
- Weeks that change contract between first and last day, or lack both anchors, are skipped (not wins).
- No overlap: at most one position; no overnight beyond the trade week’s exit; no stops in v1 (event study). A pass still needs a separate risk-controlled design before any live use.

Costs: Investor futures 0.10% commission per side; base slippage 0.05% per side; stress 0.10% per side. Quote-normalized `siTradeReturn` on full notional, not guarantee deposit.

## Admission gates (discovery only)

Require all of:

- At least 50 completed trades across the combined 2024+2025 discovery set, on at least 50 distinct trade weeks
- Zero unresolved trade attempts
- Base-net win rate ≥ 51%, positive mean base net, positive mean stress net, profit factor > 1
- Sum of base net after removing the single best week > 0
- Positive mean base net in the 2024 block and in the 2025 block separately

Failing any gate rejects this exact rule. Do not retune thresholds, hours, or week definitions on these samples. A pass permits only a sealed 2026 test later — not trading.

References: [MOEX ISS](https://www.moex.com/a2920), [futures costs](https://www.tbank.ru/invest/help/brokerage/account/forts/trade-futures/).

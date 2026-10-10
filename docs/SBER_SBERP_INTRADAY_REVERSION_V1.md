# SBER/SBERP intraday relative-value reversion v1 — locked before MOEX data pull

Research only; no orders. Inspired by the HSE 2026 thesis summary on Moscow
Exchange dual-class shares, which reports sub-hour relative-price mean
reversion for its most liquid pair. That is a mechanism hypothesis, not
evidence that this rule is profitable after costs.

## Source and sample

Use public MOEX ISS TQBR 10-minute OHLC candles for SBER and SBERP from
2023-01-03 through 2026-09-25. Preserve raw response pages, retrieval times,
and SHA-256 hashes in `.trading/sber-sberp-intraday-reversion-v1/`. Do not
substitute a neighboring bar or carry a stale close across a missing pair bar.
Only use a bar when both instruments have the same `begin` timestamp. Exclude
non-trading sessions only when verified against an official exchange calendar;
otherwise report them as unclassified data gaps. This period is discovery data,
not an untouched validation set.

## Frozen signal and execution

For each synchronized 10-minute close, define `spread = ln(SBERP close / SBER
close)`. The reference mean and population standard deviation use the six
immediately preceding synchronized closes (60 minutes); the current close is
not in its own reference window. Do not signal when the standard deviation is
zero.

Between 11:00 and 16:30 MSK, if absolute z-score is at least 2.0, enter at the
next synchronized 10-minute bar open. If z is positive, short SBERP and long
SBER; if negative, long SBERP and short SBER. Size both legs to equal RUB
notional at entry, with no leverage and no overnight holding. Keep at most one
pair position open; no same-bar re-entry.

After entry, exit at the next synchronized bar open after the first close with
absolute z-score at most 0.5 (reversion), absolute z-score at least 4.0
(adverse expansion), or six completed holding bars (60 minutes), whichever
comes first. A missing required synchronized entry or exit open is a cancelled
entry or unresolved attempt, never a neighboring-price fill. Stop and target
prices are not inferred from separate-leg candle extrema because their order
within a bar is unknown.

## Costs and gates

Use the authenticated account's confirmed Investor tariff: 0.30% commission
per side per equity leg. Base modeled adverse slippage is 0.05% per side per
leg; stress is 0.10% per side per leg. With equal-notional legs, this implies
approximately 0.70% base and 0.80% stress cost on total pair gross notional per
round trip, before historical spread, market impact, borrow availability or
borrow costs. This is deliberately a screening model, not a fill claim.

Report all attempts and gaps, completed trades, net-positive rate, mean and
aggregate net return, profit factor, annual blocks, base and stress results,
and result excluding the five best observations. A candidate may advance only
with at least 100 completed trades over 50 dates, at least 51% net winners,
positive mean and aggregate net return in base and stress, positive calendar
year blocks, no unresolved attempts, and positive aggregate after removing the
five best trades. Passing this development screen would still require a truly
untouched forward sample, verified short availability/borrow costs, and
contemporaneous executable bid/ask evidence before any live use.

## Provenance

- Research inspiration: [HSE thesis summary](https://www.hse.ru/en/edu/vkr/1167442423?vision=enabled).
- Data source: [MOEX ISS](https://www.moex.com/a2920).
- Investor equity tariff reference: [T-Invest tariffs](https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/).

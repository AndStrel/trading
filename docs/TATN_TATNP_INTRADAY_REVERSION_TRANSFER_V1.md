# TATN/TATNP intraday relative-value reversion transfer v1 — locked before data pull

Read-only exploratory transfer of the frozen SBER/SBERP relative-value rule in
`SBER_SBERP_INTRADAY_REVERSION_V1.md` to TATN/TATNP. The 2026 HSE thesis
summary reports slower spread convergence and wider preferred-share spreads
for less-liquid pairs, so this transfer tests whether greater convergence
amplitude survives the same costs. It is not independent confirmation and does
not authorize trading.

Use public MOEX ISS TQBR 10-minute candles for TATN and TATNP from 2023-01-03
through 2026-09-25. Preserve raw response pages, retrieval times, and SHA-256
hashes under `.trading/tatn-tatnp-intraday-reversion-v1/`. Use only shared
10-minute bars; never carry a stale price or substitute a neighboring bar.
Keep only Moscow weekdays and report weekdays with no candles as unclassified
until joined to an official exchange calendar.

At each synchronized close, set `spread = ln(TATNP close / TATN close)` and
calculate z-score relative to the immediately preceding six synchronized
10-minute closes (population standard deviation, current close excluded).
Between 11:00 and 16:30 MSK, enter on the next synchronized bar open when
`abs(z) >= 2`: if z is positive, long TATN and short TATNP; if negative, long
TATNP and short TATN. Equalize RUB notional, hold at most one pair, and keep
the position intraday. Exit on the next synchronized open after the first
close with `abs(z) <= 0.5`, `abs(z) >= 4`, or six completed holding bars,
whichever comes first. Missing entry/exit bars are cancelled/unresolved, never
filled from adjacent data.

Apply the confirmed Investor equity commission of 0.30% per side per leg,
base adverse slippage of 0.05% per side per leg, and stress slippage of 0.10%
per side per leg. These imply approximately 0.70%/0.80% of total pair gross
notional per round trip before actual spread, impact, short availability, and
borrow costs. The 0.30% per-side pair commission alone is approximately
0.60% of total pair notional. Because TATNP is less liquid, this slippage model
may be optimistic.

Report all attempts and data gaps, completed trade count/date count, base and
stress net winners, means, aggregates, profit factor, annual results, exits,
and result without the five best observations. Development admission requires
at least 100 completed trades on 50 dates, at least 51% base-net winners,
positive base and stress mean/aggregate, positive calendar-year blocks, zero
cancelled or unresolved attempts, and positive result without the five best
trades. Any passing screen still needs an untouched forward period,
contemporaneous bid/ask execution evidence, and short-borrow verification.

Inspiration: [HSE thesis summary](https://www.hse.ru/en/edu/vkr/1167442423?vision=enabled).

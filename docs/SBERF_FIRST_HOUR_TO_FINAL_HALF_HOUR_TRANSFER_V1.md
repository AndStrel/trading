# SBERF first-hour direction to final-half-hour return — v1 transfer

Status: frozen before downloading or calculating the eligible joint SBERF intraday outcomes. This is a single-instrument transfer of the unchanged rule previously tested on IMOEXF; it is not independent confirmation of the general rule family and does not authorize trading.

## Question

On ordinary Monday–Friday MOEX trading dates, does the sign of SBERF's first 60 minutes in the main session predict the sign and size of its final 30 minutes in that same main session? A published study found first-session momentum in Chinese stock-index futures; the direct IMOEXF transfer on MOEX failed. This v1 tests the unchanged directional rule on one different, highly liquid single-stock futures instrument, SBERF. No thresholds or windows are changed in response to IMOEXF outcomes.

## Instrument and dates

- Instrument: MOEX perpetual Sberbank share futures `SBERF`, board `RFUD`.
- Source: anonymous/public MOEX ISS one-minute candles (`interval=1`) for only the two fixed intraday windows below, plus daily candles (`interval=24`) for the official date denominator.
- Eligible dates: 2024-10-01 (first trading date of SBERF) through 2026-09-24 inclusive. Weekends are excluded by design; no statement about weekend trading follows.
- No SBERF paired first-hour/final-half-hour outcomes have been inspected in this task before this protocol.
- Candidate dates are weekdays in the instrument's official daily-candle history. If an official trading date is missing either needed signal data or a required execution window for a nonzero signal, it is unresolved; no forward-fill or substitute price source is allowed.

## Session clock (Moscow time)

Use the MOEX main-session schedule in force on the date:

- Through 2026-03-22: main session 10:00–18:45. Signal minutes 10:00–10:59; execution minutes 18:15–18:44.
- 2026-03-23 through 2026-09-13: main session 10:00–19:00. Signal minutes 10:00–10:59; execution minutes 18:30–18:59.
- From 2026-09-14: main session 09:00–19:00. Signal minutes 09:00–09:59; execution minutes 18:30–18:59.

Require exactly 60 ordered one-minute bars in the signal window and 30 ordered bars in the execution window when a nonzero signal requires a trade. Every required bar must be unique, have positive volume, valid OHLC, and lie on SBERF's 0.01-RUB price grid. Missing prices are unresolved; do not interpolate.

## Frozen rule

1. At the end of the first main-session hour, compute `signal = close(last signal minute) / open(first signal minute) - 1`.
2. If signal is strictly positive, plan one long contract; if strictly negative, plan one short contract; if exactly zero, remain in cash.
3. Enter at the open of the first minute of the final-30-minute window and exit at the close of its last minute. No stop, target, scaling, re-entry, discretionary filter, or overnight holding.
4. A nonzero signal without complete entry/exit windows is unresolved and fails admission; it is not omitted from the completed-trade sample. Maximum one trade per official weekday session.

## Contract conversion and costs

SBERF is quoted in RUB per Sberbank share; one contract is 100 shares, tick 0.01 RUB, and tick value RUB 1 per contract. All P&L is calculated in code.

- Broker commission: 0.10% of contract notional per side (published T-Invest "Investor" futures rate, used conservatively while the user's actual tariff is unverified).
- MOEX transaction-registration fee: RUB 8.38 per side per contract, the current fee published on the SBERF instrument card on 2026-09-25; apply to the entire history as a deliberately conservative current-cost proxy, not as a claim about historical fee schedules.
- Base adverse execution allowance: one 0.01-RUB tick per side. Stress: two ticks per side. Apply in the unfavorable direction on entry and exit; charge broker and exchange fees on both sides.
- Report net RUB per one contract and net return over entry notional. A strict net winner has net P&L > 0; zero is not a win.
- Do not include the contract-exercise clearing fee: the rule exits intraday and submits no quarterly exercise instruction. Do not include funding or dividend adjustment: the position is flat before the 23:50–00:30 clearing in which they are settled.
- Personal taxes, margin use, actual bid/ask, queue position, and impact remain outside this OHLC screening model. Do not claim executable fills.

## Admission gate

Report all official weekdays, complete signal/entry/exit coverage, zero-signal dates, unresolved dates, and completed trades. Calculate combined and calendar blocks separately: 2024 partial (from October 1), 2025, and 2026 through September 24.

- At least 100 completed trades across at least 50 distinct dates.
- At least 51% strictly positive net trades at base cost, with positive mean and median net result.
- Positive aggregate net P&L in every calendar block above.
- Positive aggregate P&L at stress cost.
- Positive aggregate P&L after removing the five best base-cost trades.
- Zero unresolved/cancelled signal, entry, or exit dates among eligible official weekday dates with a nonzero signal.

Any failure rejects this exact SBERF transfer. Do not invert its direction, tune the hours, or pick a favorable year/subgroup on this archive. Because this follows the failed IMOEXF test, report it as a declared cross-instrument transfer and not an independent confirmation of the broader mechanism. A pass only earns prospective shadow testing with contemporaneous SBERF bid/ask; it does not authorize orders.

## Reproduction and provenance

Raw ISS bodies, request URLs, retrieval timestamps, per-page SHA-256, and date/window coverage belong in ignored `.trading/sberf-first-hour-final-half-hour/`. Preserve every raw page and refuse overwrite. Save a source-only checkpoint before any return calculation. The outcome runner must verify both frozen-protocol and source-manifest hashes.

## Sources checked 2026-09-29

- [MOEX SBERF launch and contract parameters](https://www.moex.com/n73437): trading began 2024-10-01; lot 100, tick RUB 0.01, tick value RUB 1.
- [MOEX SBERF instrument card](https://www.moex.com/ru/derivatives/perpetual-futures/SBERF): current transaction-registration fee and current contract data.
- [MOEX main session shifted to 09:00 on 2026-09-14](https://www.moex.com/n103379); [unified session effective 2026-03-23](https://www.moex.com/n95054).
- [MOEX funding explanation](https://www.moex.com/vechnye-fyuchersy-na-moex): funding/dividend adjustments settle in the evening clearing; closed positions do not incur funding.
- [T-Invest futures commissions](https://www.tbank.ru/invest/help/brokerage/account/forts/trade-futures/).
- Li et al., ["Does intraday time-series momentum exist in Chinese stock index futures market?"](https://doi.org/10.1016/j.frl.2019.09.007), *Finance Research Letters* 35 (2020), 101292. Motivation only; not an SBERF finding.

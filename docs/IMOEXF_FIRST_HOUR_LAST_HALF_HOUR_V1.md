# IMOEXF first-hour direction to final-half-hour return — v1

Status: frozen before downloading or calculating the eligible joint intraday outcomes. Exploratory transfer test only; no trading authority.

## Question

On ordinary Monday–Friday MOEX trading dates, does the sign of IMOEXF's first 60 minutes in the main session predict the sign and size of its final 30 minutes in that same main session? This is motivated by published intraday-momentum research in Chinese stock-index futures, but that evidence is not evidence about IMOEXF.

## Instrument and dates

- Instrument: MOEX perpetual index futures `IMOEXF`, board `RFUD`.
- Source: anonymous/public MOEX ISS one-minute candles; `interval=1`. Only the two preregistered windows below will be retained for the test. Separately obtain daily candles (`interval=24`) for the date denominator and source completeness.
- Eligible source dates: 2024-07-01 through 2026-09-24 inclusive. The IMOEXF program began 2024-07-01. Weekends are excluded by design; this v1 makes no claim about weekend sessions.
- 2026-09-25 is excluded: its raw intraday response was used to test the public endpoint and its paging before this protocol was frozen. No other eligible date's paired signal/exit outcome has been inspected in this turn.
- Define candidate dates from dates present in the official IMOEXF daily-candle response, then retain Monday–Friday dates. A missing/partial intraday window on an official trading date is a data/exit failure, not a holiday and not a completed trade. Do not forward-fill.

## Session clock (Moscow time)

Use MOEX's published main-session schedule in force on the date. For the eligible period:

- Through 2026-03-22: main session 10:00–18:45. Signal window is 10:00–10:59 inclusive; execution window is 18:15–18:44 inclusive.
- 2026-03-23 through 2026-09-13: main session 10:00–19:00. Signal window is 10:00–10:59 inclusive; execution window is 18:30–18:59 inclusive.
- From 2026-09-14: main session 09:00–19:00. Signal window is 09:00–09:59 inclusive; execution window is 18:30–18:59 inclusive.

Use the exact 60 one-minute candles in the signal window and 30 one-minute candles in the execution window. All must be present, unique, correctly ordered, have positive volume, valid OHLC, and prices on the 0.5-point tick grid. Otherwise classify the date as unresolved; no price interpolation or replacement source is allowed in v1.

## Frozen rule

1. At the end of the first main-session hour, compute `signal = close(last signal minute) / open(first signal minute) - 1`.
2. If signal is strictly positive, plan one long contract; if strictly negative, plan one short contract; if exactly zero, remain in cash.
3. Enter at the open of the first minute of the final-30-minute window. Exit at the close of its last minute. No stop, target, scaling, re-entry, discretionary filter, or overnight holding.
4. A non-zero signal with incomplete entry/exit windows is unresolved and fails the admission gate; it is not omitted from the completed-trade sample. One trade maximum per eligible session.

## Contract conversion and costs

IMOEXF is quoted in index points, lot size 10, minimum tick 0.5 points, or RUB 5 per tick per contract (RUB 10 per point). Compute money from prices in code, not by manual rounding.

- Broker commission: 0.10% of contract notional on each side (published T-Invest “Investor” futures rate; conservative while the user's actual tariff is unverified).
- MOEX transaction-registration fee: RUB 1.50 per side per contract, using the currently published IMOEXF page value for the entire historical screen. This is an explicit current-cost proxy, not a claim about historical fee schedules.
- Base adverse execution allowance: one 0.5-point tick per side, rounded to the exchange tick grid. Stress: two ticks per side. Apply adversely by direction to entry and exit. Broker and exchange fees are charged on both sides.
- Report net RUB/one contract and net return over entry notional. A strict net winner has net P&L > 0; zero is not a win.
- Do not include contract-exercise clearing fees: the rule closes intraday and does not submit quarterly exercise instructions. Do not include funding or dividend adjustment: the official MOEX mechanism settles them in the 23:50–00:30 clearing, and this rule is flat beforehand. Explicitly verify no position crosses that clearing.
- Taxes, margin use, actual bid/ask, queue position, market impact, and personal account-specific charges are not in this OHLC screen; disclose them as limitations. Do not claim executable fills.

## Admission gate

Report all calendar attempts, official trading-date denominator, complete signal/entry/exit coverage, zero-signal dates, unresolved dates, and completed trades. Compute the following for the combined sample and separately by 2024 (partial from July 1), 2025, and 2026 through September 24, without retuning:

- At least 100 completed trades across at least 50 distinct dates.
- At least 51% strictly positive net trades at base costs; positive mean and median net result.
- Positive aggregate net P&L in every listed calendar-year block.
- Positive aggregate P&L at stress costs.
- Positive aggregate P&L after removing the five best base-cost trades.
- Zero unresolved or cancelled signal/entry/exit dates among eligible official weekday trading dates with a non-zero signal.

Any failure rejects this precise rule. No subgroup/hour/threshold/tariff optimization on this dataset may be presented as confirmation. Any new variant requires a new frozen protocol and independent untouched dates. A pass only advances to prospective shadow observation with contemporaneous route-specific bid/ask; it does not authorize orders.

## Reproduction and provenance

Keep raw ISS response bodies, per-page SHA-256, query parameters, retrieval timestamp, source calendar and parsed-window coverage under ignored `.trading/imoexf-first-hour-last-half-hour/`. Refuse to overwrite existing raw pages. The strategy runner must verify the protocol hash and source-manifest hash before calculating returns. Publish the source-only checkpoint before the outcome report.

## Sources checked 2026-09-29

- [MOEX IMOEXF contract card](https://www.moex.com/ru/derivatives/perpetual-futures/IMOEXF): lot, tick size/value, registration fee, contract data.
- [MOEX main session changed to 09:00 on 2026-09-14](https://www.moex.com/n103379); [MOEX schedule effective 2026-07-14](https://www.moex.com/n101980); [unified-session change effective 2026-03-23](https://www.moex.com/n95054).
- [MOEX funding explanation](https://www.moex.com/vechnye-fyuchersy-na-moex) and [IMOEXF funding-period update](https://www.moex.com/n104130).
- [T-Invest futures commission schedule](https://www.tbank.ru/invest/help/brokerage/account/forts/trade-futures/).
- Li et al., [“Does intraday time-series momentum exist in Chinese stock index futures market?”](https://doi.org/10.1016/j.frl.2019.09.007), *Finance Research Letters* 35 (2020), 101292. Rationale only; not an IMOEXF result.

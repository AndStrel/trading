# CBR SBER first-reaction continuation v1 — locked protocol

Research screen only. This protocol is fixed before calculating event-window returns. It does not authorize orders or establish that historical candle opens were executable.

## Hypothesis

Following an official Bank of Russia key-rate release or its scheduled press conference, the first five minutes of SBER price discovery may reveal a direction that persists for the next 30 minutes. Test the exact same directional rule separately at each scheduled information event. This is a price-action hypothesis, not a claim that the policy-rate direction itself is predictable.

## Event calendar

Use only dates on the Bank of Russia's official key-rate decision calendar that explicitly schedule the decision press release at 13:30 MSK and the Governor's press conference at 15:00 MSK. Freeze the calendar at 2026-09-28. The eligible decision dates transcribed from the official calendar are:

| Year | Eligible decision dates |
|---|---|
| 2015 | 01-30, 03-13, 04-30, 06-15, 07-31, 09-11, 10-30, 12-11 |
| 2016 | 01-29, 03-18, 04-29, 06-10, 07-29, 09-16, 10-28, 12-16 |
| 2017 | 02-03, 03-24, 04-28, 06-16, 07-28, 09-15, 10-27, 12-15 |
| 2018 | 02-09, 03-23, 04-27, 06-15, 07-27, 09-14, 10-26, 12-14 |
| 2019 | 02-08, 03-22, 04-26, 06-14, 07-26, 09-06, 10-25, 12-13 |
| 2020 | 02-07, 03-20, 04-24, 06-19, 07-24, 09-18, 10-23, 12-18 |
| 2021 | 02-12, 03-19, 04-23, 06-11, 07-23, 09-10, 10-22, 12-17 |
| 2022 | 02-11, 03-18, 04-29, 06-10, 07-22, 09-16, 10-28, 12-16 |
| 2023 | 02-10, 03-17, 04-28, 06-09, 07-21, 09-15, 10-27, 12-15 |
| 2024 | 02-16, 03-22, 04-26, 06-07, 07-26, 09-13, 10-25, 12-20 |
| 2025 | 02-14, 03-21, 04-25, 06-06, 07-25, 09-12, 10-24, 12-19 |
| 2026 | 02-13, 03-20, 04-24, 06-19, 07-24, 09-11 |

There are 94 eligible decision dates. Each has two non-overlapping event windows; the two outcomes on a date are clustered and must not be treated as independent dates. Unscheduled decisions (including 2022-02-28, 2022-04-08, 2022-05-26, and 2023-08-15), dates without both stated times, and future dates after the freeze date are excluded and counted separately. Source: https://www.cbr.ru/dkp/cal_mp/.

## Fixed signal, entry, and exit

Use MOEX ISS one-minute candles for SBER on TQBR, in Moscow exchange time. Candle timestamps denote the beginning of each minute.

- Release window: signal on the five complete candles beginning 13:30 through 13:34. Go long if the 13:34 close is above the 13:30 open; go short if it is below; equal means no trade. Enter at the 13:35 candle open and exit at the 14:05 candle open.
- Press-conference window: signal on the five complete candles beginning 15:00 through 15:04. Go long if the 15:04 close is above the 15:00 open; go short if it is below; equal means no trade. Enter at the 15:05 candle open and exit at the 15:35 candle open.
- Each window is a separate, non-overlapping 30-minute position. No stop, target, threshold, event subset, or holding period may be selected after inspecting outcomes. A missing signal, entry, or exit candle makes that event-window unresolved; never substitute a neighboring candle. Report no-trade flats separately.

## Costs and return accounting

Model the T-Invest Investor equity commission at 0.30% per side, consistent with the current official tariff page. Base adverse execution is 0.05% per side; stress adverse execution is 0.10% per side. These imply approximate round-trip hurdles of 0.70% base and 0.80% stress before taxes, market impact, and any borrow cost. For direction `d` (+1 long, -1 short), calculate gross simple return as `d * (exitOpen / entryOpen - 1)`. Net return is the realized side-specific fill difference after applying adverse slippage to both fills and commission `c` to their summed absolute turnover: `(sellFill - buyFill - c * (sellFill + buyFill)) / entryOpen`, where long sells at `exit * (1-s)` and buys at `entry * (1+s)`, and short sells at `entry * (1-s)` and buys at `exit * (1+s)`. Do not claim that this cost model proves actual fills. Short availability on every historical date is unverified and must be identified as a live-execution limitation.

## Data quality and analysis

Retain raw source SHA-256 and per-year import counts. No archive with invalid rows is silently promoted to clean data. For 2015 and 2017, which each reported one invalid source row, any required event-window candle absent from the validated store makes that window unresolved; never impute it or replace it. Verify all event timestamps against source coverage before computing returns. Deduplicate dates, apply only the official event calendar, and report every calendar year and the predeclared blocks 2015–2019, 2020–2021, 2022, and 2023–2026. Cluster inference by decision date because the two windows on a date are related.

## Admission gate

This screen can only advance if it has at least 100 fully resolved trades over at least 50 distinct decision dates; at least 51% base-net-positive trades; positive base mean and aggregate, positive stress mean, and profit factor above one overall and in every traded calendar year; positive base aggregate in each predeclared multi-year block; positive base sum after removing the five best trades; at least 90% event-window candle coverage in each year; and zero unresolved entered positions. Also show date-clustered results; the raw trade count alone does not establish independent evidence. If any gate fails, reject this fixed rule. If it passes, it remains research-only until an independent period, historical short availability, current executable bid/ask, and realized fill/cost evidence are verified.

## Provenance and reproduction

At protocol freeze, public MOEX ISS SBER minute history was downloaded for 2015–2026 into a separate temporary research database. Per-year raw-row counts, accepted-row counts, and source SHA-256 values are in the session evidence; 2015 and 2017 each contain one invalid row, while the other imported years reported zero invalid and duplicate rows. The complete event calendar and exact required-candle coverage must be frozen and hashed before outcome calculation. No broker API, account data, token, or order endpoint is used.

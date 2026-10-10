# TMONA iNAV source checkpoint — source data before strategy returns

On 2026-09-26, before evaluating any TMON/iNAV trading outcome, inspect the
public MOEX ISS `TMONA` indicator on the `INAV` board of the index market.
Use the same 2026-03-23 through 2026-09-25 weekdays as the existing Si/BR
research, including the two preidentified special-session dates in the
source inventory. Capture every minute-candle page for each date, preserving
raw response bodies and SHA-256 hashes in an ignored local directory. Do not
replace existing snapshots. Validate strict timestamps, finite OHLC prices,
page continuity and same-date rows before producing a manifest.

Report per-date 10:00–17:00 coverage, number of distinct published iNAV close
values, and whether a change occurs after 10:00. This is **source inspection**,
not a test of a trading signal. A daily iNAV close cannot be used at 10:00
unless its value was already published then; no forward fill across dates.
Neither iNAV nor minute trade candles are executable bid/ask quotes. No
broker token, paid feed or order API is used.

Sources: [MOEX TMON iNAV](https://www.moex.com/a8503),
[MOEX ISS](https://www.moex.com/a2920).

# Failed downside-break reclaim v1 — frozen research protocol

Status: protocol frozen before calculating this signal on the SBER 2026 archive. Exploratory only: the same instrument and year were previously viewed for a different ORB+RVOL hypothesis.

## Scope and dates

- Instrument: SBER (MOEX:TQBR:SBER), long-only, one signal maximum per session.
- Sample: imported 2026 minute candles through 2026-09-26. Use only complete ordinary weekdays from `moex-equities-2026-regular-weekdays-v1`; exclude weekends, closed holidays, and special holiday sessions. Use its dated main-session hours.
- Require every minute from opening-range start through the time exit. Missing minutes make the date/event unresolved and block a strategy claim; do not forward-fill.
- Archive SHA-256 at protocol freeze: `071a696ec0319ab49b4d826b4c1784db161e9610ccdee922f756cc3c18ffe194`.

## Signal and execution

1. Opening range is the first 30 complete one-minute bars of the dated main session. Let `L` be its minimum low.
2. From the first minute after the range through `T0 + 120 minutes` (exclusive), identify only the first bar whose close is strictly below `L`. A wick below `L` without a close below is not a breakdown.
3. A failed breakdown occurs only if one of the next five consecutive one-minute bars closes at or above `L`. The first such bar is the reclaim signal. If no such bar exists, no trade that session; do not inspect a later breakdown.
4. Enter long at the open of the next one-minute bar. If that open is below `L`, reject the event; no delayed/repeated entry.
5. Stop reference is the minimum low from the breakdown bar through the reclaim bar, minus one captured price step. Initial risk is entry open minus stop. Target is 2R above entry, rounded upward to the captured price step.
6. Require estimated round-trip commission + slippage to be no more than one third of initial risk as a fraction of entry price. Report both public Investor commission (0.30% per side) and lower Trader-like commission (0.05% per side), each with 0.05% per-side slippage. The Investor scenario is primary; the lower-fee scenario is sensitivity only and excludes any monthly service charge.
7. Check exits starting with the minute after entry. Stop is checked before target if one OHLC minute touches both; a gap through the stop exits at that bar's open. A target touch exits at target. Otherwise exit at the open exactly 120 minutes after entry. No overnight position.
8. Apply adverse slippage on entry and exit and commission to each side. Net return is calculated in code with the same multiplicative convention for every event.

## Acceptance

At least 100 completed eligible trades across at least 50 dates; at least 51% net-positive at the primary Investor costs; positive mean net return; no unresolved events; and robustness to the lower-fee comparison, removing the best observation, and splitting the sample into calendar periods. This partial-year single-ticker screen cannot independently validate production readiness. No parameter search or post-result threshold changes are permitted.

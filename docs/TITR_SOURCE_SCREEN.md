# TITR intraday source screen — coverage only

On 2026-09-26, screened the T-Capital Russian Technology fund (TITR) as a possible single-instrument intraday candidate. No price, return, signal, or trading outcome was calculated, and no order was placed. The broker tariff applicable to the user's account is not established.

MOEX ISS security metadata reports TQTF history from 2024-05-20 through 2026-06-19 and TQBR history from 2026-06-22. Read-only one-minute candle requests for eight dates selected across 2025–2026 counted only trade-candle timestamps within 10:00–17:00 Moscow time (421 possible calendar minutes per ordinary session):

| Date | Board | Minutes with a trade print | First / last regular-session print |
| --- | --- | ---: | --- |
| 2025-01-15 | TQTF | 399 | 10:00 / 17:00 |
| 2025-03-17 | TQTF | 396 | 10:00 / 16:59 |
| 2025-06-16 | TQTF | 77 | 10:00 / 17:00 |
| 2025-09-15 | TQTF | 73 | 10:00 / 16:57 |
| 2025-12-15 | TQTF | 44 | 10:00 / 16:52 |
| 2026-03-16 | TQTF | 77 | 10:00 / 16:50 |
| 2026-06-15 | TQTF | 42 | 10:00 / 16:57 |
| 2026-09-15 | TQBR | 41 | 10:07 / 16:52 |

Two additional end-of-period checks: 2025-09-25 had 68 candles over the full MOEX response (including any outside 10:00–17:00), and 2026-09-25 had 43. These are selected dates, not a complete historical coverage estimate. Missing trade prints do not prove the order book was empty; they do mean a candle-only backtest cannot establish reliable same-day entry and exit on those dates. The apparent coverage deterioration after early 2025 needs full-series confirmation before any statistical claim. For now TITR is lower priority than collecting actual quotes for TMON; no TITR strategy or profitability claim is admitted.

Sources: [MOEX ISS reference](https://iss.moex.com/iss/reference/), [MOEX TITR board history](https://iss.moex.com/iss/securities/TITR.json?iss.meta=off&iss.only=boards&boards.columns=boardid,is_primary,history_from,history_till).

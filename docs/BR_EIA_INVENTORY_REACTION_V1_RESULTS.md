# BR EIA inventory-release reaction v1 — rejected

**Reject this exact rule.** The frozen [protocol](BR_EIA_INVENTORY_REACTION_V1.md)
was fixed before event-window prices were calculated. This was a local
historical screen; no broker data, token, or order endpoint was used and no
orders were sent.

## Provenance

- Protocol SHA-256: `81a703c5c1ebb78dc0960de8863c82ef92a50b5fd7e9655982823edb1b8940db`
- Source report: `.trading/br-eia-event-source.json`, SHA-256
  `8f385940d4ce0e35a997dc5fcdd9e063a5ed244b749c5509b2629cb0e743aebc`
- Frozen event-window inventory SHA-256:
  `56202145d125807b9687e4a54afd847f7ea574c01927597954ad8a3f1c1832ed`
- Machine result: `.trading/br-eia-event-v1.json`, SHA-256
  `f5a6d2241f01f1d07fa25d04c7fee7a91a0ae11cc73f1387088976a90db87804`
- 109 published events, 6,696 one-minute candles captured from public MOEX
  ISS around the fixed release windows. Event calendar comes from the [EIA
  publication archive](https://www.eia.gov/petroleum/weekly/) and [official
  release schedule](https://www.eia.gov/petroleum/supply/weekly/schedule.php).

## Results

| Period | Completed trades | Base-net winners | Mean gross | Mean base net | Mean stress net |
|---|---:|---:|---:|---:|---:|
| 2024 | 27 | 7 (25.9%) | −0.123% | −0.423% | −0.523% |
| 2025 | 30 | 7 (23.3%) | +0.136% | −0.164% | −0.264% |
| 2026 through Sep 23 | 27 | 9 (33.3%) | +0.059% | −0.241% | −0.341% |
| **Combined** | **84** | **23 (27.4%)** | **+0.028%** | **−0.272%** | **−0.372%** |

Combined exits: 16 stops, 4 targets, 64 time exits. Base profit factor was
0.329; removing the best trade leaves the base-net sum at −24.06 percentage
points of entry notional. The poor result appears in all three year blocks.

Data quality also fails: 3 signal windows lacked a required candle, 19 entered
paths became unresolved at a later missing minute, 3 events were exactly
flat, and 84 trades completed. Even the deliberately over-generous bound that
counts every unresolved path and every missing-signal event as a win yields
at most 45/106 = 42.5% across events that could have generated a trade—still
below 51%, before requiring positive expectancy. The observed trade return
cannot meet the gate.

The screened years were previously used in other BR research; 2026 is not an
untouched holdout. This result is not evidence that the EIA event has no
possible strategy, but this specific first-reaction continuation rule is
rejected. Do not reverse its direction, change the holding window, or alter
the bracket on these same observations and call that validation. OHLC
outcomes do not establish bid/ask fills or exact RUB P&L.

`npm run build` passed; full suite passed (106 files, 342 tests).

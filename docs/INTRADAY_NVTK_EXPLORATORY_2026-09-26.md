# NVTK intraday exploratory checks — 2026-09-26

These are discovery checks, not independently validated strategies or permission
to place orders. All returns below are per completed trade, before tax, not a
portfolio return. The 2026 candles were not used.

## Data

Separate ignored local database: `.trading/nvtk-market-data.sqlite`. Source:
MOEX ISS TQBR one-minute candles. Imported 205,104 (2023), 207,052 (2024),
and 277,980 (2025) candles. The importer reported zero invalid and duplicate
rows in each year; SQLite `integrity_check` returned `ok`. Archive SHA-256:

- 2023: `d9a209720bb861ff0cd0d46c54f6d32bb6b9c2a3d504aec6ea7b69056b5f0317`
- 2024: `ff0b6dbe4ae6be5b93930545ffea848d150f67bfb3b3ba476e1f80a6672ea587`
- 2025: `10b03ac3e6d7f7a6c54bc6255f4eed317d6e5e3c301d6c6fe7f7e095f12aed73`

Only weekdays were considered. A complete 10:00–17:01 MSK window (422 minute
bars) exists for 245, 246, and 240 dates respectively. This check does not
establish historical bid/ask spreads or real executability.

## Fixed-rule transfers

The existing `MORNING_REVERSAL_V1` rule was transferred to NVTK without changing
thresholds: by 12:00, 11:59 close is at least 0.5% below 10:00 open and at
least 0.1% above 11:30 open; buy at 12:01 open and sell at 17:01 open. All
signal dates had exact entry and exit candles. A new ticker is not an independent
time-period holdout. Base costs: 0.3% commission plus 0.05% slippage per side;
stress slippage: 0.1% per side. Costs were applied multiplicatively.

| Year | Trades | Base net winners | Mean gross | Mean base net | Mean stress net |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2023 | 13 | 1 | −0.2681% | −0.9638% | −1.0628% |
| 2024 | 18 | 4 | +0.0338% | −0.6640% | −0.7632% |
| 2025 | 16 | 5 | +0.3404% | −0.3596% | −0.4592% |

The previously used gap rules were transferred to NVTK for 2023–2024 only;
MOEX resumed a separate morning session in 2025, changing the meaning of a
10:00 gap. Compare the 10:00 open with the previous trading date's 18:39 close.
For gaps of at least +1% or at most −1%, buy at 10:01 open and sell at 17:00
open. Require all 421 minute bars in this window. Same costs as above.

| Gap | Year | Trades | Base net winners | Mean gross | Mean base net | Mean stress net |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Down | 2023 | 15 | 6 | +0.5093% | −0.1918% | −0.2916% |
| Down | 2024 | 15 | 4 | +0.5092% | −0.1919% | −0.2916% |
| Up | 2023 | 16 | 4 | −0.2466% | −0.9425% | −1.0415% |
| Up | 2024 | 27 | 8 | −0.0493% | −0.7465% | −0.8457% |

## 2025 early-session checks

These were sequential exploratory tests, not an independently prespecified
pair: the negative-move test followed inspection of the positive-move result.
Require both 07:00 open and 09:49 close, at least 150 of the 170 minutes in
that early window, and exact 10:01 entry and 17:00 exit opens. This yielded
237 eligible weekdays. Buy NVTK if its early-session return is at least +1%
(`up`) or, in the subsequent mirror check, at most −1% (`down`). Same costs.

| Early move | Trades | Base net winners | Mean gross | Mean base net | Mean stress net |
| --- | ---: | ---: | ---: | ---: | ---: |
| Up | 20 | 4 | −0.4261% | −1.1207% | −1.2195% |
| Down | 27 | 8 | +0.3770% | −0.3232% | −0.4228% |

All tested variants fail the 51% net-win and positive mean-net gates at the
current Investor-tariff cost model. Do not tune these thresholds against the
same dates or infer a profitable short trade from the negative long result.
Actual per-order fees, spread, execution, lot history, tax, sizing, and
capacity remain unverified. No 2026 result was opened for this round.

# Failed downside-break reclaim v1 — NVTK transfer result

Status: rejected. The unchanged SBER-v1 signal does not clear costs on the three-year NVTK transfer. There is no eligible Investor trade and only one eligible Trader-like trade; that single trade stopped out.

This transfer protocol was frozen before signal outcomes were calculated: [protocol](ORB_FAILED_DOWNSIDE_RECLAIM_NVTK_TRANSFER_2023_2025_V1.md). NVTK has been explored for other intraday patterns, so these dates are not an untouched holdout.

## Data quality and provenance

| Year | Candles | Invalid | Archive SHA-256 |
| --- | ---: | ---: | --- |
| 2023 | 205,104 | 0 | `d9a209720bb861ff0cd0d46c54f6d32bb6b9c2a3d504aec6ea7b69056b5f0317` |
| 2024 | 207,052 | 0 | `ff0b6dbe4ae6be5b93930545ffea848d150f67bfb3b3ba476e1f80a6672ea587` |
| 2025 | 277,980 | 0 | `10b03ac3e6d7f7a6c54bc6255f4eed317d6e5e3c301d6c6fe7f7e095f12aed73` |

Across 824 dates present in the archives, the calendar rejected 86 weekends/closed/special dates. Of the remaining dates, 725 had the full 271-minute measurement/exit interval; 13 were incomplete and excluded. No generated signal had a missing exit.

Base repository revision: `6f40c7f1de6a3f96854d82426d5b3c9a1e03390d`; experiment code is local and uncommitted. Frozen protocol SHA-256: `97456e8257996f6217a85fc417a319e45dd32f6968667c32064e270eeacbe414`; calculation source SHA-256: `cea3498de962145f69f5e54716ebf2030d1a3738fc9000f24cb83609a5769813`; runner SHA-256: `21d56a7a7e1027f812038a61bbb113a208acb6ad6772130b5f8a660835bce740`; NVTK calendar SHA-256: `f62f5ce47f543e8ae7216317cb1952c95a8d4a4dbe35a4e26efdfb8f41f21837`. The calculations can be reproduced after `npm run build` with:

```bash
T_INVEST_MARKET_DATA_PATH=.trading/nvtk-market-data.sqlite node dist/research-nvtk-failed-downside-reclaim-2023-2025.js
```

This command reads local MOEX archives only; it does not connect to the broker or submit orders. The 10:00–18:40 ordinary weekday schedule and special-date exclusions follow official MOEX schedules for [2023](https://www.moex.com/n51887), [2024](https://www.moex.com/n64121), and [2025](https://www.moex.com/n73701). The previous stock main-session continuous trading period ended at 18:39:59 ([MOEX schedule](https://www.moex.com/a1684)).

## Result

The event funnel was 397 first closes below the opening-range low → 208 five-minute reclaims → 187 valid next-minute entries. Twenty-one reclaim events had an entry opening below the range low and were rejected. The exact signal/exit rules were not changed from the frozen protocol.

| Fee scenario | Cost-eligible trades | Diagnostic net winners | Diagnostic win rate | Diagnostic mean net | Exit reasons for 187 signals |
| --- | ---: | ---: | ---: | ---: | --- |
| Investor: 0.30% commission + 0.05% slippage per side | 0 | 4 / 187 | 2.1% | −0.7044% | 113 stops, 65 targets, 9 time exits |
| Trader-like: 0.05% commission + 0.05% slippage per side | 1 | 50 / 187 | 26.7% | −0.2067% | 113 stops, 65 targets, 9 time exits |

Diagnostic results apply the same 2R/stop/time exit to events that fail the cost-to-risk filter; they are not valid strategy trades. Of the single Trader-like eligible trade, net return was −0.8293% (stop). At Investor costs, none of the 187 stop distances could carry the modeled 0.70% round trip while keeping costs to at most one third of initial risk. The Trader-like diagnostic win rate and expectancy are also negative in every year:

| Year | Signals | Trader-like diagnostic net winners | Mean net | Investor diagnostic net winners | Mean net |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2023 | 58 | 14 (24.1%) | −0.2066% | 1 (1.7%) | −0.7043% |
| 2024 | 60 | 16 (26.7%) | −0.2367% | 3 (5.0%) | −0.7343% |
| 2025 | 69 | 20 (29.0%) | −0.1806% | 0 (0%) | −0.6785% |

This fails the 100 eligible-trade/50-date minimum, the 51% net-win gate, and positive expectancy. Do not loosen the cost-to-risk filter, widen the reclaim window, alter the stop, or tune the target on these same archives. Next exploration must change the economic setup or use a new, independently frozen mechanism; this v1 transfer is rejected.

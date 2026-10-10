# SBERP relative-strength and market-regime v1: discovery result

**Rejected in discovery. Do not trade.** Rules were frozen in [WEEKLY_SBERP_RELATIVE_REGIME_V1.md](WEEKLY_SBERP_RELATIVE_REGIME_V1.md), SHA-256 `51d8e445c1031084b25f00c25eb51a7ed4a1ae7bb53e86cea7b6d824e65e9336`, before running this simulation. Full local audit: `.trading/weekly-sberp-relative-regime-v1.json`. Data: MOEX ISS daily SBERP/SBER 2,827 aligned observations each and IMOEX 2,764 observations, 2015–2025. 2026 was not read.

At the specified 0.3% commission and 0.05% slippage **per side**, 107 of 181 completed SBERP trades won net (59.12%). The mean trade earned +0.784%, profit factor was 1.437, and the sum without five best trade returns was +72.25 percentage points. Higher 0.1%-per-side slippage left +0.684% mean per trade. These trade metrics do not establish a weekly or deployable edge: only **140 of 276 active marked portfolio weeks (50.72%)** were positive, below the predeclared 51% gate. The modeled maximum drawdown was 23.29%; final liquidation value from ₽1m was ₽1.278m. These are historical modeled values, not expected returns.

| Entry period | Completed trades | Net winners | Mean net per trade |
| --- | ---: | ---: | ---: |
| 2016–2019 | 94 | 56 (59.57%) | +1.437% |
| 2020–2022 | 41 | 23 (56.10%) | −0.986% |
| 2023–2025 | 46 | 28 (60.87%) | +1.029% |

The negative middle-period mean is important: 56.1% winners did **not** cover the losing trades and expenses. Annual mean trade returns were negative in 2017, 2018, 2020, and 2025; there were no entries in 2022. In 2020 the mean was −6.52% across 16 trades and the marked portfolio fell 18.30%. The 2025 sample had just three trades, all losers. Thus the period, annual and coverage gates also fail. The simple always-long SBERP control finished at modeled ₽1.827m but had a 64.83% drawdown and negative years, so it is not a safe alternative.

This was a reuse of an existing trend/relative-strength/IMOEX filter on a new instrument, not independent proof: related filters and the same 2015–2025 era had been explored already. Costs remain assumptions; no dividends, taxes, fill uncertainty, or market impact are included. Overlapping 20-session trades are correlated. Do not change the thresholds after seeing these outcomes or use the untouched 2026 period for tuning. A genuinely different predeclared mechanism and independent validation are required to continue.

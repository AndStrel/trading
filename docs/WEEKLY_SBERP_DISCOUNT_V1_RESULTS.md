# SBERP relative-discount v1: discovery result

Status: **rejected in discovery**. Historical simulation only; no broker orders, live deployment, or 2026 holdout access.

The immutable rules are in [WEEKLY_SBERP_DISCOUNT_V1.md](WEEKLY_SBERP_DISCOUNT_V1.md), SHA-256 `6eaf7f8c5d8412564a5f305b2304d066218bb78d2e2ca37aad9572905baf2c0e`. Daily MOEX ISS TQBR sources cover the same 2,827 sessions in 2015–2025: SBER rows SHA-256 `07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab`; SBERP rows SHA-256 `099fbd5eae7e056a2aea986048792175a6bc5139264ffa65d037b908cd28631e`. Exact audit output: `.trading/weekly-sberp-discount-v1.json`.

The signal bought SBERP when its prior-close price relative to SBER was sufficiently below its trailing 252-session median. Entry and exit used later session opens, with a 20-session hold, at most five positions, 0.3% commission and 0.05% slippage on **each** side. The stress scenario increased slippage to 0.1% per side. These are modeling assumptions, not a verified broker tariff or guaranteed fills; taxes, dividends, market impact, and execution limitations are not modeled. Closing-price portfolio marks are indicative, not executable exits.

| Measure, 2016–2025 | Discount signal | Always-long SBERP control |
| --- | ---: | ---: |
| Completed trades | 51 | 513 |
| Net winning trades | 29 / 51 (56.86%) | 301 / 513 (58.67%) |
| Mean net return per trade | +0.587% | +0.923% |
| Profit factor | 1.325 | 1.348 |
| Sum of trade returns without five best | −18.39 percentage points | +331.90 percentage points |
| Positive active weeks | 47 / 93 (50.54%) | 281 / 518 (54.25%) |
| Maximum marked portfolio drawdown | −14.04% | −64.83% |
| Ending modeled liquidation value, from ₽1m | ₽1.046m | ₽1.827m |

The trade-win percentage alone exceeds 51%, but the strategy fails the predeclared minimum of 100 trades, the 51% **positive-week** threshold, and the robustness requirement. Its first 10 trades in 2016 averaged +6.08%, while 2020–2022 had only 1 winner in 5 trades and −2.41% mean; 2023–2025 had 20 winners in 36 trades but −0.52% mean. The signal traded zero times in 2017–2019 and 2022–2023. Its 2021 and 2024 trade cohorts lost on average. Removing the five best trades makes the full-sample sum negative. The apparent aggregate edge is concentrated and weaker than the trivial control.

The control is **not** a successful trading system either: its 2018, 2021, and 2022 trade cohorts had negative mean returns, and its marked portfolio lost 42.41% in 2022, with a peak-to-trough drawdown of 64.83%. Its 2024 and 2025 marked calendar-year portfolio returns were also negative. Overlapping 20-session trades are correlated, so trade count is not a count of independent observations. Both simulations are sensitive to unmodeled dividends and actual execution costs; the large drawdown is especially incompatible with treating the control as a safe substitute.

Decision: do not trade or tune this ratio threshold on these same years. Keep 2026 unseen. The next hypothesis should be specified before another run and compared against this control with positive-week, annual, drawdown, and cost gates—not merely 51% profitable trades.

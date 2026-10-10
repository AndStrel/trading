# Weekly SBERP reversal v1: corrected temporal-integrity result

**Rejected.** This replaces the [initial result](WEEKLY_SBERP_REVERSAL_V1_RESULTS.md), which had inadvertently used a future trading-calendar gap to cancel an entry. The original frozen rule remains at SHA-256 `f19fb2607dec3e418cef07314660ef5b75c2c024b896e2b7ac8416d27a231444`; the explicit [look-ahead amendment](WEEKLY_SBERP_REVERSAL_V1_AMENDMENT.md) is SHA-256 `9719a56e8fe76d7b7ad2abaf4248b47c762a710b5f6f2b9996f2bfd3479693c9`. Machine-readable corrected ledger: `.trading/weekly-sberp-reversal-v1-amended.json`. Historical MOEX ISS TQBR SBERP daily data 2015–2025 only; 2026 untouched.

The crucial difference is the entry on **2022-02-21**. The first following observed weekly open was **2022-03-24**, after a 31-day hold; the trade returned **−45.76% net**. The original backtest incorrectly excluded it because it knew in advance that the following calendar week would be unavailable. This single look-ahead error materially overstated the strategy.

| Metric after correction | Value |
| --- | ---: |
| Net-winning completed trades | 74 / 146 = **50.68%** |
| Positive marked active weeks | 137 / 251 = **54.58%** |
| Mean net trade, base costs | **−0.291%** |
| Mean net trade, stress slippage | **−0.391%** |
| Profit factor | **0.844** |
| Sum of trade returns without best five | **−91.73 percentage points** |
| Ending modeled equity from ₽1m | **₽0.490m** |
| Maximum marked drawdown | **−75.12%** |

The positive-week fraction and negative trade-win fraction are not contradictory: portfolio weeks with an entry, holding, or exit are counted separately from completed entry-to-exit trades. The user objective requires both a repeatable winning frequency and profitability after realistic costs; this strategy achieves neither on the corrected trade-level record. The 2020–2022 cohort fell to 20 winners in 45 trades (44.44%) and −2.055% mean net per trade. The same-holding always-long control is also unusable (46.64% net-winning trades, ending modeled equity ₽0.109m, 93.90% drawdown).

This is price-only historical simulation with assumed 0.3% commission and 0.05% slippage per side. It does not model dividends, taxes, actual fills, market impact, or available liquidity after suspension. The observed gap illustrates why an entry rule must never depend on future calendar data. No threshold tuning, broker orders, or deployment follows from this result.

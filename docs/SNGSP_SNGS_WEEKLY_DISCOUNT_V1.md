# Frozen protocol: SNGSP vs SNGS weekly preferred discount v1

Research only; no orders. Transfer of the frozen SBERP MAD-discount rule to a different dual-share issuer (Surgutneftegas). This is not a threshold retune on SBER/SBERP, not TATN/TATNP intraday, and not an oil-vs-index lag.

Hypothesis: when SNGSP’s close/SNGS close on the prior weekday is more than one robust-sigma below its trailing 252-session median, some of that **preferred discount** mean-reverts over the next 20 weekday sessions. Long SNGSP only; SNGS is the indicator. No short.

## Source

Public MOEX ISS daily `interval=24` TQBR SNGS and SNGSP, 2015-01-01–2025-12-31. No 2026. Abort if any year has weekday row count outside 150–400. Align on identical calendars (same dates, same length).

## Signal

Reuse `simulateWeeklySberpDiscount` with SNGS as the ordinary series and SNGSP as the traded preferred series. Same MAD window (252 prior ratios, current ratio excluded), same `r < m − 1.4826×MAD`, same weekly first-weekday entry, 20-session exit, five-slot cap, Investor 0.3% + 0.05% slippage per side, stress 0.10%. Do not change windows or multipliers after seeing results.

Controls: always-long SNGSP weekly (`simulateWeeklyTrend`); SNGSP buy-and-hold; SBMM buy-and-hold on 2023-01-01–2025-12-31 (cash sleeve on the period where SBMM exists).

## Gates

Same as SBERP discount v1: ≥100 completed trades in ≥50 weeks; combined win rate ≥51% and mean net > 0; PF > 1; without-best-five sum > 0; active-week win rate ≥51%; each of 2016–2019 / 2020–2022 / 2023–2025 with trades has win rate ≥51% and mean net > 0; every year 2016–2025 with entries has mean net > 0; no unobserved year. Also reject if combined ending ≤ always-long SNGSP control or if 2023–2025 rule ending (re-run books from 2023-01-01 using the same signal on the full history) ≤ SBMM buy-and-hold over that window.

Do not reverse to “buy when premium is wide” on this sample. No orders even if gates pass (dividends, lots, fills, independent 2026 still required).

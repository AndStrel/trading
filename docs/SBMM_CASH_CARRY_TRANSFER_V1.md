# Frozen protocol: SBMM cash-carry transfer v1

Research only; no order authorization. This transfers the already frozen [LQDT 20-session carry](WEEKLY_LQDT_CARRY_V1.md) onto **another** MOEX TQTF money-market fund unit, SBMM, without changing thresholds, costs, overlap rules, or calendar windows after seeing SBMM returns.

SBMM is not a bank deposit; the unit price can fall. The question is whether the LQDT historical observation (high rolling win rate, but worse than one continuous hold after Investor costs) is fund-specific or a class property of ruble money-market ETFs in 2023–2025.

## Source

Public MOEX ISS daily candles, board TQTF, security SBMM, `interval=24`. Weekend sessions are excluded by the same engine as LQDT. Do not use 2026. Do not backfill missing years. If 2021 or 2022 rows exist, they are warmup history only.

Predeclared evaluation windows, independent of SBMM returns:

- Discovery: 2023-01-01 through 2024-12-31
- Validation: 2025-01-01 through 2025-12-31
- Combined: 2023-01-01 through 2025-12-31

If a window has too few lagged weekday sessions to generate any decision after the 21-session warmup, report that coverage failure and **reject** the transfer; do not shorten the hold or move the window.

## Rule (identical to LQDT v1)

At the first observed weekday of each calendar week in the evaluation window, using only completed prior sessions: require 21 prior eligible sessions and a previous close at most 7 calendar days old. Enter long SBMM at that day's `open` only when `priorClose / close20SessionsEarlier` exceeds the exact Investor base break-even ratio `[(1+0.0005)(1+0.003)] / [(1-0.0005)(1-0.003)]`. Exit at `open` 20 eligible weekday sessions later. At most five overlapping positions; each new principal at most 1/5 of marked equity and available cash. Separate ₽1m books for discovery, validation, and combined. Pending end-of-window positions are marked, not counted as completed wins.

Controls, same costs: (1) always-long weekly entries; (2) one buy at the window start and one sale at the window end (`buyAndHoldLqdt` on SBMM bars).

Base costs: 0.3% commission + 0.05% adverse slippage per side. Stress: 0.10% slippage per side.

Reuse `simulateWeeklyLqdtCarry` / `buyAndHoldLqdt` without changing the numeric rule.

## Gates

Same as LQDT v1 for the rolling rule. Even if they pass, do not recommend rolling if it loses to continuous hold after the same costs. A passing continuous-hold comparison is a **cash-parking observation**, not a directional edge and not live authorization. Tariff, spread, lots, taxes, NAV premium/discount, and 2026 rate regimes remain unverified. No broker orders.

Do not retune the ratio, hold length, overlap, or years after seeing SBMM outcomes.

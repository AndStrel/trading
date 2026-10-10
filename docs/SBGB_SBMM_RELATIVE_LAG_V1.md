# Frozen protocol: SBGB vs SBMM 20-session relative lag v1

Research only; no orders. SBGB is an OFZ bond ETF unit; SBMM is a money-market ETF unit. Neither is a deposit.

Hypothesis: when SBGB’s last completed 20 eligible sessions underperform SBMM by more than the modeled Investor round-trip cost, some of that relative lag mean-reverts over the next 20 sessions. This is a **relative-value duration lag**, not a claim that OFZ always beat cash, and not a retune of the rejected SBER/GAZP relative-strength rule.

## Source

Public MOEX ISS TQTF daily candles, `interval=24`, securities SBGB and SBMM. Align on the intersection of weekday dates present in **both** series; do not impute a missing date. 2021–2022 are warmup/history only. Do not use 2026.

Windows, fixed before SBGB outcomes: discovery 2023-01-01–2024-12-31, validation 2025-01-01–2025-12-31, combined 2023–2025. Separate ₽1m books.

## Signal and execution

At the first aligned weekday of each calendar week in the window, using only completed prior aligned sessions:

- Need 21 prior aligned sessions and the previous session at most 7 calendar days old.
- `sbgbRatio = sbgbClose[t-1] / sbgbClose[t-21]`
- `sbmmRatio = sbmmClose[t-1] / sbmmClose[t-21]`
- Enter **long SBGB only** when `sbgbRatio * breakevenRatio < sbmmRatio`, where `breakevenRatio = [(1+0.0005)(1+0.003)] / [(1-0.0005)(1-0.003)]` (same formula as LQDT/SBMM carry).
- Buy SBGB at that day’s open; sell at open 20 aligned weekday sessions later.
- At most five overlapping SBGB positions; new principal ≤ 1/5 marked equity and cash. No short SBMM, no leverage, no averaging beyond the five-slot cap.

Costs: 0.3% commission + 0.05% slippage per side; stress 0.10% slippage per side. Apply only to SBGB trades.

## Controls

1. Always-long SBGB on the same weekly entry calendar and 20-session hold.
2. One-time SBGB buy-and-hold over the same window.
3. One-time SBMM buy-and-hold over the same window (cash-sleeve comparator).

## Gates

Rolling relative rule: combined ≥100 completed trades and ≥50 entry weeks; discovery, validation, and combined each ≥51% net winners, positive mean net and stress mean, profit factor >1 or all completed wins, positive sum without five best, ≥51% positive active marked weeks, ending equity > ₽1m; every calendar year 2023–2025 with trades has positive mean net.

Even if those pass, **reject as a trading rule** if ending equity ≤ SBGB buy-and-hold or ≤ SBMM buy-and-hold on the combined book. Beating stocks of one ETF while losing to parking in SBMM is not an edge over the already implemented cash sleeve.

Do not change the lag length, ratio, overlap, or years after seeing returns. No broker orders.

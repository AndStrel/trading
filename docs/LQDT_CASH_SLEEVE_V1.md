# LQDT continuous-hold cash sleeve v1 — operational paper policy

Research-to-paper policy only. Not a forecasting edge and not live-order authorization.

## Why this exists

The frozen [weekly LQDT carry](WEEKLY_LQDT_CARRY_V1.md) rule cleared historical win-rate gates on 2023–2025, but the rolling 20-session strategy ended below a **single continuous buy-and-hold** of LQDT after the same modeled Investor costs ([result](WEEKLY_LQDT_CARRY_V1_RESULTS.md)). Frequent round trips destroyed carry. Therefore the only economically consistent paper use of that finding is: park idle research/paper cash in LQDT once and hold, without weekly re-entry churn.

## Policy (frozen)

1. Instrument: LQDT (default) or SBMM (MOEX TQTF money-market fund units). Not a bank deposit; unit price can fall. The [aligned hold comparison](LQDT_SBMM_SLEEVE_CHOICE_V1_RESULTS.md) keeps LQDT as default (endings within 1%, milder drawdown). The [SBMM transfer](SBMM_CASH_CARRY_TRANSFER_V1_RESULTS.md) showed rolling 20-session trades lose to one continuous hold.
2. Role tag: `cash_sleeve` — capital parking, not alpha.
3. At most **one** open sleeve position per paper book. While open, refuse additional buys (no averaging, no weekly restart).
4. Entry: deploy configured cash principal at the next observed weekday open (or a supplied mark price in paper tests), applying Investor base costs 0.3% commission + 0.05% adverse slippage per side when converting cash↔units.
5. Mark-to-market: update marked equity from the latest close/mark without trading.
6. Exit: only on explicit sleeve termination (policy end or human paper close). Do not auto-rotate every N sessions.
7. Compare any competing LQDT trading rule to this continuous hold before claiming economic value.

## Costs and limits

Modeled Investor share costs match [GAPS_AND_COSTS_REVIEW](GAPS_AND_COSTS_REVIEW.md). Account-specific LQDT tariff, spread, lot size, taxes, NAV premium/discount, and 2026 rate-regime behavior remain unverified. High 2023–2025 carry does not guarantee future income. No broker orders.

## Implementation

Deterministic helpers live in `src/domain/lqdt-cash-sleeve.ts`. The local journal table `paper_cash_sleeves` stores at most one open sleeve per book. MCP tools `open_paper_cash_sleeve`, `mark_paper_cash_sleeve`, `close_paper_cash_sleeve`, and `get_paper_cash_sleeve` apply the same rules with a current last-price mark; they never submit broker orders. Historical comparator remains `buyAndHoldLqdt` in `src/research/weekly-lqdt-carry.ts`.

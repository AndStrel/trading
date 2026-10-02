# Isolated VTBR technical acceptance — 2026-10-02

Human scope: sandbox only, **VTBR TQBR, 1 lot / 1 share, entry position <= 70 RUB**, BUY, protective native stop, close. No production orders, account opening, funding, margin, or additional entry. This is technical execution evidence, **not a strategy signal, profitability result or admission to live trading**.

## Observed broker cycle

- BUY: 1 share, 52.335 RUB; confirmed full fill.
- Protective stop: 51.335 RUB, broker-confirmed ACTIVE.
- Explicit technical close: durable cancellation claim; exact CANCELED stop confirmed again after position/quote reads; one whole-position FOK SELL.
- SELL: 1 share, 52.265 RUB; confirmed full fill.
- Reported execution fees: BUY 0.0261675 RUB, SELL 0.0261325 RUB.
- Execution-based net: **-0.122300 RUB** (conservative whole-kopeck display: -0.13 RUB).
- Independent fresh account read: no positions, no active orders, no active stops; canceled test stop remains identifiable. Final virtual cash: **999.877701 RUB**.
- Cash minus initial 1000 RUB is -0.122299 RUB: **a +0.000001 RUB discrepancy** against the execution-fee-based ledger. This is recorded, NOT treated as exact economic reconciliation and NOT erased by topping up. Its origin remains unverified.
- Server remained `execution=disabled`, `kill=true`, no unresolved execution orders. Isolated local journal ended killed. Production credentials were not present in the local runner.

The sandbox's reported commission is lower than the research/real-account assumption. Research admission retains Investor commission **0.003 per side**, plus modeled slippage and stress. Sandbox P&L must never replace those costs.

## Failures caught and repaired

1. Unrelated shares can omit a price increment. Validate the chosen unique VTBR metadata, not every unrelated instrument.
2. REST whole-lot depth is an int64 string. Accept bounded integer strings and numbers; reject fractions, missing/zero depth, over-cap prices and wrong ticks.
3. Actual sandbox `GetSandboxOrderState` returned `FILL`, one lot, but empty `stages`. Protection initially refused to invent fills. Read-only recovery now cross-checks the order's exact UID, direction, order timestamp and executed total with a **unique real sandbox operation and trade**, matching quantity, payment, price and trade time. Actual trade IDs and operation provenance are journaled. No aggregate fake trades or guessed timestamps are created.

This fallback is deliberately restricted to one executed unit with a real trade. Multi-lot/partial or ambiguous evidence remains blocked. It applies only to sandbox read endpoints. Populated stages continue through the existing strict parser.

## Runner / audit / recovery

`dist/sandbox-technical-acceptance.js` is a separate local operator entrypoint, NOT a bot command, public API, background worker or live executor. It is not wired into Telegram/MiniApp.

- Fixed credential snapshot mount `/run/private/snapshot.json`, read-only, private permissions; production/Telegram credentials are rejected.
- Dedicated persistent private `/run/audit`; broker/account identifiers and journals stay outside Git.
- `run` atomically creates a permanent single-attempt latch before mutable journal/entry. It arms only an independently prepared account with exact original flat cash, never creates/funds accounts. Re-running entry is forbidden.
- `reconcile` only reads broker state and records evidence; it cannot BUY, cancel or SELL.
- `recover` reconciles the existing entry, installs or verifies the journal-bound protective stop without repeating its POST, then invokes explicit bounded technical close.
- `close` closes only that approved technical position; it never submits entry or repeats an uncertain cancellation/SELL.
- All phases require the exact explicit scope argument `SANDBOX VTBR 1 LOT MAX 70 RUB BUY STOP CLOSE`.
- The legacy intraday journal label is retained solely for shared risk/execution plumbing. Snapshot purpose and warnings explicitly identify technical acceptance. The synthetic upper price exercises deterministic arithmetic; it is not a market forecast or take-profit order. This private journal must not enter strategy research/performance statistics.
- Normal strategy entries and scheduled closing windows remain unchanged.

Validation: `npm run check` (710 tests across 55 files) and `npm run build` passed before recovery/stop/close; separate fresh broker readback confirmed final flatness. Cash reconciliation discrepancy remains an open acceptance item. This test does not demonstrate stop-trigger liquidation or production execution readiness.

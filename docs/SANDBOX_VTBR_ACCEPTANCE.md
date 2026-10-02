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

## Second isolated case: native stop-trigger liquidation

Additional human authorization permits sandbox test fixtures and tests without repeated per-test approval. The original account, loss and journal were preserved. A **new** separately named virtual fixture was opened and funded once with 1000 RUB, outside production and outside strategy statistics. Standard bot arming still requires its original single-account ownership rule; fixture arming is a separate local-only path with exact named ownership and authorization.

Observed broker evidence on 2026-10-02:

- BUY: one VTBR share at 51.875 RUB, full fill; commission 0.0259375 RUB.
- Native STOP_LIMIT trigger and child limit: 51.870 RUB.
- Initial stop submission was unconfirmed. One exact-key recovery returned HTTP 400; an additional explicitly bounded diagnostic replay of the **same UUID and unchanged parameters** returned a matching acknowledgement. The original rejection reason remains unverified; this was not a clean first-attempt cycle.
- Broker confirmed ACTIVE, then EXECUTED with an exchange child order ID. No competing manual SELL or stop cancellation was sent in this case.
- Child SELL: one share at 51.890 RUB, full fill, commission 0.025945 RUB. Actual operation/trade evidence confirmed the exact exchange ID, instrument, direction, timestamp, quantity, price and payment.
- Ledger net: **-0.0368825 RUB**, calculated in integer nanorubles. A higher sell price does not mean net profit after fees.
- Independent fresh readback confirmed flat position, no active orders and no active stops; final virtual cash **999.963118 RUB**. Cash delta -0.036882 RUB differs from the execution ledger by **+0.0000005 RUB**. This discrepancy is retained as unresolved accounting evidence, never erased by refill.
- Private journal result is complete and kill switch is true. This establishes native-stop execution and flatness, **not exact economic reconciliation, a profitable strategy, clean first-attempt reliability or live readiness**.

The observed child order had empty `orderRequestId` and empty `stages`. An empty client ID is accepted only through the existing exact exchange-ID binding for native children; ordinary entry/session-exit matching still rejects it. Filled one-unit stages are recovered by reads of the unique real operation/trade, not fabricated from aggregate values. Regression tests cover foreign child identity and rejection of an empty ID for our own submitted orders.

Local-only tools: `sandbox-fixture-prepare.js` and `sandbox-native-acceptance.js`, with a dedicated persistent private audit mount. Permanent filesystem latches guard fixture creation, funding and entry. Uncertain creation/funding are reconciled by reads and never automatically repeated. The explicitly bounded stop-key recovery paths preserve the original key and parameters and require named fixture ownership, exact position, two empty order/stop-book observations, a one-hour window and permanent per-attempt latches. They are not bot commands or scheduled retries. Real credentials are rejected.

Technical stop-limit pricing may differ from its trigger only for the explicitly identified one-unit VTBR case, with valid ticks, fresh BID evidence and at most 1 RUB entry-to-limit distance. Both service and durable journal enforce that scope; ordinary stops remain unchanged. Planned risk uses the worse limit price, not just the trigger.

Validation after the child evidence repair and error-diagnostic regressions: `npm run check` **732 tests / 56 files**, `npm run build`, and independent fresh broker cash/fill/flat readback passed. The two cash discrepancies and initial stop rejection remain open. Production orders remain disabled.

## Follow-up first-attempt checks

Both follow-up fixtures preserve previous account histories; each was initialized once with 1000 virtual RUB. These technical cases are not a strategy sample.

1. Repeating the original near-entry rule again filled BUY but initially returned HTTP 400 for the stop. An explicitly bounded same-key recovery accepted the unchanged stop; it later triggered and sold fully. BUY 51.875 RUB, fee 0.0259375; SELL 51.895 RUB, fee 0.0259475; net **-0.031885 RUB**. Fresh cash 999.968116 RUB; cash-versus-ledger difference **+0.000001 RUB**, unresolved. Flatness, no active orders/stops and killed journal were independently confirmed.
2. The amended technical rule requires one unique fresh, tick-valid actual last trade (maximum age 15 seconds), and puts the trigger one tick below the minimum of entry, executable BID and last trade. The child limit is another tick lower, still within the existing one-RUB maximum distance. It passed the first stop submission without recovery, then triggered, fully sold and independently confirmed flatness. BUY 51.900 RUB, fee 0.02595; SELL 51.895 RUB, fee 0.0259475; net **-0.0568975 RUB**. Fresh cash 999.943103 RUB; discrepancy **+0.0000005 RUB**, unresolved. This is **one observed clean first-attempt cycle**, not statistical reliability or proof of the cause of previous HTTP errors.

The initial rejection reason remains unverified. Diagnostics retain numeric codes and tags from a fixed public vocabulary, never arbitrary response text. The technical freshness gates now explicitly reject invalid clocks and duplicate last-trade identities. Ordinary strategy stops are not changed by this local technical pricing rule.

An acknowledged ACTIVE stop is reported as `native-stop-awaiting-trigger`, not success and not a failed sale. A completed-cycle result still requires the actual child fill, fees and fresh flat account. No manual SELL was used in these native-trigger cases. Local validation: **735 tests / 56 files**, build and diff check passed. All four technical positions are closed; all historical journals and cash discrepancies remain preserved.

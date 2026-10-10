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

Installed-path correction (3 October 2026): the runner and narrow technical
scope are tracked in accepted main. Commit `30264a5` is an ancestor of
`f1d56be` and the file exists in that Git revision. The earlier statement that
this executable existed only in unmerged [PR #74](https://github.com/AndStrel/trading/pull/74)
was incorrect. Presence of the runner does **not** make a fresh cycle ready:
current clock/account/cash/ownership gates still apply. The broker observations
above remain historical; they are not a new cash proof.

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

## New cash-acceptance contract

The next software slice adds `preflight` to the separate runner. It is strictly
read-only: no journal, arming, permanent latch, funding, BUY, STOP or SELL. It
first checks the real current Mon–Fri 10:05–18:00 pilot window, then exact
prepared identity, original flat RUB cash, empty orders and **empty complete
stop history**. A canceled historical stop is not an empty history. Reads are
bounded to 30 seconds and the clock is checked again before a run claim.
Outside the window no broker read or attempt claim is made. Do not override
the clock, disable session-close protection, reset a latch, refill prior loss,
or rewrite the configured initial balance to get a green result.

After building this version, the internal container entrypoint is:

```sh
node dist/sandbox-technical-acceptance.js preflight \
  'SANDBOX VTBR 1 LOT MAX 70 RUB BUY STOP CLOSE'
```

This is a container-internal command, not a host `.env` loader. It requires a
separately prepared private read-only snapshot at `/run/private/snapshot.json`,
with only the necessary read/sandbox roles, unchanged agreed risk/cost settings
and prepared sandbox identity. Production/Telegram credentials are rejected.
Do not mount the server `.env`, the main journal or a full private directory.
`preflight` needs no `/run/audit` mount. `run`/recovery still need the original
dedicated private audit; never start a second entry in a new audit to recover
an uncertain old one.

New fixture snapshots explicitly opt in with
`technicalCashAcceptance: { version: '1' }`. A matching immutable pre-BUY
baseline is required before this policy can restore protection. Confirmed
not-submitted SELL, or broker-proven terminal CANCELLED/REJECTED **zero-fill**
SELL, can claim one replacement STOP under current prepared identity,
generation and ledger CAS. Unknown/NEW/partial/timeout SELL cannot. An own
fresh CANCELED observation advances the ledger in the same fenced transaction;
unrelated concurrent changes are not accepted. Fees and risk stay reserved.

After verified restoration, repeated explicit technical calls only read/verify
that protection; they do not cancel or SELL again. At most one later ordinary
due-session close can follow. A second restoration never permits a third SELL.
Legacy/no-baseline scenarios are not silently adopted into this policy.

Final CLI success is now `sandbox-cash-confirmed` only for
`complete && cashProven && cashStatus === 'reconciled'`. Fills/flat alone,
missing evidence or an exact-money mismatch produce `sandbox-cash-incomplete`
and nonzero exit. `executionBasedNetRub` is labeled as execution-based; raw
cash, account/operation IDs and private reasons are not emitted. A failure to
persist kill also remains a fixed safe failure with
`localJournalKillConfirmed:false`, never a raw stack or claimed kill success.

These are software contracts. No fresh broker BUY/protection/exit/cash cycle
has yet validated this version; no strategy profit or real-trading admission
is inferred. The old 1,000-nano discrepancy remains unresolved.

import type { AppConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { assertNoSandboxOrders, sandboxFlatCashNano } from './sandbox-flat-account.js';
import { parseSandboxExitOrderState, parseSandboxOrderState, parseSandboxSessionExitOrderState, type SandboxOrderSnapshot } from './sandbox-order-state.js';
import { analyzeSandboxRoundTrip } from './sandbox-round-trip.js';
import { assertNoActiveSandboxStops, nativeStopKey, parseSandboxStop } from './sandbox-stop-state.js';
import { sandboxCloseKey } from './sandbox-session-policy.js';
import type { TInvestOrderClient } from './tinvest-order-client.js';

// This client surface cannot place, cancel, create or fund anything.
type Client = Pick<TInvestOrderClient, 'getSandboxOrderState' | 'getSandboxChildOrderState'
  | 'getSandboxStopOrders' | 'getSandboxPositions' | 'getSandboxOrders'>;

// An archived failed target SELL is not a new order or the final exit. Refresh
// only its exact durable request UUID, so late fees never disappear from loss.
export async function refreshArchivedSandboxCloseEvidence(client: Pick<Client, 'getSandboxOrderState'>, journal: ScenarioJournal,
  expected: { accountId: string; scenarioId: number; entryRequestId: string; instrumentId: string; lotSize: number },
  entry: SandboxOrderSnapshot, now: Date): Promise<void> {
  const history = journal.getSandboxCloseHistory(expected.scenarioId);
  const lastEntryAt = Math.max(...entry.stages.map(stage => Date.parse(stage.executedAt)));
  for (const archived of history) {
    const intent = archived.intent;
    if (!intent.submitClaimedAt) continue;
    const key = sandboxCloseKey(intent);
    if (intent.accountId !== expected.accountId || intent.entryRequestId !== expected.entryRequestId
      || intent.instrumentId !== expected.instrumentId || intent.lots !== entry.lotsExecuted
      || !archived.sellSnapshot?.terminal || archived.sellSnapshot.lotsExecuted !== 0) {
      throw new Error('Archived sandbox close evidence is incomplete');
    }
    const snapshot = parseSandboxSessionExitOrderState(await client.getSandboxOrderState(expected.accountId, key.requestId), {
      requestId: key.requestId, brokerOrderId: archived.sellSnapshot.brokerOrderId, instrumentId: expected.instrumentId,
      lots: intent.lots, lotSize: expected.lotSize,
      notBefore: new Date(Math.max(lastEntryAt, Date.parse(intent.submitClaimedAt))).toISOString(),
    }, now);
    journal.refreshArchivedCloseObservation(key, snapshot, now);
    if (snapshot.commissionNano === null) throw new Error('Archived sandbox close evidence is incomplete');
  }
  if (journal.getSandboxFailedCloseCosts(expected.scenarioId).commissionNano === null) {
    throw new Error('Archived sandbox close evidence is incomplete');
  }
}

export class SandboxExitService {
  constructor(private readonly config: AppConfig, private readonly client: Client, private readonly journal: ScenarioJournal) {}

  async reconcile(accountId: string, scenarioId: number, now = new Date()) {
    if (this.config.execution.mode !== 'sandbox' || !this.config.execution.sandboxProtectionEnabled || !this.config.livePilot.prepare
      || !this.config.execution.token || this.config.execution.token === this.config.token) throw new Error('Isolated sandbox exit reconciliation is not enabled');
    try {
      const order = this.journal.getExecutionByScenario(scenarioId); const scenario = this.journal.getScenario(scenarioId);
      const native = this.journal.getNativeStop(scenarioId);
      if (!order || !scenario || order.mode !== 'sandbox' || order.status !== 'accepted' || !order.approvedByChatId
        || !native || native.intent.accountId !== accountId || !native.intent.brokerStopId) throw new Error();
      const expectedNative = nativeStopKey(native.intent);
      const session = this.journal.getSandboxSessionExit(scenarioId);
      const expectedClose = session ? sandboxCloseKey(session) : undefined;
      const stop = parseSandboxStop(await this.client.getSandboxStopOrders(accountId), native.intent, now);
      const timed = stop.status === 'STOP_ORDER_STATUS_CANCELED' && session?.phase === 'submitted'
        && session.accountId === accountId && session.stopId === native.intent.brokerStopId && session.lots === native.intent.lots;
      if ((!timed && (stop.status !== 'STOP_ORDER_STATUS_EXECUTED' || !stop.childOrderId)) || (stop.status === 'STOP_ORDER_STATUS_EXECUTED' && session?.phase === 'submitted')) throw new Error();
      this.journal.observeNativeStop(scenarioId, stop, expectedNative);
      // Refresh actual fees as well as fills; a historical cheap snapshot must
      // not make the reported net more favourable than broker evidence.
      const entry = parseSandboxOrderState(await this.client.getSandboxOrderState(accountId, order.orderRequestId), {
        requestId: order.orderRequestId, instrumentId: order.instrumentId, lots: order.lots, lotSize: scenario.input.lotSize,
      }, now);
      if (!entry.terminal || entry.lotsExecuted !== native.intent.lots) throw new Error();
      this.journal.recordExecutionReconciliation(scenarioId, entry);
      await refreshArchivedSandboxCloseEvidence(this.client, this.journal, { accountId, scenarioId,
        entryRequestId: order.orderRequestId, instrumentId: order.instrumentId, lotSize: scenario.input.lotSize }, entry, now);
      const lastEntryAt = new Date(Math.max(...entry.stages.map(stage => Date.parse(stage.executedAt)))).toISOString();
      const exit = timed ? parseSandboxSessionExitOrderState(await this.client.getSandboxOrderState(accountId, session.requestId), {
        requestId: session.requestId, brokerOrderId: session.brokerOrderId, instrumentId: order.instrumentId, lots: native.intent.lots,
        lotSize: scenario.input.lotSize, notBefore: new Date(Math.max(Date.parse(lastEntryAt), Date.parse(session.submitClaimedAt!))).toISOString(),
      }, now) : parseSandboxExitOrderState(await this.client.getSandboxChildOrderState(accountId, stop.childOrderId!), {
        brokerOrderId: stop.childOrderId!, instrumentId: order.instrumentId, lots: native.intent.lots,
        lotSize: scenario.input.lotSize, notBefore: lastEntryAt,
      }, now);
      if (timed) this.journal.acknowledgeSandboxSessionExit(scenarioId, session.requestId, exit.brokerOrderId, expectedClose);
      const result = analyzeSandboxRoundTrip(entry, exit, scenario.input.lotSize);
      if (timed && (session.purpose === 'target' || session.targetConsumed === true) && exit.lotsExecuted === 0) {
        this.journal.recordCloseSellObservation(expectedClose!, exit, now);
        this.journal.setExecutionKilled(true);
        return { ...result, flatConfirmedAt: null, observedAt: now.toISOString(), complete: false };
      }
      // Save sold lots even if an ensuing position read fails; never keep a
      // stale flat flag after a fresh inconsistent account observation.
      let recorded = this.journal.recordSandboxExitEvidence(scenarioId, exit, null, now, expectedNative, expectedClose);
      let flatConfirmedAt: string | null = null;
      if (result.fullySold) {
        const [positions, orders, stops] = await Promise.all([this.client.getSandboxPositions(accountId),
          this.client.getSandboxOrders(accountId), this.client.getSandboxStopOrders(accountId)]);
        sandboxFlatCashNano(positions, accountId); assertNoSandboxOrders(orders); assertNoActiveSandboxStops(stops);
        // The second book read must still contain our executed stop and child.
        const confirmed = parseSandboxStop(stops, native.intent, now);
        if (confirmed.status !== stop.status || confirmed.childOrderId !== stop.childOrderId) throw new Error();
        this.journal.observeNativeStop(scenarioId, confirmed, expectedNative);
        flatConfirmedAt = now.toISOString();
        recorded = this.journal.recordSandboxExitEvidence(scenarioId, exit, flatConfirmedAt, now, expectedNative, expectedClose);
      }
      // No automatic resume or reservation release: actual-loss/closing policy
      // and broker acceptance must still be implemented and proven first.
      this.journal.setExecutionKilled(true);
      return recorded;
    } catch {
      this.journal.setExecutionKilled(true);
      throw new Error('Sandbox sale or flat account is not confirmed; no broker order was sent and prior risk remains reserved');
    }
  }
}

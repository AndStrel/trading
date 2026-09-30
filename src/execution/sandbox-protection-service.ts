import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { JournalScenarioRecord } from '../journal/scenario-journal.js';
import { ScenarioJournal, type NativeStopRecord } from '../journal/scenario-journal.js';
import { assessLivePilotRisk } from './live-pilot-risk.js';
import { parseSandboxOrderState } from './sandbox-order-state.js';
import { assertNoActiveSandboxStops, assertSandboxPosition, decimalPriceNano, parseSandboxStop } from './sandbox-stop-state.js';
import type { TInvestOrderClient } from './tinvest-order-client.js';
import { assertNoSandboxOrders, sandboxFlatCashNano } from './sandbox-flat-account.js';

type Client = Pick<TInvestOrderClient, 'getSandboxOrderState' | 'getSandboxPositions' | 'getSandboxStopOrders' | 'getSandboxOrders' | 'postSandboxStopLimit'>;

export class SandboxProtectionService {
  private readonly inFlight = new Map<number, { accountId: string; result: Promise<{ status: 'STOP_ORDER_STATUS_ACTIVE' | 'STOP_ORDER_STATUS_EXECUTED' | 'STOP_ORDER_STATUS_CANCELED' | 'STOP_ORDER_STATUS_EXPIRED'; lots: number; positionClosed: false }> }>();
  constructor(private readonly config: AppConfig, private readonly client: Client, private readonly journal: ScenarioJournal) {}
  private enabled() {
    if (!this.config.execution.sandboxProtectionEnabled || this.config.execution.mode !== 'sandbox' || !this.config.livePilot.prepare
      || !this.config.execution.token || this.config.execution.token === this.config.token) throw new Error('Isolated sandbox protection is not enabled');
  }

  async preflightForEntry(accountId: string, scenario: JournalScenarioRecord, lots: number): Promise<void> {
    this.enabled();
    try {
      const [positions, stops, orders] = await Promise.all([this.client.getSandboxPositions(accountId),
        this.client.getSandboxStopOrders(accountId), this.client.getSandboxOrders(accountId)]);
      const availableCash = sandboxFlatCashNano(positions, accountId);
      assertNoActiveSandboxStops(stops); assertNoSandboxOrders(orders);
      const result = assessLivePilotRisk(this.config.livePilot, { ...scenario.input, lots, commissionRate: this.config.commissionRate,
        slippageRate: Math.max(this.config.scanner.slippageRate, scenario.input.slippageRate),
        availableCashRub: Number(availableCash / 10_000_000n) / 100,
        reservedDailyRiskRub: 0, realizedDailyLossRub: 0, markedOpenLossRub: 0 });
      if (!result.allowed) throw new Error();
    } catch { throw new Error('Sandbox account, cash or protective preflight is not confirmed; no entry was sent'); }
  }

  async protect(accountId: string, scenarioId: number, now = new Date()) {
    this.enabled();
    const pending = this.inFlight.get(scenarioId);
    if (pending) {
      if (pending.accountId !== accountId) throw new Error('Sandbox protective account does not match the pending intent');
      return pending.result;
    }
    const result = this.protectGuarded(accountId, scenarioId, now);
    this.inFlight.set(scenarioId, { accountId, result });
    try { return await result; } finally { this.inFlight.delete(scenarioId); }
  }

  private async protectGuarded(accountId: string, scenarioId: number, now: Date) {
    try {
      const order = this.journal.getExecutionByScenario(scenarioId); const scenario = this.journal.getScenario(scenarioId);
      if (!order || !scenario || order.mode !== 'sandbox' || order.side !== 'long' || order.status !== 'accepted' || !order.approvedByChatId) throw new Error();
      const persisted = this.journal.getNativeStop(scenarioId);
      if (persisted) return await this.verify(accountId, persisted, now);
      const entry = parseSandboxOrderState(await this.client.getSandboxOrderState(accountId, order.orderRequestId), {
        requestId: order.orderRequestId, instrumentId: order.instrumentId, lots: order.lots, lotSize: scenario.input.lotSize,
      }, now);
      if (!entry.terminal || entry.lotsExecuted === 0) throw new Error();
      this.journal.recordExecutionReconciliation(scenarioId, entry);
      const [positions, stops, orders] = await Promise.all([this.client.getSandboxPositions(accountId),
        this.client.getSandboxStopOrders(accountId), this.client.getSandboxOrders(accountId)]);
      assertSandboxPosition(positions, accountId, order.instrumentId, BigInt(entry.lotsExecuted) * BigInt(scenario.input.lotSize));
      assertNoActiveSandboxStops(stops); assertNoSandboxOrders(orders);
      const stopNano = decimalPriceNano(scenario.input.stopPrice);
      const claim = this.journal.claimNativeStop({ scenarioId, accountId, requestId: randomUUID(), instrumentId: order.instrumentId,
        entryRequestId: order.orderRequestId, lots: entry.lotsExecuted, stopNano, limitNano: stopNano,
        createdAt: now.toISOString(), brokerStopId: null });
      if (!claim.claimed) return await this.verify(accountId, claim.record, now);
      const intent = claim.record.intent;
      const brokerId = await this.client.postSandboxStopLimit({ mode: 'sandbox', accountId, instrumentId: intent.instrumentId,
        requestId: intent.requestId, lots: intent.lots, stopNano: intent.stopNano, limitNano: intent.limitNano });
      this.journal.acknowledgeNativeStop(scenarioId, intent.requestId, brokerId);
      return await this.verify(accountId, this.journal.getNativeStop(scenarioId)!, now);
    } catch {
      this.journal.setExecutionKilled(true);
      throw new Error('Sandbox protection is not confirmed; entry risk remains reserved, new entries are killed, and no stop is retried');
    }
  }

  private async verify(accountId: string, record: NativeStopRecord, now: Date) {
    if (record.intent.accountId !== accountId || !record.intent.brokerStopId) throw new Error();
    const entry = this.journal.getExecutionSnapshot(record.intent.scenarioId);
    const scenario = this.journal.getScenario(record.intent.scenarioId);
    if (!entry?.terminal || entry.lotsExecuted !== record.intent.lots || !scenario) throw new Error();
    const observation = parseSandboxStop(await this.client.getSandboxStopOrders(accountId), record.intent, now);
    if (observation.status === 'STOP_ORDER_STATUS_ACTIVE') {
      assertSandboxPosition(await this.client.getSandboxPositions(accountId), accountId, record.intent.instrumentId,
        BigInt(record.intent.lots) * BigInt(scenario.input.lotSize));
    }
    this.journal.observeNativeStop(record.intent.scenarioId, observation);
    if (observation.status !== 'STOP_ORDER_STATUS_ACTIVE') this.journal.setExecutionKilled(true);
    // Executed STOP means a child order was CREATED, not that the position is flat.
    return { status: observation.status, lots: record.intent.lots, positionClosed: false as const };
  }
}

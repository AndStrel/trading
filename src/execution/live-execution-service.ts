import { randomUUID } from 'node:crypto';

import type { AppConfig } from '../config.js';
import { quotationToNumber, type Quotation } from '../domain/money.js';
import {
  type ExecutionOrderRecord,
  type JournalScenarioRecord,
  ScenarioJournal,
} from '../journal/scenario-journal.js';
import { getStrategyDescriptor, isTradingStrategyId } from '../strategies/catalog.js';
import { strategyEntryWindow } from '../strategies/entry-window.js';
import { assertScenarioSelection } from '../strategies/selection.js';
import type { TInvestClient } from '../tbank/client.js';
import type { LiveOrderClient } from './live-order-client.js';
import type { LivePilotPreflight } from './live-pilot-preflight.js';
import { assessLivePilotRisk } from './live-pilot-risk.js';
import { parseSandboxOrderState } from './sandbox-order-state.js';
import { decimalPriceNano } from './sandbox-stop-state.js';
import { TInvestOrderError } from './tinvest-order-client.js';

type UnknownRecord = Record<string, unknown>;

export type LiveSubmitResult = {
  order: ExecutionOrderRecord;
  executionStatus: string;
  lotsExecuted: number;
};

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function moscowDayRange(now: Date): { from: string; to: string } {
  const moscowOffsetMs = 3 * 60 * 60 * 1_000;
  const shifted = new Date(now.getTime() + moscowOffsetMs);
  const startUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - moscowOffsetMs;
  return {
    from: new Date(startUtc).toISOString(),
    to: new Date(startUtc + 24 * 60 * 60 * 1_000).toISOString(),
  };
}

function bestPrice(payload: unknown, side: 'bids' | 'asks'): { price: number; quantity: number } | null {
  const levels = asRecord(payload)?.[side];
  if (!Array.isArray(levels)) return null;
  const parsed = levels.flatMap((level) => {
    const record = asRecord(level);
    const price = quotationToNumber(record?.price as Quotation | undefined);
    const quantity = finiteNumber(record?.quantity);
    return price !== null && price > 0 && quantity !== null && quantity >= 0 ? [{ price, quantity }] : [];
  });
  if (parsed.length === 0) return null;
  return parsed.reduce((best, current) => side === 'bids'
    ? (current.price > best.price ? current : best)
    : (current.price < best.price ? current : best));
}

export class LiveExecutionService {
  private readonly inFlight = new Set<number>();

  constructor(
    private readonly config: AppConfig,
    private readonly marketClient: Pick<TInvestClient, 'getOrderBook' | 'getTradingStatus'>,
    private readonly orderClient: Pick<LiveOrderClient, 'postLimitOrder' | 'getOrderState' | 'postStopLimit'>,
    private readonly preflight: Pick<LivePilotPreflight, 'check'>,
    private readonly journal: ScenarioJournal,
  ) {}

  mode(): string {
    return this.config.execution.mode;
  }

  isConfigured(): boolean {
    return this.config.execution.mode === 'live'
      && Boolean(this.config.execution.token)
      && this.config.execution.token !== this.config.token;
  }

  isReady(): boolean {
    return this.isConfigured() && Boolean(this.config.execution.accountId);
  }

  isKilled(): boolean {
    return this.journal.isExecutionKilled();
  }

  kill(): void {
    this.journal.setExecutionKilled(true);
  }

  async armSandbox(): Promise<void> {
    throw new Error('Для реального счёта отправьте /execution_arm LIVE');
  }

  async armLive(): Promise<void> {
    const generation = this.journal.beginSandboxArming();
    let reasons: string[] = [];
    let recovery = false;
    try {
      if (!this.isReady() || !this.config.execution.accountId) throw new Error('Live execution is not configured');
      if (this.journal.listRecoverableLiveOrders(1).length) {
        recovery = true;
        throw new Error('Live recovery is required before arming');
      }
      const report = await this.preflight.check();
      reasons = report.blockers.filter(item => !item.startsWith('Проверка не отправляет'));
      if (!report.accountChecksPassed) throw new Error('Live account checks failed');
      this.journal.finishLiveArming(generation, this.config.execution.accountId);
    } catch {
      this.kill();
      const detail = recovery
        ? ' Сначала /reconcile по заявке без подтверждённого исхода.'
        : reasons.length ? ` ${reasons.join(' ')}` : '';
      throw new Error(`Реальный счёт не включён: проверка не пройдена, kill switch остаётся включённым.${detail}`);
    }
  }

  queueScenario(scenario: JournalScenarioRecord): ExecutionOrderRecord | null {
    if (this.config.execution.mode !== 'live') return null;
    if (!this.isConfigured()) throw new Error('Live execution is enabled but its isolated credential is missing');
    if (scenario.decision !== 'candidate' || scenario.strategy !== 'intraday') {
      throw new Error('Only recorded intraday candidates can be queued');
    }
    if (scenario.input.side !== 'long') throw new Error('Short execution is disabled');
    assertScenarioSelection(this.journal, scenario);
    const plan = this.plan(scenario);
    return this.journal.queueExecution({
      scenarioId: scenario.id,
      mode: 'live',
      instrumentId: scenario.instrumentId,
      side: 'long',
      lots: plan.lots,
      limitPrice: scenario.input.entryPrice,
      estimatedRiskRub: plan.totalRiskRub,
      orderRequestId: randomUUID(),
    });
  }

  rejectScenario(scenarioId: number, chatId: string): ExecutionOrderRecord {
    return this.journal.rejectExecution(scenarioId, chatId);
  }

  listRecent(limit = 5): ExecutionOrderRecord[] {
    return this.journal.listExecutionOrders(limit);
  }

  async submitScenario(scenarioId: number, chatId: string, now = new Date()): Promise<LiveSubmitResult> {
    if (this.inFlight.has(scenarioId)) throw new Error('This scenario is already being submitted');
    this.inFlight.add(scenarioId);
    try {
      return await this.submitGuarded(scenarioId, chatId, now);
    } finally {
      this.inFlight.delete(scenarioId);
    }
  }

  async reconcileScenario(scenarioId: number, now = new Date()): Promise<LiveSubmitResult> {
    if (!this.isReady() || !this.config.execution.accountId) throw new Error('Live execution is not configured');
    const order = this.journal.getExecutionByScenario(scenarioId);
    const scenario = this.journal.getScenario(scenarioId);
    if (!order || order.mode !== 'live' || !scenario || !['submitting', 'accepted'].includes(order.status)) {
      throw new Error('Only an unresolved or accepted live order can be reconciled');
    }
    let snapshot;
    let updated;
    try {
      const payload = await this.orderClient.getOrderState(this.config.execution.accountId, order.orderRequestId);
      snapshot = parseSandboxOrderState(payload, {
        requestId: order.orderRequestId, instrumentId: order.instrumentId, lots: order.lots, lotSize: scenario.input.lotSize,
      }, now);
      updated = this.journal.recordExecutionReconciliation(scenarioId, snapshot);
    } catch {
      this.journal.recordExecutionUncertain(scenarioId, 'Live reconciliation did not confirm the result; prior risk remains reserved');
      throw new Error('Сверка реальной заявки не завершена. Новая заявка не отправлялась, резерв сохранён.');
    }
    if (snapshot.lotsExecuted > 0) await this.protect(scenario, snapshot.lotsExecuted);
    return { order: updated, executionStatus: snapshot.executionStatus, lotsExecuted: snapshot.lotsExecuted };
  }

  async recoverOutstanding(limit = 20, now = new Date()) {
    if (!this.isReady()) throw new Error('Live execution is not configured');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid reconciliation batch size');
    const orders = this.journal.listRecoverableLiveOrders(limit + 1);
    let confirmed = 0;
    let unconfirmed = 0;
    for (const order of orders.slice(0, limit)) {
      try { await this.reconcileScenario(order.scenarioId, now); confirmed++; }
      catch { unconfirmed++; }
    }
    return { attempted: confirmed + unconfirmed, confirmed, unconfirmed, morePending: orders.length > limit };
  }

  private async submitGuarded(scenarioId: number, chatId: string, now: Date): Promise<LiveSubmitResult> {
    if (!this.isReady() || !this.config.execution.accountId) throw new Error('Live execution is not configured');
    const existing = this.journal.getExecutionByScenario(scenarioId);
    if (existing?.status === 'submitting') return this.reconcileScenario(scenarioId, now);
    if (this.isKilled()) throw new Error('Execution kill switch is active');
    const scenario = this.journal.getScenario(scenarioId);
    if (!scenario || scenario.decision !== 'candidate' || scenario.strategy !== 'intraday' || scenario.input.side !== 'long') {
      throw new Error('A recorded long intraday candidate was not found');
    }
    const ageMs = now.getTime() - new Date(scenario.observedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > this.config.execution.candidateMaxAgeMinutes * 60_000) {
      throw new Error(`Candidate is older than ${this.config.execution.candidateMaxAgeMinutes} minutes`);
    }
    this.assertScannerEntryWindow(scenario, now);
    const selectionProof = assertScenarioSelection(this.journal, scenario);
    const plan = this.plan(scenario);
    const queued = existing ?? this.queueScenario(scenario);
    if (!queued) throw new Error('Execution order was not queued');
    if (queued.estimatedRiskRub < plan.totalRiskRub) throw new Error('Queued order has outdated expense assumptions; create a fresh candidate');
    const day = moscowDayRange(now);
    const usage = this.journal.getExecutionDailyUsage(day.from, day.to);
    if (queued.status === 'pending') {
      if (usage.orderCount >= this.config.execution.maxOrdersPerDay) throw new Error('Daily execution order limit has been reached');
      if (usage.riskRub + plan.totalRiskRub > this.config.execution.maxDailyRiskRub) throw new Error('Daily execution risk limit would be exceeded');
    }
    await this.validateCurrentMarket(scenario, plan.lots);
    const report = await this.preflight.check();
    if (!report.accountChecksPassed) throw new Error('Live account checks failed; no order was sent');
    if (this.isKilled()) throw new Error('Execution kill switch is active');
    const claimed = this.journal.claimExecution(scenarioId, chatId, {
      ...day, now: now.toISOString(), maxOrders: this.config.execution.maxOrdersPerDay,
      maxRiskRub: this.config.execution.maxDailyRiskRub, singlePosition: true,
      liveAccountId: this.config.execution.accountId,
      ...(selectionProof ? { tradingSelection: selectionProof } : {}),
    });
    let response;
    try {
      response = await this.orderClient.postLimitOrder({
        mode: 'live',
        accountId: this.config.execution.accountId,
        instrumentId: claimed.instrumentId,
        lots: claimed.lots,
        limitPrice: claimed.limitPrice,
        direction: 'buy',
        orderRequestId: claimed.orderRequestId,
      });
    } catch (error: unknown) {
      if (error instanceof TInvestOrderError && !error.outcomeUncertain) {
        this.journal.markExecutionFailed(scenarioId, 'Live request failed before submission');
      } else {
        this.journal.recordExecutionUncertain(scenarioId, 'Live submission did not confirm the outcome; risk remains reserved');
      }
      throw new Error('Реальная заявка не подтверждена. Повторите /reconcile, а не новую отправку.');
    }
    const knownStatuses = ['EXECUTION_REPORT_STATUS_FILL', 'EXECUTION_REPORT_STATUS_PARTIALLYFILL',
      'EXECUTION_REPORT_STATUS_NEW', 'EXECUTION_REPORT_STATUS_REJECTED', 'EXECUTION_REPORT_STATUS_CANCELLED'];
    if (!knownStatuses.includes(response.executionStatus)
      || response.lotsRequested !== claimed.lots || response.lotsExecuted < 0 || response.lotsExecuted > claimed.lots
      || (response.executionStatus === 'EXECUTION_REPORT_STATUS_FILL' && response.lotsExecuted !== claimed.lots)
      || (response.executionStatus === 'EXECUTION_REPORT_STATUS_NEW' && response.lotsExecuted !== 0)) {
      this.journal.recordExecutionUncertain(scenarioId, 'Unconfirmed broker execution status');
      throw new TInvestOrderError('Unconfirmed broker execution status; risk remains reserved', true);
    }
    if (response.lotsExecuted === 0 && (
      response.executionStatus === 'EXECUTION_REPORT_STATUS_REJECTED'
      || response.executionStatus === 'EXECUTION_REPORT_STATUS_CANCELLED'
    )) {
      const failed = this.journal.markExecutionFailed(scenarioId, response.executionStatus);
      return { order: failed, executionStatus: response.executionStatus, lotsExecuted: 0 };
    }
    const accepted = this.journal.markExecutionAccepted(
      scenarioId, response.brokerOrderId,
      `${response.executionStatus}; lots ${response.lotsExecuted}/${response.lotsRequested}`,
      response.lotsExecuted,
    );
    if (response.lotsExecuted > 0) await this.protect(scenario, response.lotsExecuted);
    return { order: accepted, executionStatus: response.executionStatus, lotsExecuted: response.lotsExecuted };
  }

  private async protect(scenario: JournalScenarioRecord, lots: number): Promise<void> {
    const accountId = this.config.execution.accountId;
    const unconfirmed = 'Покупка могла исполниться, защитный стоп не подтверждён. Новые заявки заблокированы. Повторный /approve не создаёт вторую покупку.';
    if (!accountId) {
      this.kill();
      throw new Error(unconfirmed);
    }
    if (this.journal.getRuntimeState(this.stopKey(scenario.id))) return;
    const requestId = randomUUID();
    if (!this.journal.compareAndSetRuntimeState(this.pendingStopKey(scenario.id), null, requestId)) {
      if (this.journal.getRuntimeState(this.stopKey(scenario.id))) return;
      this.kill();
      throw new Error(unconfirmed);
    }
    try {
      const stopNano = decimalPriceNano(scenario.input.stopPrice);
      const brokerId = await this.orderClient.postStopLimit({
        mode: 'live', accountId, instrumentId: scenario.instrumentId, requestId, lots, stopNano, limitNano: stopNano,
      });
      this.journal.setRuntimeState(this.stopKey(scenario.id), brokerId);
    } catch {
      this.kill();
      throw new Error('Покупка могла исполниться, защитный стоп не подтверждён. Новые заявки заблокированы. Повторный /approve не создаёт вторую покупку.');
    }
  }

  private stopKey(scenarioId: number): string {
    return `execution.live_stop.${scenarioId}`;
  }

  private pendingStopKey(scenarioId: number): string {
    return `execution.live_stop_pending.${scenarioId}`;
  }

  private plan(scenario: JournalScenarioRecord): { lots: number; totalRiskRub: number; positionRub: number } {
    const snapshot = asRecord(scenario.snapshot);
    const tradePlan = asRecord(snapshot?.tradePlan);
    const lots = positiveInteger(tradePlan?.lots);
    if (!lots) throw new Error('Scenario does not contain a valid deterministic trade plan');
    const assessment = assessLivePilotRisk(this.config.livePilot, {
      side: 'long',
      entryPrice: scenario.input.entryPrice,
      stopPrice: scenario.input.stopPrice,
      targetPrice: scenario.input.targetPrice,
      lots,
      lotSize: scenario.input.lotSize,
      commissionRate: this.config.commissionRate,
      slippageRate: Math.max(this.config.scanner.slippageRate, scenario.input.slippageRate),
      availableCashRub: this.config.livePilot.capitalRub,
      reservedDailyRiskRub: 0,
      realizedDailyLossRub: 0,
      markedOpenLossRub: 0,
    });
    if (!assessment.allowed) throw new Error(assessment.blockers[0] ?? 'Live pilot rejected the order');
    const limits = this.config.strategies.intraday;
    if (assessment.positionRub > limits.maxPositionRub) throw new Error('Scenario exceeds the position limit');
    if (assessment.totalRiskRub > limits.maxRiskRub) throw new Error('Scenario exceeds the risk limit');
    return { lots, totalRiskRub: assessment.totalRiskRub, positionRub: assessment.positionRub };
  }

  private assertScannerEntryWindow(scenario: JournalScenarioRecord, now: Date): void {
    const snapshot = asRecord(scenario.snapshot);
    if (snapshot?.source !== 'intraday-scanner' || snapshot.tradingStrategy === undefined) return;
    const strategy = asRecord(snapshot.tradingStrategy);
    if (!isTradingStrategyId(strategy?.id) || strategy.version !== getStrategyDescriptor(strategy.id).version
      || typeof strategy.referenceStartMinutes !== 'number') throw new Error('Original scanner strategy entry window is not confirmed');
    const original = strategyEntryWindow(strategy.id, strategy.referenceStartMinutes, new Date(scenario.observedAt));
    const current = strategyEntryWindow(strategy.id, this.config.scanner.sessionStartMinutes, now);
    if (!original || !current || now.getTime() < Math.max(original.entryStartMs, current.entryStartMs)
      || now.getTime() >= Math.min(original.entryEndMs, current.entryEndMs)) {
      throw new Error('Versioned scanner entry window is closed; regenerate the candidate');
    }
  }

  private async validateCurrentMarket(scenario: JournalScenarioRecord, lots: number): Promise<void> {
    const [orderBookPayload, statusPayload] = await Promise.all([
      this.marketClient.getOrderBook(scenario.instrumentId, 20),
      this.marketClient.getTradingStatus(scenario.instrumentId),
    ]);
    const bid = bestPrice(orderBookPayload, 'bids');
    const ask = bestPrice(orderBookPayload, 'asks');
    const status = asRecord(statusPayload);
    const apiAvailable = status?.apiTradeAvailableFlag ?? status?.apiTradeAvailable;
    const limitAvailable = status?.limitOrderAvailableFlag ?? status?.limitOrderAvailable;
    if (status?.tradingStatus !== 'SECURITY_TRADING_STATUS_NORMAL_TRADING') throw new Error('Instrument is not in normal trading status');
    if (apiAvailable !== true || limitAvailable !== true) throw new Error('API limit-order availability is not confirmed');
    if (!bid || !ask || ask.price < bid.price) throw new Error('A valid bid/ask spread is unavailable');
    if (ask.quantity < lots) throw new Error('Best ask does not contain enough lots');
    const spreadPct = ((ask.price - bid.price) / ((ask.price + bid.price) / 2)) * 100;
    if (spreadPct > this.config.strategies.intraday.maxSpreadPct) throw new Error('Current spread exceeds the intraday limit');
    const entryDeviationPct = (Math.abs(scenario.input.entryPrice - ask.price) / ask.price) * 100;
    if (entryDeviationPct > this.config.strategies.intraday.maxEntryDeviationPct) throw new Error('Current best ask moved too far from the planned entry');
  }
}

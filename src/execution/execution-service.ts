import { randomUUID } from 'node:crypto';

import type { AppConfig } from '../config.js';
import { quotationToNumber, type Quotation } from '../domain/money.js';
import {
  type ExecutionOrderRecord,
  type JournalScenarioRecord,
  ScenarioJournal,
  SandboxPreparationChangedError,
} from '../journal/scenario-journal.js';
import type { TInvestClient } from '../tbank/client.js';
import { TInvestOrderClient, TInvestOrderError } from './tinvest-order-client.js';
import { assessLivePilotRisk } from './live-pilot-risk.js';
import { parseSandboxOrderState } from './sandbox-order-state.js';
import type { SandboxProtectionService } from './sandbox-protection-service.js';
import type { SandboxExitService } from './sandbox-exit-service.js';
import type { SandboxLossGuard } from './sandbox-loss-guard.js';
import { sandboxBidValue } from './sandbox-loss-policy.js';
import type { SandboxSessionClose } from './sandbox-session-close.js';
import { sandboxSessionEntryAllowed } from './sandbox-session-policy.js';
import { decimalPriceNano } from './sandbox-stop-state.js';
import { assertSandboxInstrument } from './sandbox-instrument.js';
import { assertNoSandboxOrders, sandboxFlatCashNano } from './sandbox-flat-account.js';
import { readPreparedSandbox, sandboxAccountKey, sandboxBootstrapKey, sandboxEndpoint } from './sandbox-prepared-account.js';

type UnknownRecord = Record<string, unknown>;

type TradePlanSnapshot = {
  lots: number;
  positionRub: number;
  totalRiskRub: number;
};

export type ExecutionSubmitResult = {
  order: ExecutionOrderRecord;
  executionStatus: string;
  lotsExecuted: number;
  sandboxExit?: Awaited<ReturnType<SandboxExitService['reconcile']>>;
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

function readTradePlan(scenario: JournalScenarioRecord): TradePlanSnapshot {
  const snapshot = asRecord(scenario.snapshot);
  const plan = asRecord(snapshot?.tradePlan);
  const lots = positiveInteger(plan?.lots);
  const positionRub = finiteNumber(plan?.positionRub);
  const totalRiskRub = finiteNumber(plan?.totalRiskRub);
  if (!lots || positionRub === null || positionRub <= 0 || totalRiskRub === null || totalRiskRub <= 0) {
    throw new Error('Scenario does not contain a valid deterministic trade plan');
  }
  return { lots, positionRub, totalRiskRub };
}

function bestPrice(payload: unknown, side: 'bids' | 'asks'): { price: number; quantity: number } | null {
  const levels = asRecord(payload)?.[side];
  if (!Array.isArray(levels)) return null;
  const parsed = levels.flatMap((level) => {
    const record = asRecord(level);
    const price = quotationToNumber(record?.price as Quotation | undefined);
    const quantity = finiteNumber(record?.quantity);
    return price !== null && price > 0 && quantity !== null && quantity >= 0
      ? [{ price, quantity }]
      : [];
  });
  if (parsed.length === 0) return null;
  return parsed.reduce((best, current) => {
    if (side === 'bids') return current.price > best.price ? current : best;
    return current.price < best.price ? current : best;
  });
}

function moscowDayRange(now: Date): { from: string; to: string } {
  const moscowOffsetMs = 3 * 60 * 60 * 1_000;
  const shifted = new Date(now.getTime() + moscowOffsetMs);
  const startUtc =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - moscowOffsetMs;
  return {
    from: new Date(startUtc).toISOString(),
    to: new Date(startUtc + 24 * 60 * 60 * 1_000).toISOString(),
  };
}

export class ExecutionService {
  private accountId: string | undefined;
  private readonly inFlight = new Set<number>();

  constructor(
    private readonly config: AppConfig,
    private readonly marketClient: Pick<TInvestClient, 'getOrderBook' | 'getTradingStatus'> & Partial<Pick<TInvestClient,'getInstrumentBy'>>,
    private readonly orderClient: Pick<
      TInvestOrderClient,
      'postLimitOrder' | 'getSandboxAccounts' | 'getSandboxPositions' | 'getSandboxOrders' | 'getSandboxStopOrders' | 'getSandboxOrderState'
    >,
    private readonly journal: ScenarioJournal,
    private readonly protection?: Pick<SandboxProtectionService, 'protect' | 'preflightForEntry'>,
    private readonly exitReconciler?: Pick<SandboxExitService, 'reconcile'>,
    private readonly lossGuard?: Pick<SandboxLossGuard, 'assess'>,
    private readonly sessionClose?: Pick<SandboxSessionClose, 'advance'>,
  ) {
    this.accountId =
      config.execution.accountId ?? journal.getRuntimeState('execution.sandbox_account_id') ?? undefined;
  }

  mode(): string {
    return this.config.execution.mode;
  }

  isConfigured(): boolean {
    return this.config.execution.mode === 'sandbox' && Boolean(this.config.execution.token);
  }

  isReady(): boolean {
    return this.isConfigured() && Boolean(this.accountId);
  }

  isKilled(): boolean {
    return this.journal.isExecutionKilled();
  }

  async armSandbox(): Promise<void> {
    // Pin kill before any asynchronous read. A later safety kill must never be
    // overwritten, even if it sets the same boolean in the same millisecond.
    const generation = this.journal.beginSandboxArming();
    try {
      const start = Date.now();
      const snapshot = this.preparedSnapshot();
      if (this.journal.listRecoverableExecutionOrders(1).length) throw new Error('Sandbox recovery is required before arming');
      const accounts = await this.orderClient.getSandboxAccounts();
      if (accounts.length !== 1 || accounts[0]?.id !== snapshot.accountId
        || (accounts[0].name !== null && accounts[0].name !== snapshot.name)) throw new Error('Sandbox account ownership is not confirmed');
      const orders = await this.orderClient.getSandboxOrders(snapshot.accountId);
      const stops = await this.orderClient.getSandboxStopOrders(snapshot.accountId);
      const positions = await this.orderClient.getSandboxPositions(snapshot.accountId);
      assertNoSandboxOrders(orders);
      const stopOrders = asRecord(stops)?.stopOrders;
      if (!Array.isArray(stopOrders) || stopOrders.length) throw new Error('Empty sandbox stop book is not confirmed');
      // This is initial arming only. Never refill cash to erase previous losses.
      if (sandboxFlatCashNano(positions, snapshot.accountId) !== BigInt(decimalPriceNano(this.config.execution.sandboxInitialBalanceRub))) {
        throw new Error('Initial sandbox cash is not confirmed; automatic funding is disabled');
      }
      const elapsed = Date.now() - start;
      if (elapsed < 0 || elapsed > 30_000) throw new Error('Sandbox arming reads are stale');
      this.journal.finishSandboxArming(generation, snapshot);
      this.accountId = snapshot.accountId;
    } catch {
      this.kill();
      // Never forward broker payloads/account identifiers to Telegram or logs.
      throw new Error('Sandbox arming is not confirmed; separate preparation or recovery is required and execution remains killed');
    }
  }

  kill(): void {
    this.journal.setExecutionKilled(true);
  }

  queueScenario(scenario: JournalScenarioRecord): ExecutionOrderRecord | null {
    if (this.config.execution.mode === 'disabled') return null;
    if (!this.isConfigured()) throw new Error('Sandbox execution is enabled but T_INVEST_TRADING_TOKEN is missing');
    if (scenario.decision !== 'candidate' || scenario.strategy !== 'intraday') {
      throw new Error('Only recorded intraday candidates can be queued');
    }
    if (scenario.input.side !== 'long') throw new Error('Short execution is disabled');
    this.assertSessionMetadata(scenario);

    const plan = this.readValidatedPlan(scenario);
    const limits = this.config.strategies.intraday;
    if (plan.positionRub > limits.maxPositionRub) throw new Error('Scenario exceeds the position limit');
    if (plan.totalRiskRub > limits.maxRiskRub) throw new Error('Scenario exceeds the risk limit');

    return this.journal.queueExecution({
      scenarioId: scenario.id,
      mode: this.config.execution.mode,
      instrumentId: scenario.instrumentId,
      side: scenario.input.side,
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

  async submitScenario(scenarioId: number, chatId: string, now = new Date()): Promise<ExecutionSubmitResult> {
    if (this.inFlight.has(scenarioId)) throw new Error('This scenario is already being submitted');
    this.inFlight.add(scenarioId);
    try {
      return await this.submitGuarded(scenarioId, chatId, now);
    } finally {
      this.inFlight.delete(scenarioId);
    }
  }

  private async submitGuarded(scenarioId: number, chatId: string, now: Date): Promise<ExecutionSubmitResult> {
    if (!this.isReady()) throw new Error('Sandbox execution is disabled, unarmed or not fully configured');
    // An earlier HTTP timeout is NOT permission to send again. Reading state
    // remains possible after kill, restart or candidate expiry.
    if (this.journal.getExecutionByScenario(scenarioId)?.status === 'submitting') {
      return this.reconcileScenario(scenarioId, now);
    }
    if (this.isKilled()) throw new Error('Execution kill switch is active');
    const killGeneration = this.journal.getRuntimeState('execution.kill_generation');
    let prepared;
    try { prepared = this.preparedSnapshot(); }
    catch { this.kill(); throw new Error('Separately prepared sandbox account is not confirmed; no new order was sent'); }
    if (this.config.execution.sandboxSessionCloseEnabled && (!this.sessionClose || !this.config.execution.sandboxProtectionEnabled
      || !this.config.execution.sandboxLossGuardEnabled || !sandboxSessionEntryAllowed(now))) {
      throw new Error('Sandbox session entry window or closing protection is not confirmed');
    }

    const scenario = this.journal.getScenario(scenarioId);
    if (!scenario || scenario.decision !== 'candidate' || scenario.strategy !== 'intraday') {
      throw new Error('A recorded intraday candidate was not found');
    }
    if (scenario.input.side !== 'long') throw new Error('Short execution is disabled');

    const ageMs = now.getTime() - new Date(scenario.observedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > this.config.execution.candidateMaxAgeMinutes * 60_000) {
      throw new Error(`Candidate is older than ${this.config.execution.candidateMaxAgeMinutes} minutes`);
    }

    const plan = this.readValidatedPlan(scenario);
    this.assertStrategyLimits(plan);
    this.assertSessionMetadata(scenario);
    const existing = this.journal.getExecutionByScenario(scenarioId) ?? this.queueScenario(scenario);
    if (!existing) throw new Error('Execution order was not queued');
    if (existing.estimatedRiskRub < plan.totalRiskRub) {
      throw new Error('Queued order has outdated expense assumptions; create a fresh candidate');
    }

    const day = moscowDayRange(now);
    const usage = this.journal.getExecutionDailyUsage(day.from, day.to);
    if (existing.status === 'pending') {
      if (usage.orderCount >= this.config.execution.maxOrdersPerDay) {
        throw new Error('Daily execution order limit has been reached');
      }
      if (usage.riskRub + plan.totalRiskRub > this.config.execution.maxDailyRiskRub) {
        throw new Error('Daily execution risk limit would be exceeded');
      }
    }

    await this.validateCurrentMarket(scenario, plan.lots);
    if (this.config.execution.sandboxProtectionEnabled) {
      if (!this.protection) throw new Error('Sandbox protective module is not connected; no entry was sent');
      await this.protection.preflightForEntry(this.accountId!, scenario, plan.lots);
    }
    let lossProof;
    if (this.config.execution.sandboxLossGuardEnabled) {
      if (!this.lossGuard) throw new Error('Sandbox loss guard is not connected; no entry was sent');
      lossProof = await this.lossGuard.assess(this.accountId!);
      if (lossProof.status !== 'ok') throw new Error('Sandbox loss allowance is not confirmed; no entry was sent');
      await this.validateCurrentMarket(scenario, plan.lots);
    }
    const claimNow = lossProof ? new Date() : now;
    if (lossProof) {
      const finalAge = claimNow.getTime() - Date.parse(scenario.observedAt);
      if (finalAge < 0 || finalAge > this.config.execution.candidateMaxAgeMinutes * 60_000) throw new Error('Candidate expired during sandbox loss preflight');
    }
    if (this.isKilled()) throw new Error('Execution kill switch is active');
    if (this.config.execution.sandboxSessionCloseEnabled && !sandboxSessionEntryAllowed(claimNow)) {
      throw new Error('Sandbox entry window ended during preflight');
    }
    let claimed: ExecutionOrderRecord;
    try {
      claimed = this.journal.claimExecution(scenarioId, chatId, {
        ...(lossProof ? moscowDayRange(claimNow) : day), now: claimNow.toISOString(), maxOrders: this.config.execution.maxOrdersPerDay,
        maxRiskRub: this.config.execution.maxDailyRiskRub,
        singlePosition: this.config.livePilot.prepare,
        preparedSandbox: { ...prepared, generation: killGeneration },
        ...(lossProof ? { lossGuard: { proofId: lossProof.proofId, accountId: this.accountId!,
          maxDailyLossRub: this.config.livePilot.maxDailyLossRub, maxTradeLossRub: this.config.livePilot.maxTradeRiskRub } } : {}),
      });
    } catch (error) {
      if (error instanceof SandboxPreparationChangedError) this.kill();
      throw error;
    }

    let response;
    try {
      response = await this.orderClient.postLimitOrder({
        mode: 'sandbox',
        accountId: this.accountId!,
        instrumentId: claimed.instrumentId,
        lots: claimed.lots,
        limitPrice: claimed.limitPrice,
        direction: claimed.side === 'long' ? 'buy' : 'sell',
        orderRequestId: claimed.orderRequestId,
      });
    } catch (error: unknown) {
      if (error instanceof TInvestOrderError && !error.outcomeUncertain) {
        this.journal.markExecutionFailed(scenarioId, 'Sandbox request failed before submission');
      } else {
        this.journal.recordExecutionUncertain(scenarioId, 'Sandbox submission did not confirm the outcome; risk remains reserved');
      }
      throw new Error('Sandbox submission did not confirm the outcome; use reconciliation before any retry');
    }

    const knownStatuses = ['EXECUTION_REPORT_STATUS_FILL', 'EXECUTION_REPORT_STATUS_PARTIALLYFILL',
      'EXECUTION_REPORT_STATUS_NEW', 'EXECUTION_REPORT_STATUS_REJECTED', 'EXECUTION_REPORT_STATUS_CANCELLED'];
    if (!knownStatuses.includes(response.executionStatus)
      || !Number.isSafeInteger(response.lotsExecuted) || response.lotsExecuted < 0 || response.lotsExecuted > claimed.lots
      || response.lotsRequested !== claimed.lots
      || (response.executionStatus === 'EXECUTION_REPORT_STATUS_FILL' && response.lotsExecuted !== claimed.lots)
      || (response.executionStatus === 'EXECUTION_REPORT_STATUS_NEW' && response.lotsExecuted !== 0)
      || (response.executionStatus === 'EXECUTION_REPORT_STATUS_PARTIALLYFILL'
        && (response.lotsExecuted === 0 || response.lotsExecuted === claimed.lots))) {
      this.journal.recordExecutionUncertain(scenarioId, 'Unconfirmed broker execution status');
      throw new TInvestOrderError('Unconfirmed broker execution status; risk remains reserved', true);
    }
    if (response.lotsExecuted === 0 && (
      response.executionStatus === 'EXECUTION_REPORT_STATUS_REJECTED' ||
      response.executionStatus === 'EXECUTION_REPORT_STATUS_CANCELLED'
    )) {
      const failed = this.journal.markExecutionFailed(scenarioId, response.executionStatus);
      return { order: failed, executionStatus: response.executionStatus, lotsExecuted: response.lotsExecuted };
    }

    const accepted = this.journal.markExecutionAccepted(
      scenarioId,
      response.brokerOrderId,
      `${response.executionStatus}; lots ${response.lotsExecuted}/${response.lotsRequested}`,
      response.lotsExecuted,
    );
    if (this.config.execution.sandboxProtectionEnabled && response.lotsExecuted > 0) {
      await this.protection!.protect(this.accountId!, scenarioId, now);
    }
    return { order: accepted, executionStatus: response.executionStatus, lotsExecuted: response.lotsExecuted };
  }

  async recoverOutstanding(limit = 20, now = new Date()) {
    if (!this.isReady()) throw new Error('Sandbox execution is not configured');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid reconciliation batch size');
    const orders = this.journal.listRecoverableExecutionOrders(limit + 1);
    let confirmed = 0;
    let unconfirmed = 0;
    for (const order of orders.slice(0, limit)) {
      try { await this.reconcileScenario(order.scenarioId, now); confirmed++; }
      catch { unconfirmed++; }
    }
    return { attempted: confirmed + unconfirmed, confirmed, unconfirmed, morePending: orders.length > limit };
  }

  async protectOutstanding(now?: Date) {
    if (!this.isReady() || !this.config.execution.sandboxProtectionEnabled || !this.protection) throw new Error('Sandbox protection is not configured');
    const orders = this.journal.listRecoverableExecutionOrders(21);
    const result = { active: 0, triggered: 0, closed: 0, unconfirmed: 0, morePending: orders.length > 20 };
    for (const order of orders.slice(0, 20)) {
      if (order.status !== 'accepted') { result.unconfirmed++; continue; }
      try {
        if (this.config.execution.sandboxSessionCloseEnabled && this.journal.getNativeStop(order.scenarioId)) {
          if (!this.sessionClose) throw new Error('Sandbox session closing module is not connected');
          const closed = await this.sessionClose.advance(this.accountId!, order.scenarioId, now);
          if (closed) {
            if (closed.kind === 'native') result.triggered++;
            if (closed.complete) result.closed++; else result.unconfirmed++;
            continue;
          }
        }
        const observed = await this.protection.protect(this.accountId!, order.scenarioId, now);
        if (observed.status === 'STOP_ORDER_STATUS_ACTIVE') result.active++;
        else if (observed.status === 'STOP_ORDER_STATUS_EXECUTED') {
          result.triggered++;
          if (this.exitReconciler) {
            const exit = await this.exitReconciler.reconcile(this.accountId!, order.scenarioId, now);
            if (exit.complete) result.closed++;
            else result.unconfirmed++;
          }
        }
        else result.unconfirmed++;
      } catch { result.unconfirmed++; }
    }
    return result;
  }

  async reconcileScenario(scenarioId: number, now = new Date()): Promise<ExecutionSubmitResult> {
    if (!this.isReady()) throw new Error('Sandbox execution is not configured');
    const order = this.journal.getExecutionByScenario(scenarioId);
    const scenario = this.journal.getScenario(scenarioId);
    if (!order || order.mode !== 'sandbox' || !scenario || !['submitting', 'accepted'].includes(order.status)) {
      throw new Error('Only an unresolved or accepted sandbox order can be reconciled');
    }
    try {
      const payload = await this.orderClient.getSandboxOrderState(this.accountId!, order.orderRequestId);
      const snapshot = parseSandboxOrderState(payload, {
        requestId: order.orderRequestId, instrumentId: order.instrumentId, lots: order.lots, lotSize: scenario.input.lotSize,
      }, now);
      const updated = this.journal.recordExecutionReconciliation(scenarioId, snapshot);
      const native = this.journal.getNativeStop(scenarioId);
      const sandboxExit = this.exitReconciler && this.config.execution.sandboxProtectionEnabled
        && (native?.observation?.status === 'STOP_ORDER_STATUS_EXECUTED' || this.journal.getSandboxSessionExit(scenarioId)?.phase === 'submitted')
        ? await this.exitReconciler.reconcile(this.accountId!, scenarioId, now) : undefined;
      return { order: updated, executionStatus: snapshot.executionStatus, lotsExecuted: snapshot.lotsExecuted,
        ...(sandboxExit ? { sandboxExit } : {}) };
    } catch {
      this.journal.recordExecutionUncertain(scenarioId, 'Sandbox reconciliation did not confirm the result; prior risk remains reserved');
      throw new Error('Sandbox reconciliation is incomplete; no new order was sent and prior risk remains reserved');
    }
  }

  private preparedSnapshot() {
    if (!this.isConfigured() || this.config.execution.baseUrl !== sandboxEndpoint
      || this.config.execution.token === this.config.token || this.config.execution.token === this.config.livePilot.token) {
      throw new Error('Separately prepared sandbox configuration is not confirmed');
    }
    const raw = this.journal.getRuntimeState(sandboxBootstrapKey);
    const prepared = readPreparedSandbox(raw, this.journal.getRuntimeState(sandboxAccountKey), this.config.execution.accountId);
    if (this.accountId && this.accountId !== prepared.accountId) throw new Error('Separately prepared sandbox account changed');
    return { raw: raw!, accountId: prepared.accountId, name: prepared.name };
  }

  private assertStrategyLimits(plan: TradePlanSnapshot): void {
    const limits = this.config.strategies.intraday;
    if (plan.positionRub > limits.maxPositionRub) throw new Error('Scenario exceeds the position limit');
    if (plan.totalRiskRub > limits.maxRiskRub) throw new Error('Scenario exceeds the risk limit');
  }

  private readValidatedPlan(scenario: JournalScenarioRecord): TradePlanSnapshot {
    const plan = readTradePlan(scenario);
    if (!this.config.livePilot.prepare) return plan;
    const assessment = assessLivePilotRisk(this.config.livePilot, {
      side: scenario.input.side,
      entryPrice: scenario.input.entryPrice,
      stopPrice: scenario.input.stopPrice,
      targetPrice: scenario.input.targetPrice,
      lots: plan.lots,
      lotSize: scenario.input.lotSize,
      commissionRate: this.config.commissionRate,
      slippageRate: Math.max(this.config.scanner.slippageRate, scenario.input.slippageRate),
      availableCashRub: this.config.livePilot.capitalRub,
      reservedDailyRiskRub: 0,
      realizedDailyLossRub: 0,
      markedOpenLossRub: 0,
    });
    if (!assessment.allowed) throw new Error(assessment.blockers.join('; '));
    // Never accept a cheaper historical snapshot as the monetary source of truth.
    return { ...plan, positionRub: Math.max(plan.positionRub, assessment.positionRub), totalRiskRub: Math.max(plan.totalRiskRub, assessment.totalRiskRub) };
  }

  private async validateCurrentMarket(scenario: JournalScenarioRecord, lots: number): Promise<void> {
    const [orderBookPayload, statusPayload, instrumentPayload] = await Promise.all([
      this.marketClient.getOrderBook(scenario.instrumentId, 20),
      this.marketClient.getTradingStatus(scenario.instrumentId),
      this.config.execution.sandboxSessionCloseEnabled ? this.marketClient.getInstrumentBy?.(scenario.instrumentId) : undefined,
    ]);
    if (this.config.execution.sandboxSessionCloseEnabled) {
      const item=this.config.scanner.intradayWatchlist.find(item=>item.instrumentId===scenario.instrumentId)!;
      assertSandboxInstrument(instrumentPayload,{instrumentId:scenario.instrumentId,lotSize:scenario.input.lotSize,priceStep:item.priceStep},true);
    }
    if (this.config.execution.sandboxLossGuardEnabled) {
      sandboxBidValue(orderBookPayload, statusPayload, scenario.instrumentId, lots, scenario.input.lotSize, new Date());
    }
    const bid = bestPrice(orderBookPayload, 'bids');
    const ask = bestPrice(orderBookPayload, 'asks');
    const status = asRecord(statusPayload);
    const apiAvailable = status?.apiTradeAvailableFlag ?? status?.apiTradeAvailable;
    const limitAvailable = status?.limitOrderAvailableFlag ?? status?.limitOrderAvailable;
    if (status?.tradingStatus !== 'SECURITY_TRADING_STATUS_NORMAL_TRADING') {
      throw new Error('Instrument is not in normal trading status');
    }
    if (apiAvailable !== true || limitAvailable !== true) {
      throw new Error('API limit-order availability is not confirmed');
    }
    if (!bid || !ask || ask.price < bid.price) throw new Error('A valid bid/ask spread is unavailable');
    if (ask.quantity < lots) throw new Error('Best ask does not contain enough lots');

    const spreadPct = ((ask.price - bid.price) / ((ask.price + bid.price) / 2)) * 100;
    if (spreadPct > this.config.strategies.intraday.maxSpreadPct) {
      throw new Error('Current spread exceeds the intraday limit');
    }
    const entryDeviationPct = (Math.abs(scenario.input.entryPrice - ask.price) / ask.price) * 100;
    if (entryDeviationPct > this.config.strategies.intraday.maxEntryDeviationPct) {
      throw new Error('Current best ask moved too far from the planned entry');
    }
  }

  private assertSessionMetadata(scenario: JournalScenarioRecord): void {
    if (!this.config.execution.sandboxSessionCloseEnabled) return;
    const items = this.config.scanner.intradayWatchlist.filter(item => item.instrumentId === scenario.instrumentId);
    const item = items[0];
    if (items.length !== 1 || !item || item.lotSize !== scenario.input.lotSize
      || [scenario.input.entryPrice, scenario.input.stopPrice].some(price => BigInt(decimalPriceNano(price)) % BigInt(decimalPriceNano(item.priceStep)) !== 0n)) {
      throw new Error('Configured lot size and price tick for sandbox closing are not confirmed');
    }
  }
}

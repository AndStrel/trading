import { randomUUID } from 'node:crypto';

import type { AppConfig } from '../config.js';
import { quotationToNumber, type Quotation } from '../domain/money.js';
import {
  type ExecutionOrderRecord,
  type JournalScenarioRecord,
  ScenarioJournal,
} from '../journal/scenario-journal.js';
import type { TInvestClient } from '../tbank/client.js';
import { TInvestOrderClient, TInvestOrderError } from './tinvest-order-client.js';

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

  constructor(
    private readonly config: AppConfig,
    private readonly marketClient: Pick<TInvestClient, 'getOrderBook' | 'getTradingStatus'>,
    private readonly orderClient: Pick<
      TInvestOrderClient,
      'postLimitOrder' | 'getSandboxAccounts' | 'openSandboxAccount' | 'sandboxPayIn'
    >,
    private readonly journal: ScenarioJournal,
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
    if (!this.isConfigured()) {
      throw new Error('Sandbox execution requires T_INVEST_TRADING_TOKEN');
    }
    await this.ensureSandboxAccount();
    this.journal.setExecutionKilled(false);
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

    const plan = readTradePlan(scenario);
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
    if (!this.isReady()) throw new Error('Sandbox execution is disabled, unarmed or not fully configured');
    if (this.isKilled()) throw new Error('Execution kill switch is active');

    const scenario = this.journal.getScenario(scenarioId);
    if (!scenario || scenario.decision !== 'candidate' || scenario.strategy !== 'intraday') {
      throw new Error('A recorded intraday candidate was not found');
    }
    if (scenario.input.side !== 'long') throw new Error('Short execution is disabled');

    const ageMs = now.getTime() - new Date(scenario.observedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > this.config.execution.candidateMaxAgeMinutes * 60_000) {
      throw new Error(`Candidate is older than ${this.config.execution.candidateMaxAgeMinutes} minutes`);
    }

    const plan = readTradePlan(scenario);
    const existing = this.journal.getExecutionByScenario(scenarioId) ?? this.queueScenario(scenario);
    if (!existing) throw new Error('Execution order was not queued');

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
    const claimed = this.journal.claimExecution(scenarioId, chatId);

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
      if (error instanceof TInvestOrderError && error.outcomeUncertain) {
        this.journal.recordExecutionUncertain(scenarioId, error.message);
      } else {
        const detail = error instanceof Error ? error.message : 'Unknown order submission error';
        this.journal.markExecutionFailed(scenarioId, detail);
      }
      throw error;
    }

    if (
      response.executionStatus === 'EXECUTION_REPORT_STATUS_REJECTED' ||
      response.executionStatus === 'EXECUTION_REPORT_STATUS_CANCELLED' ||
      response.executionStatus === 'EXECUTION_REPORT_STATUS_UNSPECIFIED'
    ) {
      const failed = this.journal.markExecutionFailed(scenarioId, response.executionStatus);
      return { order: failed, executionStatus: response.executionStatus, lotsExecuted: response.lotsExecuted };
    }

    const accepted = this.journal.markExecutionAccepted(
      scenarioId,
      response.brokerOrderId,
      `${response.executionStatus}; lots ${response.lotsExecuted}/${response.lotsRequested}`,
    );
    return { order: accepted, executionStatus: response.executionStatus, lotsExecuted: response.lotsExecuted };
  }

  private async ensureSandboxAccount(): Promise<void> {
    if (!this.accountId) {
      const accountName = 'AndStrel trading sandbox';
      const accounts = await this.orderClient.getSandboxAccounts();
      const existing = accounts.find((account) => account.name === accountName);
      this.accountId = existing?.id ?? (await this.orderClient.openSandboxAccount(accountName));
      this.journal.setRuntimeState('execution.sandbox_account_id', this.accountId);
    }

    if (this.journal.getRuntimeState('execution.sandbox_funded_account_id') !== this.accountId) {
      await this.orderClient.sandboxPayIn(
        this.accountId,
        this.config.execution.sandboxInitialBalanceRub,
      );
      this.journal.setRuntimeState('execution.sandbox_funded_account_id', this.accountId);
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
}

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { ExecutionService } from './execution-service.js';
import { TInvestOrderError } from './tinvest-order-client.js';

const temporaryDirectories: string[] = [];

function createJournal(): ScenarioJournal {
  const directory = mkdtempSync(join(tmpdir(), 'andstrel-execution-'));
  temporaryDirectories.push(directory);
  return new ScenarioJournal(join(directory, 'journal.sqlite'));
}

function createConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    T_INVEST_EXECUTION_MODE: 'sandbox',
    T_INVEST_TRADING_TOKEN: 'trade-token',
    T_INVEST_SANDBOX_ACCOUNT_ID: 'sandbox-account',
    T_INVEST_INTRADAY_WATCHLIST:
      '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
    ...overrides,
  });
}

function recordCandidate(journal: ScenarioJournal, observedAt: string) {
  return journal.record({
    observedAt,
    strategy: 'intraday',
    instrumentId: 'sber',
    input: {
      side: 'long',
      entryPrice: 100,
      stopPrice: 99,
      targetPrice: 102.5,
      lotSize: 1,
      slippageRate: 0.0005,
    },
    decision: 'candidate',
    blockers: [],
    warnings: [],
    snapshot: {
      tradePlan: { lots: 5, positionRub: 500, totalRiskRub: 7 },
    },
  });
}

function marketClient() {
  return {
    getOrderBook: vi.fn().mockResolvedValue({
      bids: [{ price: { units: '99', nano: 990000000 }, quantity: '100' }],
      asks: [{ price: { units: '100', nano: 0 }, quantity: '100' }],
    }),
    getTradingStatus: vi.fn().mockResolvedValue({
      tradingStatus: 'SECURITY_TRADING_STATUS_NORMAL_TRADING',
      apiTradeAvailableFlag: true,
      limitOrderAvailableFlag: true,
    }),
  };
}

function orderClient(postLimitOrder = vi.fn()) {
  return {
    postLimitOrder,
    getSandboxAccounts: vi.fn().mockResolvedValue([]),
    openSandboxAccount: vi.fn().mockResolvedValue('created-sandbox-account'),
    sandboxPayIn: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ExecutionService', () => {
  it('creates and funds a dedicated sandbox account when arming for the first time', async () => {
    const journal = createJournal();
    const config = loadConfig({
      T_INVEST_EXECUTION_MODE: 'sandbox',
      T_INVEST_TRADING_TOKEN: 'trade-token',
    });
    const client = orderClient();
    const service = new ExecutionService(config, marketClient(), client, journal);

    await service.armSandbox();

    expect(client.openSandboxAccount).toHaveBeenCalledWith('AndStrel trading sandbox');
    expect(client.sandboxPayIn).toHaveBeenCalledWith('created-sandbox-account', 100_000);
    expect(service.isReady()).toBe(true);
    expect(service.isKilled()).toBe(false);
  });

  it('queues a candidate idempotently and starts with the kill switch active', () => {
    const journal = createJournal();
    const config = createConfig();
    const scenario = recordCandidate(journal, '2026-09-15T07:00:00.000Z');
    const service = new ExecutionService(
      config,
      marketClient(),
      orderClient(),
      journal,
    );

    const first = service.queueScenario(scenario);
    const second = service.queueScenario(scenario);

    expect(first?.status).toBe('pending');
    expect(second?.id).toBe(first?.id);
    expect(second?.orderRequestId).toBe(first?.orderRequestId);
    expect(service.isKilled()).toBe(true);
  });

  it('submits one confirmed sandbox limit order and records broker acceptance', async () => {
    const journal = createJournal();
    const config = createConfig();
    const now = new Date('2026-09-15T07:05:00.000Z');
    const scenario = recordCandidate(journal, '2026-09-15T07:00:00.000Z');
    const postLimitOrder = vi.fn().mockResolvedValue({
      brokerOrderId: 'broker-order',
      executionStatus: 'EXECUTION_REPORT_STATUS_FILL',
      lotsRequested: 5,
      lotsExecuted: 5,
    });
    const service = new ExecutionService(config, marketClient(), orderClient(postLimitOrder), journal);
    const queued = service.queueScenario(scenario)!;
    await service.armSandbox();

    const result = await service.submitScenario(scenario.id, '42', now);

    expect(result.order.status).toBe('accepted');
    expect(result.order.brokerOrderId).toBe('broker-order');
    expect(postLimitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'sandbox',
        lots: 5,
        limitPrice: 100,
        orderRequestId: queued.orderRequestId,
      }),
    );
    await expect(service.submitScenario(scenario.id, '42', now)).rejects.toThrow('already accepted');
    expect(postLimitOrder).toHaveBeenCalledTimes(1);
  });

  it('retries an uncertain submission with the same idempotency key', async () => {
    const journal = createJournal();
    const config = createConfig();
    const now = new Date('2026-09-15T07:05:00.000Z');
    const scenario = recordCandidate(journal, '2026-09-15T07:00:00.000Z');
    const postLimitOrder = vi
      .fn()
      .mockRejectedValueOnce(new TInvestOrderError('timeout', true))
      .mockResolvedValueOnce({
        brokerOrderId: 'broker-order',
        executionStatus: 'EXECUTION_REPORT_STATUS_FILL',
        lotsRequested: 5,
        lotsExecuted: 5,
      });
    const service = new ExecutionService(config, marketClient(), orderClient(postLimitOrder), journal);
    const queued = service.queueScenario(scenario)!;
    await service.armSandbox();

    await expect(service.submitScenario(scenario.id, '42', now)).rejects.toThrow('timeout');
    expect(journal.getExecutionByScenario(scenario.id)?.status).toBe('submitting');
    await expect(service.submitScenario(scenario.id, '42', now)).resolves.toEqual(
      expect.objectContaining({ order: expect.objectContaining({ status: 'accepted' }) }),
    );
    expect(postLimitOrder.mock.calls[0]?.[0].orderRequestId).toBe(queued.orderRequestId);
    expect(postLimitOrder.mock.calls[1]?.[0].orderRequestId).toBe(queued.orderRequestId);
  });

  it('blocks stale candidates before calling the broker', async () => {
    const journal = createJournal();
    const config = createConfig();
    const scenario = recordCandidate(journal, '2026-09-15T06:00:00.000Z');
    const postLimitOrder = vi.fn();
    const service = new ExecutionService(config, marketClient(), orderClient(postLimitOrder), journal);
    service.queueScenario(scenario);
    await service.armSandbox();

    await expect(
      service.submitScenario(scenario.id, '42', new Date('2026-09-15T07:00:00.000Z')),
    ).rejects.toThrow('older than 10 minutes');
    expect(postLimitOrder).not.toHaveBeenCalled();
  });

  it('blocks a second order after the configured daily limit is consumed', async () => {
    const journal = createJournal();
    const config = createConfig({ T_INVEST_EXECUTION_MAX_ORDERS_PER_DAY: '1' });
    const now = new Date();
    const first = recordCandidate(journal, new Date(now.getTime() - 5 * 60_000).toISOString());
    const second = recordCandidate(journal, new Date(now.getTime() - 4 * 60_000).toISOString());
    const postLimitOrder = vi.fn().mockResolvedValue({
      brokerOrderId: 'broker-order',
      executionStatus: 'EXECUTION_REPORT_STATUS_FILL',
      lotsRequested: 5,
      lotsExecuted: 5,
    });
    const service = new ExecutionService(config, marketClient(), orderClient(postLimitOrder), journal);
    service.queueScenario(first);
    service.queueScenario(second);
    await service.armSandbox();

    await service.submitScenario(first.id, '42', now);
    await expect(service.submitScenario(second.id, '42', now)).rejects.toThrow(
      'Daily execution order limit',
    );
    expect(postLimitOrder).toHaveBeenCalledTimes(1);
  });
});

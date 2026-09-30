import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
      targetPrice: 105,
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
    getSandboxOrderState: vi.fn(),
  };
}

function statePayload(requestId: string, lotsExecuted = 5, status = 'EXECUTION_REPORT_STATUS_FILL') {
  return { orderId: 'broker-order', orderRequestId: requestId, instrumentUid: 'sber',
    direction: 'ORDER_DIRECTION_BUY', orderType: 'ORDER_TYPE_LIMIT', currency: 'rub',
    executionReportStatus: status, lotsRequested: '5', lotsExecuted: String(lotsExecuted),
    stages: lotsExecuted ? [{ tradeId: 'fill-1', quantity: String(lotsExecuted),
      price: { currency: 'rub', units: '100', nano: 0 }, executionTime: '2026-09-30T07:00:00.000Z' }] : [],
    executedCommission: { currency: 'rub', units: '0', nano: 0 }, serviceCommission: { currency: 'rub', units: '0', nano: 0 } };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ExecutionService', () => {
  it('bounds startup recovery, preserves unresolved orders and performs no broker writes after kill', async () => {
    const journal = createJournal(); const now = new Date();
    const client = orderClient(); const service = new ExecutionService(createConfig(), marketClient(), client, journal);
    const candidates = Array.from({ length: 3 }, () => recordCandidate(journal, now.toISOString()));
    for (const candidate of candidates) { service.queueScenario(candidate); journal.claimExecution(candidate.id, '42'); }
    service.kill();
    client.getSandboxOrderState.mockImplementation(async (_account: string, request: string) => {
      if (request === journal.getExecutionByScenario(candidates[1]!.id)?.orderRequestId) throw new Error('unavailable');
      return statePayload(request, 0, 'EXECUTION_REPORT_STATUS_CANCELLED');
    });
    expect(await service.recoverOutstanding(2, now)).toEqual({ attempted: 2, confirmed: 1, unconfirmed: 1, morePending: true });
    expect(client.getSandboxOrderState).toHaveBeenCalledTimes(2);
    expect(client.postLimitOrder).not.toHaveBeenCalled();
    expect(client.sandboxPayIn).not.toHaveBeenCalled();
    expect(client.openSandboxAccount).not.toHaveBeenCalled();
    expect(journal.getExecutionByScenario(candidates[1]!.id)?.status).toBe('submitting');
    expect(journal.getExecutionByScenario(candidates[2]!.id)?.status).toBe('submitting');
    expect(service.isKilled()).toBe(true);
  });
  it('prevents duplicate POST across two service instances sharing the same journal', async () => {
    const journal = createJournal(); const now = new Date();
    const candidate = recordCandidate(journal, now.toISOString());
    const post = vi.fn().mockResolvedValue({ brokerOrderId: 'broker-order', executionStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsRequested: 5, lotsExecuted: 5 });
    const a = new ExecutionService(createConfig(), marketClient(), orderClient(post), journal);
    const b = new ExecutionService(createConfig(), marketClient(), orderClient(post), journal);
    a.queueScenario(candidate); await a.armSandbox();
    const results = await Promise.allSettled([a.submitScenario(candidate.id, '42', now), b.submitScenario(candidate.id, '42', now)]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('permits only one unresolved order or possible open position in the daily pilot', async () => {
    const journal = createJournal(); const now = new Date();
    const candidates = [recordCandidate(journal, now.toISOString()), recordCandidate(journal, now.toISOString())];
    const post = vi.fn().mockResolvedValue({ brokerOrderId: 'broker-order', executionStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsRequested: 5, lotsExecuted: 5 });
    const service = new ExecutionService(createConfig(), marketClient(), orderClient(post), journal);
    for (const candidate of candidates) service.queueScenario(candidate);
    await service.armSandbox();
    const results = await Promise.allSettled(candidates.map(candidate => service.submitScenario(candidate.id, '42', now)));
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('keeps risk and state reserved when lookup fails or returns another order', async () => {
    const journal = createJournal(); const now = new Date();
    const candidate = recordCandidate(journal, now.toISOString());
    const post = vi.fn().mockRejectedValue(new Error('private-secret unexpected error'));
    const client = orderClient(post); const service = new ExecutionService(createConfig(), marketClient(), client, journal);
    const queued = service.queueScenario(candidate)!; await service.armSandbox();
    await expect(service.submitScenario(candidate.id, '42', now)).rejects.toThrow('use reconciliation');
    client.getSandboxOrderState.mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(statePayload('wrong-request'));
    for (let i = 0; i < 2; i++) {
      await expect(service.reconcileScenario(candidate.id, now)).rejects.toThrow('prior risk remains reserved');
      expect(journal.getExecutionByScenario(candidate.id)?.status).toBe('submitting');
      expect(journal.getExecutionByScenario(candidate.id)?.orderRequestId).toBe(queued.orderRequestId);
    }
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('releases a zero-fill terminal reserve only after matching broker state', async () => {
    const journal = createJournal(); const now = new Date();
    const candidate = recordCandidate(journal, now.toISOString());
    const client = orderClient(vi.fn().mockRejectedValue(new TInvestOrderError('timeout', true)));
    const service = new ExecutionService(createConfig(), marketClient(), client, journal);
    const queued = service.queueScenario(candidate)!; await service.armSandbox();
    await expect(service.submitScenario(candidate.id, '42', now)).rejects.toThrow();
    client.getSandboxOrderState.mockResolvedValue(statePayload(queued.orderRequestId, 0, 'EXECUTION_REPORT_STATUS_CANCELLED'));
    expect((await service.reconcileScenario(candidate.id, now)).order.status).toBe('failed');
    await expect(service.submitScenario(candidate.id, '42', now)).rejects.toThrow('already failed');
    expect(client.postLimitOrder).toHaveBeenCalledTimes(1);
  });
  it('cannot erase partial fills when a later reply reports cancellation with zero lots', async () => {
    const journal = createJournal(); const now = new Date();
    const candidate = recordCandidate(journal, now.toISOString());
    const client = orderClient(vi.fn().mockResolvedValue({ brokerOrderId: 'broker-order', executionStatus: 'EXECUTION_REPORT_STATUS_PARTIALLYFILL', lotsRequested: 5, lotsExecuted: 2 }));
    const service = new ExecutionService(createConfig(), marketClient(), client, journal);
    const queued = service.queueScenario(candidate)!; await service.armSandbox(); await service.submitScenario(candidate.id, '42', now);
    client.getSandboxOrderState.mockResolvedValue(statePayload(queued.orderRequestId, 0, 'EXECUTION_REPORT_STATUS_CANCELLED'));
    await expect(service.reconcileScenario(candidate.id, now)).rejects.toThrow('prior risk remains reserved');
    expect(journal.getExecutionByScenario(candidate.id)?.status).toBe('accepted');
    client.getSandboxOrderState.mockResolvedValue(statePayload(queued.orderRequestId, 2, 'EXECUTION_REPORT_STATUS_CANCELLED'));
    expect((await service.reconcileScenario(candidate.id, now)).order.status).toBe('accepted');
    expect(journal.getExecutionSnapshot(candidate.id)?.lotsExecuted).toBe(2);
  });
  it('does not erase a possible legacy position with missing persisted fill evidence', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'andstrel-legacy-execution-')); temporaryDirectories.push(directory);
    const path = join(directory, 'journal.sqlite'); const journal = new ScenarioJournal(path); const now = new Date();
    const candidate = recordCandidate(journal, now.toISOString()); const client = orderClient();
    const service = new ExecutionService(createConfig(), marketClient(), client, journal);
    const queued = service.queueScenario(candidate)!; await service.armSandbox();
    journal.claimExecution(candidate.id, '42'); journal.markExecutionAccepted(candidate.id, 'broker-order', 'legacy filled');
    const db = new DatabaseSync(path); db.exec('DELETE FROM execution_evidence'); db.close();
    client.getSandboxOrderState.mockResolvedValue(statePayload(queued.orderRequestId, 0, 'EXECUTION_REPORT_STATUS_CANCELLED'));
    await expect(service.reconcileScenario(candidate.id, now)).rejects.toThrow('prior risk remains reserved');
    expect(journal.getExecutionByScenario(candidate.id)?.status).toBe('accepted');
  });
  it('persists monotonic trade evidence and rolls back a contradictory later snapshot', async () => {
    const journal = createJournal(); const now = new Date(); const candidate = recordCandidate(journal, now.toISOString());
    const client = orderClient(vi.fn().mockRejectedValue(new TInvestOrderError('timeout', true)));
    const service = new ExecutionService(createConfig(), marketClient(), client, journal);
    const queued = service.queueScenario(candidate)!; await service.armSandbox();
    await expect(service.submitScenario(candidate.id, '42', now)).rejects.toThrow();
    const partial = statePayload(queued.orderRequestId, 2, 'EXECUTION_REPORT_STATUS_PARTIALLYFILL');
    client.getSandboxOrderState.mockResolvedValue(partial); await service.reconcileScenario(candidate.id, now);
    const prior = journal.getExecutionSnapshot(candidate.id);
    const changed = statePayload(queued.orderRequestId, 2, 'EXECUTION_REPORT_STATUS_CANCELLED');
    changed.stages[0]!.price.units = '99';
    client.getSandboxOrderState.mockResolvedValue(changed);
    await expect(service.reconcileScenario(candidate.id, now)).rejects.toThrow('prior risk remains reserved');
    expect(journal.getExecutionSnapshot(candidate.id)).toEqual(prior);
    client.getSandboxOrderState.mockResolvedValue({ ...partial, executionReportStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsExecuted: '5',
      stages: [...partial.stages, { ...partial.stages[0]!, tradeId: 'fill-2', quantity: '3' }] });
    await service.reconcileScenario(candidate.id, now);
    expect(journal.getExecutionSnapshot(candidate.id)).toMatchObject({ lotsExecuted: 5, grossNano: '500000000000' });
  });
  it('rechecks tightened limits for a previously queued order before any broker call', async () => {
    const journal = createJournal();
    const now = new Date();
    const candidate = recordCandidate(journal, now.toISOString());
    const old = new ExecutionService(createConfig(), marketClient(), orderClient(), journal);
    old.queueScenario(candidate);
    await old.armSandbox();
    const postLimitOrder = vi.fn();
    const service = new ExecutionService(createConfig({ INTRADAY_MAX_RISK_RUB: '5' }), marketClient(), orderClient(postLimitOrder), journal);
    await expect(service.submitScenario(candidate.id, '42', now)).rejects.toThrow('risk limit');
    expect(postLimitOrder).not.toHaveBeenCalled();
  });
  it('retains daily risk when a cancelled order reports a partial fill', async () => {
    const journal = createJournal();
    const now = new Date();
    const candidate = recordCandidate(journal, now.toISOString());
    const postLimitOrder = vi.fn().mockResolvedValue({ brokerOrderId: 'partial-order', executionStatus: 'EXECUTION_REPORT_STATUS_CANCELLED', lotsRequested: 5, lotsExecuted: 1 });
    const service = new ExecutionService(createConfig(), marketClient(), orderClient(postLimitOrder), journal);
    service.queueScenario(candidate);
    await service.armSandbox();
    const result = await service.submitScenario(candidate.id, '42', now);
    expect(result.order.status).toBe('accepted');
    expect(result.lotsExecuted).toBe(1);
  });

  it('keeps unknown execution status in submitting instead of freeing the reservation', async () => {
    const journal = createJournal();
    const now = new Date();
    const candidate = recordCandidate(journal, now.toISOString());
    const postLimitOrder = vi.fn().mockResolvedValue({ brokerOrderId: 'order', executionStatus: 'EXECUTION_REPORT_STATUS_UNSPECIFIED', lotsRequested: 5, lotsExecuted: 0 });
    const service = new ExecutionService(createConfig(), marketClient(), orderClient(postLimitOrder), journal);
    service.queueScenario(candidate);
    await service.armSandbox();
    await expect(service.submitScenario(candidate.id, '42', now)).rejects.toThrow('risk remains reserved');
    expect(journal.getExecutionByScenario(candidate.id)?.status).toBe('submitting');
  });
  it('reserves the daily budget atomically for concurrent confirmations', async () => {
    const journal = createJournal();
    const config = createConfig({ T_INVEST_EXECUTION_MAX_ORDERS_PER_DAY: '20',
      T_INVEST_LIVE_PILOT_PREPARE: 'false', T_INVEST_EXECUTION_MAX_DAILY_RISK_RUB: '49' });
    const now = new Date();
    const candidates = Array.from({ length: 8 }, () => recordCandidate(journal, now.toISOString()));
    const postLimitOrder = vi.fn().mockResolvedValue({ brokerOrderId: 'broker-order', executionStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsRequested: 5, lotsExecuted: 5 });
    const service = new ExecutionService(config, marketClient(), orderClient(postLimitOrder), journal);
    for (const candidate of candidates) service.queueScenario(candidate);
    await service.armSandbox();
    const results = await Promise.allSettled(candidates.map(candidate => service.submitScenario(candidate.id, '42', now)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(7);
    expect(postLimitOrder).toHaveBeenCalledTimes(7);
    expect(results.filter(result => result.status === 'rejected')[0]).toMatchObject({ reason: expect.any(Error) });
    expect(journal.listExecutionOrders(10).filter(order => order.status === 'pending')).toHaveLength(1);
  });

  it('does not send two requests for simultaneous confirmations of the same candidate', async () => {
    const journal = createJournal();
    const now = new Date();
    const candidate = recordCandidate(journal, now.toISOString());
    const postLimitOrder = vi.fn().mockResolvedValue({ brokerOrderId: 'order', executionStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsRequested: 5, lotsExecuted: 5 });
    const service = new ExecutionService(createConfig(), marketClient(), orderClient(postLimitOrder), journal);
    service.queueScenario(candidate);
    await service.armSandbox();
    const results = await Promise.allSettled([service.submitScenario(candidate.id, '42', now), service.submitScenario(candidate.id, '42', now)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(postLimitOrder).toHaveBeenCalledTimes(1);
  });

  it('keeps the reservation on its approval day even if the reply updates it later', async () => {
    const journal = createJournal();
    const service = new ExecutionService(createConfig(), marketClient(), orderClient(), journal);
    const scenario = recordCandidate(journal, '2026-09-30T20:59:00.000Z');
    service.queueScenario(scenario);
    await service.armSandbox();
    const from = '2026-09-29T21:00:00.000Z';
    const to = '2026-09-30T21:00:00.000Z';
    journal.claimExecution(scenario.id, '42', { from, to, now: '2026-09-30T20:59:00.000Z', maxOrders: 3, maxRiskRub: 60 });
    journal.markExecutionAccepted(scenario.id, 'order', 'filled');
    expect(journal.getExecutionDailyUsage(from, to).orderCount).toBe(1);
    expect(journal.getExecutionDailyUsage(to, '2026-10-01T21:00:00.000Z').orderCount).toBe(0);
  });

  it('honors kill while waiting for fresh market data', async () => {
    const journal = createJournal();
    const now = new Date();
    const scenario = recordCandidate(journal, now.toISOString());
    const client = marketClient();
    const postLimitOrder = vi.fn();
    const service = new ExecutionService(createConfig(), client, orderClient(postLimitOrder), journal);
    service.queueScenario(scenario);
    await service.armSandbox();
    const regularStatus = await client.getTradingStatus();
    client.getTradingStatus.mockImplementation(async () => { service.kill(); return regularStatus; });
    await expect(service.submitScenario(scenario.id, '42', now)).rejects.toThrow('kill switch');
    expect(postLimitOrder).not.toHaveBeenCalled();
  });

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
    expect(client.sandboxPayIn).toHaveBeenCalledWith('created-sandbox-account', 1_000);
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
    expect(first?.estimatedRiskRub).toBeGreaterThan(7);
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

  it('reads uncertain submission state without retrying POST after restart, kill and candidate expiry', async () => {
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
    const client = orderClient(postLimitOrder);
    const service = new ExecutionService(config, marketClient(), client, journal);
    const queued = service.queueScenario(scenario)!;
    await service.armSandbox();

    await expect(service.submitScenario(scenario.id, '42', now)).rejects.toThrow('use reconciliation');
    expect(journal.getExecutionByScenario(scenario.id)?.status).toBe('submitting');
    const later = new Date(now.getTime() + 24 * 60 * 60_000);
    client.getSandboxOrderState.mockResolvedValue({ orderId: 'broker-order', orderRequestId: queued.orderRequestId,
      instrumentUid: 'sber', direction: 'ORDER_DIRECTION_BUY', orderType: 'ORDER_TYPE_LIMIT',
      executionReportStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsRequested: '5', lotsExecuted: '5', currency: 'rub',
      stages: [{ tradeId: 'fill-1', price: { currency: 'rub', units: '100', nano: 0 }, quantity: '5', executionTime: now.toISOString() }],
      executedCommission: { currency: 'rub', units: '1', nano: 500000000 }, serviceCommission: { currency: 'rub', units: '0', nano: 0 },
    });
    service.kill();
    const restarted = new ExecutionService(config, marketClient(), client, journal);
    await expect(restarted.submitScenario(scenario.id, '42', later)).resolves.toEqual(
      expect.objectContaining({ order: expect.objectContaining({ status: 'accepted' }) }),
    );
    expect(journal.getExecutionSnapshot(scenario.id)).toMatchObject({ grossNano: '500000000000', commissionNano: '1500000000', lotsExecuted: 5 });
    expect(postLimitOrder.mock.calls[0]?.[0].orderRequestId).toBe(queued.orderRequestId);
    expect(postLimitOrder).toHaveBeenCalledTimes(1);
    expect(client.getSandboxOrderState).toHaveBeenCalledWith('sandbox-account', queued.orderRequestId);
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

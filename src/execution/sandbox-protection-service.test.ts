import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { SandboxProtectionService } from './sandbox-protection-service.js';
import { nanoQuotation, nativeStopKey } from './sandbox-stop-state.js';
import { ExecutionService } from './execution-service.js';
import { seedPreparedSandbox } from './sandbox-prepared.test-helper.js';
import { sandboxEndpoint } from './sandbox-prepared-account.js';

const directories: string[] = [];
const now = new Date('2026-09-30T12:00:00.000Z');
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function setup(accepted = true, lotsExecuted = 5, status = 'EXECUTION_REPORT_STATUS_FILL') {
  const directory = mkdtempSync(join(tmpdir(), 'trading-native-stop-')); directories.push(directory);
  const journal = new ScenarioJournal(join(directory, 'journal.sqlite'));
  seedPreparedSandbox(journal, 'local-account');
  const config = loadConfig({ T_INVEST_TOKEN: 'read-token', T_INVEST_TRADING_TOKEN: 'isolated-sandbox-token',
    T_INVEST_BASE_URL: sandboxEndpoint, T_INVEST_EXECUTION_MODE: 'sandbox', T_INVEST_SANDBOX_ACCOUNT_ID: 'local-account', T_INVEST_SANDBOX_PROTECTION_ENABLED: 'true' });
  const scenario = journal.record({ observedAt: now.toISOString(), strategy: 'intraday', instrumentId: 'local-instrument',
    input: { side: 'long', entryPrice: 10, stopPrice: 9.9, targetPrice: 11, lotSize: 10, slippageRate: 0.0005 },
    decision: 'candidate', blockers: [], warnings: [], snapshot: { tradePlan: { lots: 5, positionRub: 500, totalRiskRub: 9 } } });
  const order = journal.queueExecution({ scenarioId: scenario.id, mode: 'sandbox', instrumentId: scenario.instrumentId,
    side: 'long', lots: 5, limitPrice: 10, estimatedRiskRub: 9, orderRequestId: '2c73ae3c-c845-4154-8a67-9f23b363d7c2' });
  if (accepted) { journal.claimExecution(scenario.id, '42'); journal.markExecutionAccepted(scenario.id, 'local-entry', status, lotsExecuted); }
  let bought = accepted;
  const flat = () => ({ accountId: 'local-account', limitsLoadingInProgress: false, securities: [], futures: [], options: [],
    money: [{ currency: 'rub', units: '1000', nano: 0 }], blocked: [] });
  const held = () => ({ ...flat(), securities: [{ instrumentUid: scenario.instrumentId,
    balance: String(lotsExecuted * 10), blocked: '0', exchangeBlocked: false, instrumentType: 'share' }] });
  const stopPayload = (changes: Record<string, unknown> = {}) => {
    const intent = journal.getNativeStop(scenario.id)!.intent;
    return { stopOrders: [{ stopOrderId: 'local-stop', status: 'STOP_ORDER_STATUS_ACTIVE', instrumentUid: intent.instrumentId,
      currency: 'rub', direction: 'STOP_ORDER_DIRECTION_SELL', orderType: 'STOP_ORDER_TYPE_STOP_LIMIT', lotsRequested: String(intent.lots),
      stopPrice: { currency: 'rub', ...nanoQuotation(intent.stopNano) }, price: { currency: 'rub', ...nanoQuotation(intent.limitNano) },
      createDate: now.toISOString(), exchangeOrderType: 'EXCHANGE_ORDER_TYPE_LIMIT', ...changes }] };
  };
  const state = () => ({ orderId: 'local-entry', orderRequestId: order.orderRequestId, instrumentUid: scenario.instrumentId,
    direction: 'ORDER_DIRECTION_BUY', orderType: 'ORDER_TYPE_LIMIT', currency: 'rub', executionReportStatus: status,
    lotsRequested: '5', lotsExecuted: String(lotsExecuted), stages: lotsExecuted ? [{ tradeId: 'local-fill', quantity: String(lotsExecuted),
      price: { currency: 'rub', units: '10', nano: 0 }, executionTime: now.toISOString() }] : [],
    executedCommission: { currency: 'rub', units: '0', nano: 0 }, serviceCommission: { currency: 'rub', units: '0', nano: 0 } });
  const client = {
    getSandboxOrderState: vi.fn().mockImplementation(async () => state()),
    getSandboxPositions: vi.fn().mockImplementation(async () => bought ? held() : flat()),
    getSandboxStopOrders: vi.fn().mockImplementation(async () => journal.getNativeStop(scenario.id)?.intent.brokerStopId ? stopPayload() : { stopOrders: [] }),
    getSandboxOrders: vi.fn().mockResolvedValue({ orders: [] }),
    postSandboxStopLimit: vi.fn().mockResolvedValue('local-stop'),
    postLimitOrder: vi.fn().mockImplementation(async () => { bought = true; return { brokerOrderId: 'local-entry',
      executionStatus: status, lotsRequested: 5, lotsExecuted }; }),
    getSandboxAccounts: vi.fn().mockResolvedValue([]), openSandboxAccount: vi.fn(), sandboxPayIn: vi.fn(),
  };
  const protection = new SandboxProtectionService(config, client, journal);
  const market = { getOrderBook: vi.fn().mockResolvedValue({ bids: [{ price: { units: '9', nano: 999000000 }, quantity: '100' }],
    asks: [{ price: { units: '10', nano: 0 }, quantity: '100' }] }),
    getTradingStatus: vi.fn().mockResolvedValue({ tradingStatus: 'SECURITY_TRADING_STATUS_NORMAL_TRADING', apiTradeAvailableFlag: true, limitOrderAvailableFlag: true }) };
  const execution = new ExecutionService(config, market, client, journal, protection);
  return { journal, config, scenario, order, client, protection, execution, flat, held, state, stopPayload };
}

describe('Isolated sandbox native protection', () => {
  it('persists a single intent before POST, protects exact units and never clears kill', async () => {
    const f = setup(); f.journal.setExecutionKilled(true);
    f.client.postSandboxStopLimit.mockImplementationOnce(async input => {
      expect(f.journal.getNativeStop(f.scenario.id)?.intent).toMatchObject({ requestId: input.requestId, brokerStopId: null });
      return 'local-stop';
    });
    expect(await f.protection.protect('local-account', f.scenario.id, now)).toEqual({ status: 'STOP_ORDER_STATUS_ACTIVE', lots: 5, positionClosed: false });
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledWith(expect.objectContaining({ mode: 'sandbox', lots: 5, stopNano: '9900000000', limitNano: '9900000000' }));
    expect(f.journal.isExecutionKilled()).toBe(true);
    expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('accepted');
    const restarted = new SandboxProtectionService(f.config, f.client, f.journal);
    await restarted.protect('local-account', f.scenario.id, now);
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
    expect(f.client.getSandboxOrderState).toHaveBeenCalledOnce();
  });
  it('never retries an uncertain stop POST, even after restart or a lookalike stop', async () => {
    const f = setup(); f.client.postSandboxStopLimit.mockRejectedValue(new Error('private broker payload'));
    await expect(f.protection.protect('local-account', f.scenario.id, now)).rejects.toThrow('no stop is retried');
    const prior = f.journal.getNativeStop(f.scenario.id)!;
    expect(prior.intent.brokerStopId).toBeNull();
    f.client.getSandboxStopOrders.mockResolvedValue(f.stopPayload());
    await expect(new SandboxProtectionService(f.config, f.client, f.journal).protect('local-account', f.scenario.id, now)).rejects.toThrow('not confirmed');
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
    expect(f.journal.getNativeStop(f.scenario.id)?.intent.requestId).toBe(prior.intent.requestId);
    expect(f.journal.isExecutionKilled()).toBe(true);
  });
  it('protects terminal partial fills rather than requested lots', async () => {
    const f = setup(true, 2, 'EXECUTION_REPORT_STATUS_CANCELLED');
    expect(await f.protection.protect('local-account', f.scenario.id, now)).toMatchObject({ lots: 2, positionClosed: false });
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledWith(expect.objectContaining({ lots: 2 }));
  });
  it('does not create a stop for a nonterminal partial fill', async () => {
    const f = setup(true, 2, 'EXECUTION_REPORT_STATUS_PARTIALLYFILL');
    await expect(f.protection.protect('local-account', f.scenario.id, now)).rejects.toThrow();
    expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled(); expect(f.journal.isExecutionKilled()).toBe(true);
  });
  it.each(['account', 'holding', 'order', 'stop', 'entry'])('rejects conflicting %s before POST', async conflict => {
    const f = setup();
    if (conflict === 'account') f.client.getSandboxPositions.mockResolvedValue({ ...f.held(), accountId: 'other' });
    if (conflict === 'holding') f.client.getSandboxPositions.mockResolvedValue({ ...f.held(), securities: [...f.held().securities, ...f.held().securities] });
    if (conflict === 'order') f.client.getSandboxOrders.mockResolvedValue({ orders: [{}] });
    if (conflict === 'stop') f.client.getSandboxStopOrders.mockResolvedValue({ stopOrders: [{ stopOrderId: 'foreign', status: 'STOP_ORDER_STATUS_ACTIVE' }] });
    if (conflict === 'entry') f.client.getSandboxOrderState.mockResolvedValue({ ...f.state(), orderRequestId: 'foreign' });
    await expect(f.protection.protect('local-account', f.scenario.id, now)).rejects.toThrow('not confirmed');
    expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled(); expect(f.journal.getNativeStop(f.scenario.id)).toBeNull();
  });
  it('does not report active protection after holdings change or the stop disappears', async () => {
    const f = setup(); await f.protection.protect('local-account', f.scenario.id, now);
    f.client.getSandboxPositions.mockResolvedValue({ ...f.held(), securities: [] });
    await expect(f.protection.protect('local-account', f.scenario.id, now)).rejects.toThrow();
    f.client.getSandboxStopOrders.mockResolvedValue({ stopOrders: [] });
    await expect(f.protection.protect('local-account', f.scenario.id, now)).rejects.toThrow();
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
    expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('accepted');
  });
  it('records child ID without declaring a sale or freeing entry reservation; forbids regression', async () => {
    const f = setup(); await f.protection.protect('local-account', f.scenario.id, now);
    f.client.getSandboxStopOrders.mockResolvedValue(f.stopPayload({ status: 'STOP_ORDER_STATUS_EXECUTED', exchangeOrderId: 'local-child' }));
    expect(await f.protection.protect('local-account', f.scenario.id, now)).toMatchObject({ status: 'STOP_ORDER_STATUS_EXECUTED', positionClosed: false });
    expect(f.journal.getNativeStop(f.scenario.id)?.observation?.childOrderId).toBe('local-child');
    expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('accepted'); expect(f.journal.isExecutionKilled()).toBe(true);
    f.client.getSandboxStopOrders.mockResolvedValue(f.stopPayload());
    await expect(f.protection.protect('local-account', f.scenario.id, now)).rejects.toThrow();
    expect(f.journal.getNativeStop(f.scenario.id)?.observation?.status).toBe('STOP_ORDER_STATUS_EXECUTED');
  });
  it('two service instances make at most one POST under an overlapping claim', async () => {
    const f = setup();
    await Promise.allSettled([f.protection.protect('local-account', f.scenario.id, now),
      new SandboxProtectionService(f.config, f.client, f.journal).protect('local-account', f.scenario.id, now)]);
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce(); expect(f.journal.getNativeStop(f.scenario.id)?.intent.brokerStopId).toBe('local-stop');
  });
  it('passes captured generation identity to both POST acknowledgement and later observations', async () => {
    const f = setup(); const ack = vi.spyOn(f.journal, 'acknowledgeNativeStop'); const observe = vi.spyOn(f.journal, 'observeNativeStop');
    await f.protection.protect('local-account', f.scenario.id, now);
    const current = f.journal.getNativeStop(f.scenario.id)!.intent;
    expect(ack).toHaveBeenCalledWith(f.scenario.id, current.requestId, 'local-stop', { ...nativeStopKey(current), brokerStopId: null });
    expect(observe).toHaveBeenCalledWith(f.scenario.id, { status: 'STOP_ORDER_STATUS_ACTIVE', childOrderId: null }, nativeStopKey(current));
  });
  it('rejects a stale captured generation instead of attaching its observation to current protection', async () => {
    const f = setup(); await f.protection.protect('local-account', f.scenario.id, now);
    const current = f.journal.getNativeStop(f.scenario.id)!;
    const read = vi.spyOn(f.journal, 'getNativeStop').mockReturnValue({ ...current, intent: { ...current.intent, generation: 1 } });
    await expect(f.protection.protect('local-account', f.scenario.id, now)).rejects.toThrow('not confirmed');
    read.mockRestore();
    expect(f.journal.getNativeStop(f.scenario.id)).toEqual(current);
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce(); expect(f.journal.isExecutionKilled()).toBe(true);
  });
  it('submission and worker sharing one service await the same protection without a spurious kill', async () => {
    const f = setup(); f.journal.setExecutionKilled(false);
    const results = await Promise.all([f.protection.protect('local-account', f.scenario.id, now), f.protection.protect('local-account', f.scenario.id, now)]);
    expect(results.every(result => result.status === 'STOP_ORDER_STATUS_ACTIVE')).toBe(true);
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce(); expect(f.journal.isExecutionKilled()).toBe(false);
  });
  it('integrates flat account preflight, approved BUY, read-back and a stop, while recovery stays read-only', async () => {
    const f = setup(false); f.journal.setExecutionKilled(false);
    expect(await f.execution.submitScenario(f.scenario.id, '42', now)).toMatchObject({ lotsExecuted: 5 });
    expect(f.client.postLimitOrder).toHaveBeenCalledOnce(); expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
    await f.execution.recoverOutstanding(20, now);
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
  });
  it.each(['cash', 'book', 'blocked'])('entry preflight rejects %s before BUY', async conflict => {
    const f = setup(false); f.journal.setExecutionKilled(false);
    if (conflict === 'cash') f.client.getSandboxPositions.mockResolvedValue({ ...f.flat(), money: [{ currency: 'rub', units: '100', nano: 0 }] });
    if (conflict === 'book') f.client.getSandboxStopOrders.mockResolvedValue({});
    if (conflict === 'blocked') f.client.getSandboxPositions.mockResolvedValue({ ...f.flat(), blocked: [{ currency: 'rub', units: '1', nano: 0 }] });
    await expect(f.execution.submitScenario(f.scenario.id, '42', now)).rejects.toThrow('no entry was sent');
    expect(f.client.postLimitOrder).not.toHaveBeenCalled(); expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();
    expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('pending');
  });
  it('failure after BUY retains accepted holdings and a stop intent, rather than freeing risk', async () => {
    const f = setup(false); f.journal.setExecutionKilled(false); f.client.postSandboxStopLimit.mockRejectedValue(new Error('timeout'));
    await expect(f.execution.submitScenario(f.scenario.id, '42', now)).rejects.toThrow('risk remains reserved');
    expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('accepted'); expect(f.journal.isExecutionKilled()).toBe(true);
    await f.execution.recoverOutstanding(20, now);
    expect(f.client.postLimitOrder).toHaveBeenCalledOnce(); expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
  });
  it('monitor exposes unresolved submissions without sending entry or stop orders', async () => {
    const f = setup(false); f.journal.claimExecution(f.scenario.id, '42');
    expect(await f.execution.protectOutstanding(now)).toEqual({ active: 0, triggered: 0, closed: 0, unconfirmed: 1, morePending: false });
    expect(f.client.postLimitOrder).not.toHaveBeenCalled(); expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'same-token', 'flag-off'])('cannot write when %s', async condition => {
    const f = setup();
    if (condition === 'disabled') f.config.execution.mode = 'disabled';
    if (condition === 'same-token') f.config.execution.token = f.config.token!;
    if (condition === 'flag-off') f.config.execution.sandboxProtectionEnabled = false;
    await expect(f.protection.protect('local-account', f.scenario.id, now)).rejects.toThrow('not enabled');
    expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled(); expect(f.client.getSandboxOrderState).not.toHaveBeenCalled();
  });
});

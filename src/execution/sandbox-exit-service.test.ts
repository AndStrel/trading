import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { ExecutionService } from './execution-service.js';
import { SandboxExitService } from './sandbox-exit-service.js';
import { parseSandboxOrderState, type SandboxOrderSnapshot } from './sandbox-order-state.js';
import { nativeStopKey } from './sandbox-stop-state.js';
import { sandboxCloseKey } from './sandbox-session-policy.js';
import { sandboxTargetEconomics } from './sandbox-target-policy.js';
import { buildMiniAppView } from '../web/mini-app-view.js';
import { seedPreparedSandbox } from './sandbox-prepared.test-helper.js';
import { sandboxBootstrapKey } from './sandbox-prepared-account.js';

const now = new Date('2026-10-01T08:00:00.000Z');
const entryAt = '2026-10-01T07:55:00.000Z'; const stopAt = '2026-10-01T07:58:00.000Z'; const exitAt = '2026-10-01T07:59:00.000Z';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function setup(entryLots = 5, stopExecuted = true, targetMetadata = false, withCashBaseline = false) {
  const directory = mkdtempSync(join(tmpdir(), 'trading-sandbox-exit-')); directories.push(directory);
  const path = join(directory, 'journal.sqlite'); const journal = new ScenarioJournal(path);
  const config = loadConfig({ T_INVEST_TOKEN: 'readonly-local', T_INVEST_TRADING_TOKEN: 'isolated-local',
    T_INVEST_EXECUTION_MODE: 'sandbox', T_INVEST_SANDBOX_ACCOUNT_ID: 'local-account', T_INVEST_SANDBOX_PROTECTION_ENABLED: 'true' });
  const scenario = journal.record({ observedAt: entryAt, strategy: 'intraday', instrumentId: 'local-instrument',
    input: { side: 'long', entryPrice: 10, stopPrice: 9.9, targetPrice: 11, lotSize: 10, slippageRate: 0.0005 },
    decision: 'candidate', blockers: [], warnings: [], snapshot: { tradePlan: { lots: 5, positionRub: 500, totalRiskRub: 9 },
      ...(targetMetadata ? { source: 'intraday-scanner', tradingStrategy: { id: 'trend-momentum-v1', version: '1' },
        instrument: { instrumentId: 'local-instrument', lotSize: 10, priceStep: 0.01 },
        sandboxTargetExitPolicy: { version: '1', enabled: true, commissionRateNano: '3000000', slippageRateNano: '500000' } } : {}) } });
  const order = journal.queueExecution({ scenarioId: scenario.id, mode: 'sandbox', instrumentId: scenario.instrumentId, side: 'long',
    lots: 5, limitPrice: 10, estimatedRiskRub: 9, orderRequestId: 'd7f1b49b-b59e-4816-9f6a-222526ce3bae' });
  const entryPayload = () => ({ orderId: 'local-entry', orderRequestId: order.orderRequestId, instrumentUid: scenario.instrumentId,
    direction: 'ORDER_DIRECTION_BUY', orderType: 'ORDER_TYPE_LIMIT', currency: 'rub', lotsRequested: '5', lotsExecuted: String(entryLots),
    executionReportStatus: entryLots === 5 ? 'EXECUTION_REPORT_STATUS_FILL' : 'EXECUTION_REPORT_STATUS_CANCELLED',
    stages: [{ tradeId: 'local-buy', quantity: String(entryLots), price: { currency: 'rub', units: '10', nano: 0 }, executionTime: entryAt }],
    executedCommission: { currency: 'rub', units: '1', nano: 500000000 }, serviceCommission: { currency: 'rub', units: '0', nano: 500000000 } });
  const childPayload = (sold = entryLots, status = sold === entryLots ? 'EXECUTION_REPORT_STATUS_FILL' : 'EXECUTION_REPORT_STATUS_CANCELLED') => ({
    orderId: 'local-child', instrumentUid: scenario.instrumentId, direction: 'ORDER_DIRECTION_SELL', orderType: 'ORDER_TYPE_LIMIT',
    currency: 'rub', lotsRequested: String(entryLots), lotsExecuted: String(sold), executionReportStatus: status,
    stages: sold ? [{ tradeId: 'local-sell', quantity: String(sold), price: { currency: 'rub', units: '9', nano: 900000000 }, executionTime: exitAt }] : [],
    executedCommission: { currency: 'rub', units: '1', nano: 500000000 }, serviceCommission: { currency: 'rub', units: '0', nano: 500000000 } });
  const flat = () => ({ accountId: 'local-account', limitsLoadingInProgress: false, securities: [], futures: [], options: [],
    money: [{ currency: 'rub', units: '1000', nano: 0 }], blocked: [] });
  if (withCashBaseline) {
    seedPreparedSandbox(journal, 'local-account'); journal.setExecutionKilled(false);
    const raw = journal.getRuntimeState(sandboxBootstrapKey)!, generation = journal.getRuntimeState('execution.kill_generation')!;
    const beforeEntry = '2026-10-01T07:54:59.000Z';
    journal.claimExecution(scenario.id, '42', { from: '2026-09-30T21:00:00.000Z', to: '2026-10-01T21:00:00.000Z', now: beforeEntry,
      maxOrders: 3, maxRiskRub: 60, singlePosition: true, preparedSandbox: { raw, generation, accountId: 'local-account' },
      cashBaseline: { version: 1, accountId: 'local-account', entryRequestId: order.orderRequestId, cashNano: '1000000000000',
        observedFrom: beforeEntry, observedAt: beforeEntry, ledgerRevision: journal.getSandboxLedgerRevision(), killGeneration: generation, preparedRaw: raw } });
  } else journal.claimExecution(scenario.id, '42');
  journal.markExecutionAccepted(scenario.id, 'local-entry', 'accepted', entryLots);
  journal.recordExecutionReconciliation(scenario.id, parseSandboxOrderState(entryPayload(), {
    requestId: order.orderRequestId, instrumentId: scenario.instrumentId, lots: 5, lotSize: 10 }, now));
  journal.claimNativeStop({ scenarioId: scenario.id, accountId: 'local-account', requestId: 'ed9e9b29-7867-4f5f-84bd-6ce7318a775a',
    instrumentId: scenario.instrumentId, entryRequestId: order.orderRequestId, lots: entryLots, stopNano: '9900000000', limitNano: '9900000000',
    createdAt: stopAt, brokerStopId: null });
  journal.acknowledgeNativeStop(scenario.id, 'ed9e9b29-7867-4f5f-84bd-6ce7318a775a', 'local-stop');
  journal.observeNativeStop(scenario.id, { status: stopExecuted ? 'STOP_ORDER_STATUS_EXECUTED' : 'STOP_ORDER_STATUS_ACTIVE', childOrderId: stopExecuted ? 'local-child' : null });
  const stopPayload = () => ({ stopOrders: [{ stopOrderId: 'local-stop', status: stopExecuted ? 'STOP_ORDER_STATUS_EXECUTED' : 'STOP_ORDER_STATUS_ACTIVE',
    ...(stopExecuted ? { exchangeOrderId: 'local-child' } : {}),
    instrumentUid: scenario.instrumentId, currency: 'rub', direction: 'STOP_ORDER_DIRECTION_SELL', orderType: 'STOP_ORDER_TYPE_STOP_LIMIT',
    lotsRequested: String(entryLots), stopPrice: { currency: 'rub', units: '9', nano: 900000000 },
    price: { currency: 'rub', units: '9', nano: 900000000 }, createDate: stopAt }] });
  const client = { getSandboxOrderState: vi.fn().mockImplementation(async () => entryPayload()),
    getSandboxChildOrderState: vi.fn().mockImplementation(async () => childPayload()),
    getSandboxStopOrders: vi.fn().mockImplementation(async () => stopPayload()),
    getSandboxPositions: vi.fn().mockImplementation(async () => flat()), getSandboxOrders: vi.fn().mockResolvedValue({ orders: [] }),
    getSandboxCashOperationsWindow: vi.fn(),
    postLimitOrder: vi.fn(), postSandboxStopLimit: vi.fn(), openSandboxAccount: vi.fn(), sandboxPayIn: vi.fn(), getSandboxAccounts: vi.fn() };
  const exits = new SandboxExitService(config, client, journal);
  const protection = { protect: vi.fn().mockResolvedValue({ status: 'STOP_ORDER_STATUS_EXECUTED', lots: entryLots, positionClosed: false }), preflightForEntry: vi.fn() };
  const execution = new ExecutionService(config, { getOrderBook: vi.fn(), getTradingStatus: vi.fn() }, client, journal, protection, exits);
  const noWrites = () => {
    expect(client.postLimitOrder).not.toHaveBeenCalled(); expect(client.postSandboxStopLimit).not.toHaveBeenCalled();
    expect(client.openSandboxAccount).not.toHaveBeenCalled(); expect(client.sandboxPayIn).not.toHaveBeenCalled();
  };
  return { path, journal, config, scenario, order, client, exits, execution, noWrites, entryPayload, childPayload, flat, stopPayload };
}

function ownedCashWindow(accountId: string, from: string, to: string) {
  const money = (units: string, nano = 0) => ({ currency: 'rub', units, nano });
  const trade = (id: string, type: 'BUY' | 'SELL', date: string, gross: string, price: ReturnType<typeof money>, num: string) => ({
    id, brokerAccountId: accountId, date, type: `OPERATION_TYPE_${type}`, state: 'OPERATION_STATE_EXECUTED', instrumentUid: 'local-instrument',
    payment: money(gross), price, commission: money('2'), quantity: '50', quantityRest: '0', quantityDone: '50',
    tradesInfo: { trades: [{ num, date, quantity: '50', price }] },
  });
  const fee = (id: string, parentOperationId: string, date: string) => ({ id, parentOperationId, brokerAccountId: accountId,
    date, type: 'OPERATION_TYPE_BROKER_FEE', state: 'OPERATION_STATE_EXECUTED', payment: money('-2') });
  return { version: 1 as const, accountId, from, to, pages: [{ cursor: null, payload: { hasNext: false, nextCursor: '', items: [
    trade('cash-buy', 'BUY', entryAt, '-500', money('10'), 'local-buy'), fee('cash-buy-fee', 'cash-buy', entryAt),
    trade('cash-sell', 'SELL', exitAt, '495', money('9', 900000000), 'local-sell'), fee('cash-sell-fee', 'cash-sell', exitAt),
  ] } }] };
}

function submittedTarget(f: ReturnType<typeof setup>, status: 'EXECUTION_REPORT_STATUS_CANCELLED' | 'EXECUTION_REPORT_STATUS_NEW' = 'EXECUTION_REPORT_STATUS_CANCELLED') {
  const entry = f.journal.getExecutionSnapshot(f.scenario.id)!; const original = f.journal.getNativeStop(f.scenario.id)!.intent;
  const proof = sandboxTargetEconomics(entry, { lotSize: 10, targetNano: '11000000000', stopNano: '9900000000', tickNano: '10000000',
    commissionRateNano: '3000000', slippageRateNano: '500000' })!;
  const close = f.journal.claimSandboxSessionExit({ scenarioId: f.scenario.id, accountId: 'local-account', entryRequestId: f.order.orderRequestId,
    instrumentId: f.scenario.instrumentId, lots: 5, stopId: 'local-stop', generation: 0 }, now, 'target', proof).intent;
  const closeKey = sandboxCloseKey(close);
  f.journal.observeNativeStop(f.scenario.id, { status: 'STOP_ORDER_STATUS_CANCELED', childOrderId: null }, nativeStopKey(original));
  f.journal.claimSandboxSessionSubmission(f.scenario.id, f.journal.getSandboxLossLedger().revision, proof.targetNano, now, closeKey, proof);
  const zero: SandboxOrderSnapshot = { brokerOrderId: 'synthetic-zero-target', executionStatus: status,
    terminal: status !== 'EXECUTION_REPORT_STATUS_NEW', lotsExecuted: 0, grossNano: '0', commissionNano: '1000000000', stages: [] };
  f.journal.recordCloseSellObservation(closeKey, zero, now);
  const zeroPayload = (feeUnits = '1') => ({ ...f.childPayload(0, status), orderId: zero.brokerOrderId, orderRequestId: close.requestId,
    executedCommission: { currency: 'rub', units: feeUnits, nano: 0 }, serviceCommission: { currency: 'rub', units: '0', nano: 0 } });
  return { close, closeKey, zero, zeroPayload };
}
function restoredTarget(f: ReturnType<typeof setup>, markRestored = true) {
  const { close, closeKey, zero, zeroPayload } = submittedTarget(f);
  const claim = f.journal.claimProtectionRestore(closeKey, f.journal.getSandboxLossLedger().revision, { accountId: 'local-account',
    instrumentId: f.scenario.instrumentId, lots: 5, lotSize: 10, positionUnits: '50', checkedAt: now.toISOString(), noActiveOrders: true,
    noOtherActiveStops: true, stop: { status: 'STOP_ORDER_STATUS_CANCELED', childOrderId: null } }, now);
  const key = nativeStopKey(claim.record.intent);
  f.journal.acknowledgeNativeStop(f.scenario.id, key.requestId, 'synthetic-restored-stop', key);
  const current = nativeStopKey(f.journal.getNativeStop(f.scenario.id)!.intent);
  f.journal.observeNativeStop(f.scenario.id, { status: 'STOP_ORDER_STATUS_ACTIVE', childOrderId: null }, current);
  if (markRestored) f.journal.markProtectionRestored(closeKey, current, now);
  f.client.getSandboxOrderState.mockImplementation(async (_account: string, request: string) => {
    if (request === f.order.orderRequestId) return f.entryPayload();
    if (request === close.requestId) return zeroPayload('2');
    throw new Error('Synthetic unknown request');
  });
  f.client.getSandboxStopOrders.mockResolvedValue({ stopOrders: [{ ...f.stopPayload().stopOrders[0], stopOrderId: current.brokerStopId!,
    status: 'STOP_ORDER_STATUS_EXECUTED', exchangeOrderId: 'local-child', createDate: now.toISOString() }] });
  f.client.getSandboxChildOrderState.mockResolvedValue({ ...f.childPayload(),
    stages: f.childPayload().stages.map(stage => ({ ...stage, executionTime: now.toISOString() })) });
  return { close, closeKey, current, zero, zeroPayload };
}

describe('Read-only sandbox sale evidence and durable accounting', () => {
  it('proves exact cash only with the immutable winning baseline and fully owned unfiltered broker operations', async () => {
    const f = setup(5, true, false, true);
    f.client.getSandboxPositions.mockResolvedValue({ ...f.flat(), money: [{ currency: 'rub', units: '991', nano: 0 }] });
    f.client.getSandboxCashOperationsWindow.mockImplementation(async (account: string, from: string, to: string) => ownedCashWindow(account, from, to));
    const result = await f.exits.reconcile('local-account', f.scenario.id, now);
    expect(result).toMatchObject({ complete: true, cashProven: true, netPnlNano: '-9000000000',
      cashReconciliation: { status: 'reconciled', deltaNano: '-9000000000', expectedDeltaNano: '-9000000000' } });
    expect(f.journal.listSandboxResults()[0]?.cashProven).toBe(true);
    expect(f.journal.getSandboxCashObservations(f.scenario.id)).toHaveLength(1);
    f.noWrites();
  });

  it.each(['missing-operations', 'foreign-deposit', 'offsetting-funding', 'late-fee'])
    ('keeps %s cash evidence incomplete or mismatched without funding, retry or a tolerance', async condition => {
      const f = setup(5, true, false, true);
      f.client.getSandboxPositions.mockResolvedValue({ ...f.flat(), money: [{ currency: 'rub', units: condition === 'foreign-deposit' ? '992' : '991', nano: 0 }] });
      f.client.getSandboxCashOperationsWindow.mockImplementation(async (account: string, from: string, to: string) => {
        if (condition === 'missing-operations') throw new Error('synthetic private transport failure');
        const window = ownedCashWindow(account, from, to);
        if (condition === 'offsetting-funding') {
          const funding = (id: string, type: string, units: string) => ({ id, type, brokerAccountId: account, date: exitAt,
            state: 'OPERATION_STATE_EXECUTED', payment: { currency: 'rub', units, nano: 0 } });
          (window.pages[0]!.payload.items as unknown[]).push(funding('foreign-input', 'OPERATION_TYPE_INPUT', '1'),
            funding('foreign-output', 'OPERATION_TYPE_OUTPUT', '-1'));
        }
        return window;
      });
      if (condition === 'late-fee') f.client.getSandboxOrderState.mockResolvedValue({ ...f.entryPayload(),
        executedCommission: { currency: 'rub', units: '2', nano: 500000000 } });
      const result = await f.exits.reconcile('local-account', f.scenario.id, now);
      expect(result).toMatchObject({ complete: true, cashProven: false,
        cashReconciliation: { status: ['foreign-deposit', 'late-fee'].includes(condition) ? 'mismatch' : 'incomplete' } });
      expect(f.journal.isExecutionKilled()).toBe(true); f.noWrites();
    });

  it.each(['kill', 'prepared', 'selection', 'late-fee'])
    ('rejects a %s change while the full account cursor read is pending', async condition => {
      const f = setup(5, true, false, true);
      f.client.getSandboxPositions.mockResolvedValue({ ...f.flat(), money: [{ currency: 'rub', units: '991', nano: 0 }] });
      f.client.getSandboxCashOperationsWindow.mockImplementation(async (account: string, from: string, to: string) => {
        if (condition === 'kill') f.journal.setExecutionKilled(true);
        if (condition === 'prepared') f.journal.setRuntimeState(sandboxBootstrapKey, '{}');
        if (condition === 'selection') f.journal.setRuntimeState('trading.selection.v1', '{"revision":99}');
        if (condition === 'late-fee') f.journal.recordExecutionReconciliation(f.scenario.id,
          { ...f.journal.getExecutionSnapshot(f.scenario.id)!, commissionNano: '3000000000' });
        return ownedCashWindow(account, from, to);
      });
      await expect(f.exits.reconcile('local-account', f.scenario.id, now)).rejects.toThrow('prior risk remains reserved');
      expect(f.journal.getSandboxCashObservations(f.scenario.id)).toEqual([]);
      expect(f.journal.listSandboxResults()[0]?.cashProven).toBe(false);
      f.noWrites();
    });
  it('confirms known child, full sale, fees and empty account without any broker writes or reserve release', async () => {
    const f = setup(); f.journal.setExecutionKilled(true);
    expect(await f.exits.reconcile('local-account', f.scenario.id, now)).toMatchObject({ soldLots: 5, remainingLots: 0, fullySold: true,
      netPnlNano: '-9000000000', complete: true, flatConfirmedAt: now.toISOString(), closedAt: exitAt });
    expect(f.client.getSandboxChildOrderState).toHaveBeenCalledWith('local-account', 'local-child');
    expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('accepted'); expect(f.journal.isExecutionKilled()).toBe(true);
    const restarted = new ScenarioJournal(f.path);
    expect(restarted.listSandboxResults()[0]).toMatchObject({ scenarioId: f.scenario.id, netPnlNano: '-9000000000', complete: true });
    // Full result remains blocking until actual-loss/exit policy is completed.
    expect(restarted.listRecoverableExecutionOrders(5)).toHaveLength(1); f.noWrites();
  });
  it('accounts for the actual terminal partial BUY volume, not the originally requested lots', async () => {
    const f = setup(2);
    expect(await f.exits.reconcile('local-account', f.scenario.id, now)).toMatchObject({ soldLots: 2, remainingLots: 0, complete: true });
    f.noWrites();
  });
  it.each(['EXECUTION_REPORT_STATUS_NEW', 'EXECUTION_REPORT_STATUS_CANCELLED'] as const)
    ('keeps target zero SELL %s out of the final exit row and binds its close key', async status => {
    const f = setup(5, false, true); const target = submittedTarget(f, status);
    const observe = vi.spyOn(f.journal, 'recordCloseSellObservation'); const ack = vi.spyOn(f.journal, 'acknowledgeSandboxSessionExit');
    f.client.getSandboxStopOrders.mockResolvedValue({ stopOrders: [{ ...f.stopPayload().stopOrders[0], status: 'STOP_ORDER_STATUS_CANCELED' }] });
    f.client.getSandboxOrderState.mockImplementation(async (_account: string, request: string) => request === f.order.orderRequestId
      ? f.entryPayload() : target.zeroPayload());
    expect(await f.exits.reconcile('local-account', f.scenario.id, now)).toMatchObject({ soldLots: 0, complete: false, netPnlNano: null });
    expect(observe).toHaveBeenCalledWith(target.closeKey, target.zero, now);
    expect(ack).toHaveBeenCalledWith(f.scenario.id, target.close.requestId, target.zero.brokerOrderId, target.closeKey);
    expect(f.journal.getSandboxExitEvidence(f.scenario.id)).toBeNull(); expect(f.journal.listSandboxResults()).toEqual([]);
    expect(f.client.getSandboxPositions).not.toHaveBeenCalled(); f.noWrites();
  });
  it('preserves zero NEW→terminal evidence without blocking later protection restoration', async () => {
    const f = setup(5, false, true); const target = submittedTarget(f, 'EXECUTION_REPORT_STATUS_NEW');
    f.client.getSandboxStopOrders.mockResolvedValue({ stopOrders: [{ ...f.stopPayload().stopOrders[0], status: 'STOP_ORDER_STATUS_CANCELED' }] });
    f.client.getSandboxOrderState.mockImplementation(async (_account: string, request: string) => request === f.order.orderRequestId
      ? f.entryPayload() : target.zeroPayload());
    await f.exits.reconcile('local-account', f.scenario.id, now);
    f.client.getSandboxOrderState.mockImplementation(async (_account: string, request: string) => request === f.order.orderRequestId
      ? f.entryPayload() : { ...target.zeroPayload(), executionReportStatus: 'EXECUTION_REPORT_STATUS_CANCELLED' });
    expect(await f.exits.reconcile('local-account', f.scenario.id, now)).toMatchObject({ complete: false });
    expect(f.journal.getSandboxSessionExit(f.scenario.id)?.sellSnapshot?.terminal).toBe(true);
    expect(f.journal.getSandboxExitEvidence(f.scenario.id)).toBeNull(); f.noWrites();
  });
  it('binds the target close key even when the native stop wins during cancellation', async () => {
    const f = setup(5, false, true); const entry = f.journal.getExecutionSnapshot(f.scenario.id)!;
    const proof = sandboxTargetEconomics(entry, { lotSize: 10, targetNano: '11000000000', stopNano: '9900000000', tickNano: '10000000',
      commissionRateNano: '3000000', slippageRateNano: '500000' })!;
    const close = f.journal.claimSandboxSessionExit({ scenarioId: f.scenario.id, accountId: 'local-account', entryRequestId: f.order.orderRequestId,
      instrumentId: f.scenario.instrumentId, lots: 5, stopId: 'local-stop', generation: 0 }, now, 'target', proof).intent;
    const record = vi.spyOn(f.journal, 'recordSandboxExitEvidence');
    f.client.getSandboxStopOrders.mockResolvedValue({ stopOrders: [{ ...f.stopPayload().stopOrders[0], status: 'STOP_ORDER_STATUS_EXECUTED', exchangeOrderId: 'local-child' }] });
    expect(await f.exits.reconcile('local-account', f.scenario.id, now)).toMatchObject({ complete: true, netPnlNano: '-9000000000' });
    expect(record.mock.calls.every(call => JSON.stringify(call[5]) === JSON.stringify(sandboxCloseKey(close)))).toBe(true); f.noWrites();
  });
  it.each([true, false])('reads a generation-1 child during restored/restore-claimed phase (%s) and deducts late archive fees once', async markRestored => {
    const f = setup(5, false, true); const restored = restoredTarget(f, markRestored);
    const record = vi.spyOn(f.journal, 'recordSandboxExitEvidence');
    expect(await f.exits.reconcile('local-account', f.scenario.id, now)).toMatchObject({ complete: true, netPnlNano: '-11000000000' });
    expect(f.client.getSandboxOrderState).toHaveBeenCalledWith('local-account', restored.close.requestId);
    expect(f.journal.getSandboxFailedCloseCosts(f.scenario.id)).toEqual({ commissionNano: '2000000000', attempts: 1 });
    expect(record.mock.calls.every(call => JSON.stringify(call[4]) === JSON.stringify(restored.current))).toBe(true);
    expect(f.journal.listSandboxResults()[0]?.netPnlNano).toBe('-11000000000');
    expect(await f.exits.reconcile('local-account', f.scenario.id, now)).toMatchObject({ netPnlNano: '-11000000000' }); f.noWrites();
  });
  it('does not let a captured old generation record an exit for restored protection', async () => {
    const f = setup(5, false, true); const old = f.journal.getNativeStop(f.scenario.id)!; restoredTarget(f);
    const read = vi.spyOn(f.journal, 'getNativeStop').mockReturnValue(old);
    f.client.getSandboxStopOrders.mockResolvedValue({ stopOrders: [{ ...f.stopPayload().stopOrders[0], status: 'STOP_ORDER_STATUS_EXECUTED', exchangeOrderId: 'local-child' }] });
    await expect(f.exits.reconcile('local-account', f.scenario.id, now)).rejects.toThrow('not confirmed');
    read.mockRestore(); expect(f.journal.getSandboxExitEvidence(f.scenario.id)).toBeNull(); f.noWrites();
  });
  it.each(['wrong-request', 'unknown-fees', 'nonzero-fill'])('rejects refreshed archived %s without a new broker write', async condition => {
    const f = setup(5, false, true); const restored = restoredTarget(f);
    f.client.getSandboxOrderState.mockImplementation(async (_account: string, request: string) => {
      if (request === f.order.orderRequestId) return f.entryPayload();
      const payload = restored.zeroPayload('2');
      if (condition === 'wrong-request') return { ...payload, orderRequestId: 'synthetic-foreign' };
      if (condition === 'unknown-fees') return { ...payload, serviceCommission: undefined };
      return { ...f.childPayload(), orderId: restored.zero.brokerOrderId, orderRequestId: restored.close.requestId };
    });
    await expect(f.exits.reconcile('local-account', f.scenario.id, now)).rejects.toThrow('not confirmed');
    expect(f.journal.getSandboxExitEvidence(f.scenario.id)).toBeNull(); f.noWrites();
  });
  it.each([['EXECUTION_REPORT_STATUS_CANCELLED', 2], ['EXECUTION_REPORT_STATUS_PARTIALLYFILL', 2], ['EXECUTION_REPORT_STATUS_NEW', 0]])
    ('keeps incomplete child %s/%s without inventing profit or empty holdings', async (status, sold) => {
      const f = setup(); f.client.getSandboxChildOrderState.mockResolvedValue(f.childPayload(Number(sold), String(status)));
      expect(await f.exits.reconcile('local-account', f.scenario.id, now)).toMatchObject({ soldLots: Number(sold), remainingLots: 5 - Number(sold),
        fullySold: false, netPnlNano: null, complete: false, flatConfirmedAt: null });
      expect(f.client.getSandboxPositions).not.toHaveBeenCalled(); expect(f.journal.isExecutionKilled()).toBe(true); f.noWrites();
    });
  it('does not confirm profit when full sale has missing fees', async () => {
    const f = setup(); f.client.getSandboxChildOrderState.mockResolvedValue({ ...f.childPayload(), serviceCommission: undefined });
    expect(await f.exits.reconcile('local-account', f.scenario.id, now)).toMatchObject({ fullySold: true, flatConfirmedAt: now.toISOString(), netPnlNano: null, complete: false });
    expect(f.journal.listSandboxResults()[0]?.complete).toBe(false); f.noWrites();
  });
  it.each(['wrong-account', 'wrong-child', 'unknown-child', 'foreign-stop', 'unavailable'])('rejects %s without losing earlier evidence', async failure => {
    const f = setup(); await f.exits.reconcile('local-account', f.scenario.id, now);
    const before = f.journal.getSandboxExitEvidence(f.scenario.id);
    if (failure === 'wrong-child') f.client.getSandboxChildOrderState.mockResolvedValue({ ...f.childPayload(), orderId: 'foreign' });
    if (failure === 'unknown-child') f.client.getSandboxStopOrders.mockResolvedValue({ stopOrders: [{ ...f.stopPayload().stopOrders[0], exchangeOrderId: 'changed-child' }] });
    if (failure === 'foreign-stop') f.client.getSandboxStopOrders.mockResolvedValue({ stopOrders: [...f.stopPayload().stopOrders,
      { stopOrderId: 'foreign', status: 'STOP_ORDER_STATUS_ACTIVE' }] });
    if (failure === 'unavailable') f.client.getSandboxChildOrderState.mockRejectedValue(new Error('private broker payload'));
    await expect(f.exits.reconcile(failure === 'wrong-account' ? 'other-account' : 'local-account', f.scenario.id, now)).rejects.toThrow('prior risk remains reserved');
    expect(f.journal.getSandboxExitEvidence(f.scenario.id)).toEqual(before); expect(f.journal.isExecutionKilled()).toBe(true); f.noWrites();
  });
  it.each(['holding', 'active-order', 'missing-positions', 'blocked-money', 'second-stop-book'])
    ('does not claim flat after a full SELL when %s contradicts it', async failure => {
      const f = setup(); await f.exits.reconcile('local-account', f.scenario.id, now);
      if (failure === 'holding') f.client.getSandboxPositions.mockResolvedValue({ ...f.flat(), securities: [{}] });
      if (failure === 'active-order') f.client.getSandboxOrders.mockResolvedValue({ orders: [{}] });
      if (failure === 'missing-positions') f.client.getSandboxPositions.mockResolvedValue({});
      if (failure === 'blocked-money') f.client.getSandboxPositions.mockResolvedValue({ ...f.flat(), blocked: [{ currency: 'rub', units: '1', nano: 0 }] });
      if (failure === 'second-stop-book') f.client.getSandboxStopOrders.mockResolvedValueOnce(f.stopPayload()).mockResolvedValue({ stopOrders: [] });
      await expect(f.exits.reconcile('local-account', f.scenario.id, now)).rejects.toThrow('not confirmed');
      expect(f.journal.getSandboxExitEvidence(f.scenario.id)?.flatConfirmedAt).toBeNull();
      expect(f.journal.listSandboxResults()[0]).toMatchObject({ fullySold: true, complete: false }); f.noWrites();
    });
  it('rejects regressed fills and fees transactionally, and recalculates late entry/exit fees rather than freezing favourable net', async () => {
    const f = setup(); await f.exits.reconcile('local-account', f.scenario.id, now);
    const prior = f.journal.getSandboxExitEvidence(f.scenario.id);
    f.client.getSandboxChildOrderState.mockResolvedValue(f.childPayload(2));
    await expect(f.exits.reconcile('local-account', f.scenario.id, now)).rejects.toThrow();
    expect(f.journal.getSandboxExitEvidence(f.scenario.id)).toEqual(prior);
    f.client.getSandboxChildOrderState.mockResolvedValue({ ...f.childPayload(), executedCommission: { currency: 'rub', units: '0', nano: 0 } });
    await expect(f.exits.reconcile('local-account', f.scenario.id, now)).rejects.toThrow();
    expect(f.journal.getSandboxExitEvidence(f.scenario.id)).toEqual(prior);
    f.client.getSandboxChildOrderState.mockResolvedValue({ ...f.childPayload(), executedCommission: { currency: 'rub', units: '2', nano: 500000000 } });
    f.client.getSandboxOrderState.mockResolvedValue({ ...f.entryPayload(), executedCommission: { currency: 'rub', units: '2', nano: 500000000 } });
    expect(await f.exits.reconcile('local-account', f.scenario.id, now)).toMatchObject({ netPnlNano: '-11000000000', complete: true });
    expect(f.journal.listSandboxResults()[0]?.netPnlNano).toBe('-11000000000'); f.noWrites();
  });
  it('computes response from the entry evidence inside the final journal transaction', async () => {
    const f = setup();
    f.client.getSandboxPositions.mockImplementationOnce(async () => {
      f.journal.recordExecutionReconciliation(f.scenario.id, parseSandboxOrderState({ ...f.entryPayload(),
        executedCommission: { currency: 'rub', units: '2', nano: 500000000 } },
      { requestId: f.order.orderRequestId, instrumentId: f.scenario.instrumentId, lots: 5, lotSize: 10 }, now));
      return f.flat();
    });
    expect(await f.exits.reconcile('local-account', f.scenario.id, now)).toMatchObject({ netPnlNano: '-10000000000' }); f.noWrites();
  });
  it('recovery and explicit reconciliation remain read-only; monitor reports complete as a separate count', async () => {
    const f = setup();
    expect((await f.execution.reconcileScenario(f.scenario.id, now)).sandboxExit).toMatchObject({ complete: true });
    expect(await f.execution.recoverOutstanding(20, now)).toMatchObject({ confirmed: 1, unconfirmed: 0 });
    expect(await f.execution.protectOutstanding(now)).toEqual({ active: 0, triggered: 1, closed: 1, unconfirmed: 0, morePending: false }); f.noWrites();
  });
  it('Mini App exposes only scoped sandbox results, not broker identities, fills or live PnL', async () => {
    const f = setup(); await f.exits.reconcile('local-account', f.scenario.id, now);
    const view = buildMiniAppView(f.config, { isPaused: () => false, getLatestReport: () => null }, f.execution, f.journal, now);
    expect(view.sandboxResults[0]).toMatchObject({ netPnl: '−9,00 ₽', remainingLots: 0, complete: true });
    expect(view.execution.actualPnlRub).toBeNull(); expect(view.execution.lossMonitorReady).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/local-account|local-child|local-buy|readonly-local|isolated-local|local-instrument/); f.noWrites();
  });
  it.each(['disabled', 'same-token', 'flag-off'])('does not even read broker data when %s', async condition => {
    const f = setup();
    if (condition === 'disabled') f.config.execution.mode = 'disabled';
    if (condition === 'same-token') f.config.execution.token = f.config.token!;
    if (condition === 'flag-off') f.config.execution.sandboxProtectionEnabled = false;
    await expect(f.exits.reconcile('local-account', f.scenario.id, now)).rejects.toThrow('not enabled');
    expect(f.client.getSandboxChildOrderState).not.toHaveBeenCalled(); expect(f.client.getSandboxStopOrders).not.toHaveBeenCalled(); f.noWrites();
  });
});

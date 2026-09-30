import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { parseSandboxOrderState } from './sandbox-order-state.js';
import { SandboxExitService } from './sandbox-exit-service.js';
import { SandboxLossGuard } from './sandbox-loss-guard.js';
import { ExecutionService } from './execution-service.js';
import { moscowLossDay } from './sandbox-loss-policy.js';
import { buildMiniAppView } from '../web/mini-app-view.js';

const now = new Date('2026-10-01T08:00:00.000Z');
const entryAt = '2026-10-01T07:55:00.000Z'; const stopAt = '2026-10-01T07:58:00.000Z';
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup(open = true) {
  const dir = mkdtempSync(join(tmpdir(), 'trading-loss-')); dirs.push(dir);
  const path = join(dir, 'journal.sqlite'); const journal = new ScenarioJournal(path);
  const config = loadConfig({ T_INVEST_TOKEN: 'local-read', T_INVEST_TRADING_TOKEN: 'local-isolated',
    T_INVEST_EXECUTION_MODE: 'sandbox', T_INVEST_SANDBOX_ACCOUNT_ID: 'local-account',
    T_INVEST_SANDBOX_PROTECTION_ENABLED: 'true', T_INVEST_SANDBOX_LOSS_GUARD_ENABLED: 'true' });
  const scenario = journal.record({ observedAt: entryAt, strategy: 'intraday', instrumentId: 'local-instrument',
    input: { side: 'long', entryPrice: 10, stopPrice: 9.9, targetPrice: 11, lotSize: 10, slippageRate: 0.0005 },
    decision: 'candidate', blockers: [], warnings: [], snapshot: { tradePlan: { lots: 5, positionRub: 500, totalRiskRub: 9 } } });
  const order = journal.queueExecution({ scenarioId: scenario.id, mode: 'sandbox', instrumentId: scenario.instrumentId, side: 'long',
    lots: 5, limitPrice: 10, estimatedRiskRub: 9, orderRequestId: randomUUID() });
  const entryPayload = () => ({ orderId: 'local-entry', orderRequestId: order.orderRequestId, instrumentUid: scenario.instrumentId,
    direction: 'ORDER_DIRECTION_BUY', orderType: 'ORDER_TYPE_LIMIT', currency: 'rub', lotsRequested: '5', lotsExecuted: '5',
    executionReportStatus: 'EXECUTION_REPORT_STATUS_FILL', stages: [{ tradeId: 'local-buy', quantity: '5',
      price: { currency: 'rub', units: '10', nano: 0 }, executionTime: entryAt }],
    executedCommission: { currency: 'rub', units: '1', nano: 500000000 }, serviceCommission: { currency: 'rub', units: '0', nano: 500000000 } });
  const childPayload = (sold = 5, status = 'EXECUTION_REPORT_STATUS_FILL') => ({ orderId: 'local-child', instrumentUid: scenario.instrumentId,
    direction: 'ORDER_DIRECTION_SELL', orderType: 'ORDER_TYPE_LIMIT', currency: 'rub', lotsRequested: '5', lotsExecuted: String(sold),
    executionReportStatus: status, stages: sold ? [{ tradeId: 'local-sell', quantity: String(sold),
      price: { currency: 'rub', units: '9', nano: 900000000 }, executionTime: '2026-10-01T07:59:00.000Z' }] : [],
    executedCommission: { currency: 'rub', units: '1', nano: 500000000 }, serviceCommission: { currency: 'rub', units: '0', nano: 500000000 } });
  const stopPayload = (executed = false) => ({ stopOrders: [{ stopOrderId: 'local-stop',
    status: executed ? 'STOP_ORDER_STATUS_EXECUTED' : 'STOP_ORDER_STATUS_ACTIVE', ...(executed ? { exchangeOrderId: 'local-child' } : {}),
    instrumentUid: scenario.instrumentId, currency: 'rub', direction: 'STOP_ORDER_DIRECTION_SELL', orderType: 'STOP_ORDER_TYPE_STOP_LIMIT',
    lotsRequested: '5', stopPrice: { currency: 'rub', units: '9', nano: 900000000 }, price: { currency: 'rub', units: '9', nano: 900000000 }, createDate: stopAt }] });
  const flat = () => ({ accountId: 'local-account', limitsLoadingInProgress: false, securities: [], futures: [], options: [],
    money: [{ currency: 'rub', units: '1000', nano: 0 }], blocked: [] });
  const held = (balance = 50, blocked = 0) => ({ ...flat(), securities: [{ instrumentUid: scenario.instrumentId,
    instrumentType: 'share', exchangeBlocked: false, balance: String(balance), blocked: String(blocked) }] });
  const bid = () => ({ instrumentUid: scenario.instrumentId, orderbookTs: now.toISOString(),
    bids: [{ price: { units: '9', nano: 900000000 }, quantity: '5' }], asks: [{ price: { units: '10', nano: 0 }, quantity: '5' }] });
  if (open) {
    journal.claimExecution(scenario.id, '42'); journal.markExecutionAccepted(scenario.id, 'local-entry', 'accepted', 5);
    journal.recordExecutionReconciliation(scenario.id, parseSandboxOrderState(entryPayload(), {
      requestId: order.orderRequestId, instrumentId: scenario.instrumentId, lots: 5, lotSize: 10 }, now));
    const id = randomUUID(); journal.claimNativeStop({ scenarioId: scenario.id, accountId: 'local-account', requestId: id,
      instrumentId: scenario.instrumentId, entryRequestId: order.orderRequestId, lots: 5, stopNano: '9900000000', limitNano: '9900000000',
      createdAt: stopAt, brokerStopId: null }); journal.acknowledgeNativeStop(scenario.id, id, 'local-stop');
    journal.observeNativeStop(scenario.id, { status: 'STOP_ORDER_STATUS_ACTIVE', childOrderId: null });
  }
  const client = { getSandboxOrderState: vi.fn().mockImplementation(async () => entryPayload()),
    getSandboxChildOrderState: vi.fn().mockImplementation(async () => childPayload()),
    getSandboxStopOrders: vi.fn().mockImplementation(async () => open ? stopPayload() : { stopOrders: [] }),
    getSandboxPositions: vi.fn().mockImplementation(async () => open ? held() : flat()), getSandboxOrders: vi.fn().mockResolvedValue({ orders: [] }),
    postLimitOrder: vi.fn(), postSandboxStopLimit: vi.fn(), openSandboxAccount: vi.fn(), sandboxPayIn: vi.fn() };
  const market = { getOrderBook: vi.fn().mockImplementation(async () => bid()), getTradingStatus: vi.fn().mockResolvedValue({
    instrumentUid: scenario.instrumentId, tradingStatus: 'SECURITY_TRADING_STATUS_NORMAL_TRADING', apiTradeAvailableFlag: true, limitOrderAvailableFlag: true }) };
  const exits = new SandboxExitService(config, client, journal); const guard = new SandboxLossGuard(config, client, market, exits, journal);
  const noWrites = () => { for (const fn of [client.postLimitOrder, client.postSandboxStopLimit, client.openSandboxAccount, client.sandboxPayIn]) expect(fn).not.toHaveBeenCalled(); };
  return { path, journal, config, scenario, order, entryPayload, childPayload, stopPayload, flat, held, bid, client, market, guard, noWrites };
}

describe('Read-only sandbox loss guard', () => {
  it('confirms zero only from a strictly empty broker account, without clearing kill', async () => {
    const f = setup(false);
    expect(await f.guard.assess('local-account', now)).toMatchObject({ status: 'ok', closedLossNano: '0', openLossNano: '0', maxTradeLossNano: '0' });
    expect(new ScenarioJournal(f.path).getSandboxLossProof()?.status).toBe('ok'); expect(f.journal.isExecutionKilled()).toBe(true); f.noWrites();
  });
  it('marks the actual remaining position without freeing reservations', async () => {
    const f = setup();
    expect(await f.guard.assess('local-account', now)).toMatchObject({ status: 'ok', closedLossNano: '0', openLossNano: '8740000000' });
    expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('accepted'); expect(f.journal.isExecutionKilled()).toBe(true); f.noWrites();
  });
  it('kills at the approved trade loss threshold', async () => {
    const f = setup(); f.journal.setExecutionKilled(false);
    f.market.getOrderBook.mockResolvedValue({ ...f.bid(), bids: [{ price: { units: '9', nano: 500000000 }, quantity: '5' }] });
    expect(await f.guard.assess('local-account', now)).toMatchObject({ status: 'limit', openLossNano: '28670000000' });
    expect(f.journal.isExecutionKilled()).toBe(true); f.noWrites();
  });
  it('reconciles the actual closed pair and late fees, without forecast slippage twice', async () => {
    const f = setup(); f.client.getSandboxStopOrders.mockResolvedValue(f.stopPayload(true)); f.client.getSandboxPositions.mockResolvedValue(f.flat());
    expect(await f.guard.assess('local-account', now)).toMatchObject({ status: 'ok', closedLossNano: '9000000000', openLossNano: '0' });
    f.client.getSandboxOrderState.mockResolvedValue({ ...f.entryPayload(), executedCommission: { currency: 'rub', units: '2', nano: 500000000 } });
    expect(await f.guard.assess('local-account', now)).toMatchObject({ status: 'ok', closedLossNano: '10000000000' }); f.noWrites();
  });
  it('marks partial nonterminal sale only when its known child is still in active orders', async () => {
    const f = setup(); f.client.getSandboxStopOrders.mockResolvedValue(f.stopPayload(true));
    f.client.getSandboxChildOrderState.mockResolvedValue(f.childPayload(2, 'EXECUTION_REPORT_STATUS_PARTIALLYFILL'));
    f.client.getSandboxPositions.mockResolvedValue(f.held(0, 30)); f.client.getSandboxOrders.mockResolvedValue({ orders: [{ orderId: 'local-child' }] });
    expect(await f.guard.assess('local-account', now)).toMatchObject({ status: 'ok', openLossNano: '10050000000' });
    f.client.getSandboxOrders.mockResolvedValue({ orders: [] });
    expect(await f.guard.assess('local-account', now)).toMatchObject({ status: 'incomplete', openLossNano: null }); f.noWrites();
  });
  it.each(['entry-fee', 'nonterminal-buy', 'wrong-stop', 'foreign-stop', 'unknown-position', 'unexplained-blocked', 'foreign-order', 'stale', 'thin-book', 'market-down', 'broker-down', 'terminal-partial'])
    ('blocks new entries with unknown loss on %s', async failure => {
      const f = setup(); f.journal.setExecutionKilled(false);
      if (failure === 'entry-fee') f.client.getSandboxOrderState.mockResolvedValue({ ...f.entryPayload(), serviceCommission: undefined });
      if (failure === 'nonterminal-buy') f.client.getSandboxOrderState.mockResolvedValue({ ...f.entryPayload(), executionReportStatus: 'EXECUTION_REPORT_STATUS_PARTIALLYFILL' });
      if (failure === 'wrong-stop') f.client.getSandboxStopOrders.mockResolvedValue({ stopOrders: [] });
      if (failure === 'foreign-stop') f.client.getSandboxStopOrders.mockResolvedValue({ stopOrders: [...f.stopPayload().stopOrders, { stopOrderId: 'other', status: 'STOP_ORDER_STATUS_ACTIVE' }] });
      if (failure === 'unknown-position') f.client.getSandboxPositions.mockResolvedValue({});
      if (failure === 'unexplained-blocked') f.client.getSandboxPositions.mockResolvedValue(f.held(20, 30));
      if (failure === 'foreign-order') f.client.getSandboxOrders.mockResolvedValue({ orders: [{ orderId: 'other' }] });
      if (failure === 'stale') f.market.getOrderBook.mockResolvedValue({ ...f.bid(), orderbookTs: '2026-10-01T07:59:00Z' });
      if (failure === 'thin-book') f.market.getOrderBook.mockResolvedValue({ ...f.bid(), bids: [] });
      if (failure === 'market-down') f.market.getOrderBook.mockRejectedValue(new Error('private market payload'));
      if (failure === 'broker-down') f.client.getSandboxPositions.mockRejectedValue(new Error('private broker payload'));
      if (failure === 'terminal-partial') { f.client.getSandboxStopOrders.mockResolvedValue(f.stopPayload(true)); f.client.getSandboxChildOrderState.mockResolvedValue(f.childPayload(2, 'EXECUTION_REPORT_STATUS_CANCELLED')); }
      expect(await f.guard.assess('local-account', now)).toMatchObject({ status: 'incomplete', closedLossNano: null, openLossNano: null, maxTradeLossNano: null });
      expect(f.journal.isExecutionKilled()).toBe(true); expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('accepted'); f.noWrites();
    });
  it('rejects a journal mutation between ledger capture and valuation', async () => {
    const f = setup(); f.market.getOrderBook.mockImplementation(async () => {
      f.journal.recordExecutionReconciliation(f.scenario.id, parseSandboxOrderState({ ...f.entryPayload(),
        executedCommission: { currency: 'rub', units: '2', nano: 500000000 } },
      { requestId: f.order.orderRequestId, instrumentId: f.scenario.instrumentId, lots: 5, lotSize: 10 }, now)); return f.bid();
    });
    expect(await f.guard.assess('local-account', now)).toMatchObject({ status: 'incomplete', openLossNano: null }); f.noWrites();
  });
  it('does not omit overflow or legacy unresolved orders from risk coverage', async () => {
    const f = setup(false);
    for (let i = 0; i < 51; i++) {
      const s = f.journal.record({ observedAt: entryAt, strategy: 'intraday', instrumentId: 'local-instrument',
        input: f.scenario.input, decision: 'candidate', blockers: [], warnings: [], snapshot: {} });
      f.journal.queueExecution({ scenarioId: s.id, mode: 'sandbox', instrumentId: s.instrumentId, side: 'long', lots: 1,
        limitPrice: 10, estimatedRiskRub: 1, orderRequestId: randomUUID() }); f.journal.claimExecution(s.id, '42');
    }
    expect(f.journal.getSandboxLossLedger().morePending).toBe(true);
    expect(await f.guard.assess('local-account', now)).toMatchObject({ status: 'incomplete', closedLossNano: null });
    expect(f.client.getSandboxStopOrders).not.toHaveBeenCalled(); f.noWrites();
  });
  it('does not grant a fresh timestamp to an excessively long broker read batch', async () => {
    const f = setup(false); vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(30_001);
    expect(await f.guard.assess('local-account', now)).toMatchObject({ status: 'incomplete', openLossNano: null }); f.noWrites();
  });
  it('exposes only fresh, account/revision-bound loss amounts and never live PnL', async () => {
    const f = setup(); await f.guard.assess('local-account', now);
    const view = (at = now) => buildMiniAppView(f.config, { isPaused: () => false, getLatestReport: () => null },
      { mode: () => 'sandbox', isKilled: () => true }, f.journal, at);
    expect(view().sandboxLossGuard).toMatchObject({ state: 'ok', closedLoss: '0,00 ₽', estimatedOpenLoss: '8,74 ₽', totalLoss: '8,74 ₽' });
    expect(view().execution.lossMonitorReady).toBe(false);
    expect(JSON.stringify(view())).not.toMatch(/local-account|local-isolated|local-entry|local-stop|proofId|ledgerRevision/);
    expect(view(new Date(now.getTime() + 30_001)).sandboxLossGuard).toMatchObject({ state: 'stale', totalLoss: null });
    f.config.execution.accountId = 'other'; expect(view().sandboxLossGuard).toMatchObject({ state: 'stale', estimatedOpenLoss: null });
    f.config.execution.sandboxLossGuardEnabled = false; expect(view().sandboxLossGuard).toMatchObject({ state: 'off', totalLoss: null }); f.noWrites();
  });
  it.each(['disabled', 'same-token', 'flag-off', 'protection-off', 'wrong-account', 'widened-limit'])
    ('does not read the broker under %s configuration', async condition => {
      const f = setup(); if (condition === 'disabled') f.config.execution.mode = 'disabled';
      if (condition === 'same-token') f.config.execution.token = f.config.token!;
      if (condition === 'flag-off') f.config.execution.sandboxLossGuardEnabled = false;
      if (condition === 'protection-off') f.config.execution.sandboxProtectionEnabled = false;
      if (condition === 'widened-limit') f.config.livePilot.maxDailyLossRub = 61;
      await expect(f.guard.assess(condition === 'wrong-account' ? 'other' : 'local-account', now)).rejects.toThrow('not enabled');
      expect(f.client.getSandboxStopOrders).not.toHaveBeenCalled(); f.noWrites();
    });
});

describe('Sandbox entry requires atomic fresh loss permission', () => {
  function entrySetup() {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
    const f = setup(false); f.journal.setExecutionKilled(false);
    f.market.getOrderBook.mockImplementation(async () => ({ ...f.bid(), orderbookTs: new Date().toISOString(),
      bids: [{ price: { units: '9', nano: 999000000 }, quantity: '100' }], asks: [{ price: { units: '10', nano: 0 }, quantity: '100' }] }));
    const protection = { preflightForEntry: vi.fn().mockResolvedValue(undefined), protect: vi.fn() };
    const guard = { assess: vi.fn().mockImplementation(async () => f.journal.recordSandboxLossAssessment('local-account', f.journal.getSandboxLossLedger().revision,
      { status: 'ok', checkedAt: new Date().toISOString(), day: moscowLossDay(new Date()), closedLossNano: '0', openLossNano: '0', maxTradeLossNano: '0' })) };
    const client = { ...f.client, getSandboxAccounts: vi.fn(), postLimitOrder: vi.fn().mockResolvedValue({ brokerOrderId: 'local-rejected',
      executionStatus: 'EXECUTION_REPORT_STATUS_REJECTED', lotsRequested: 5, lotsExecuted: 0 }) };
    const service = new ExecutionService(f.config, f.market, client, f.journal, protection, undefined, guard);
    return { ...f, client, protection, guard, service };
  }
  it('performs a second market check and atomically reserves only with matching current proof', async () => {
    const f = entrySetup(); expect((await f.service.submitScenario(f.scenario.id, '42', now)).order.status).toBe('failed');
    expect(f.market.getOrderBook).toHaveBeenCalledTimes(2); expect(f.guard.assess).toHaveBeenCalledOnce();
    expect(f.client.postLimitOrder).toHaveBeenCalledOnce(); expect(f.client.openSandboxAccount).not.toHaveBeenCalled();
  });
  it('uses the actual confirmation day when preflight crosses Moscow midnight', async () => {
    const f = entrySetup(); const start = new Date('2026-10-01T20:59:55.000Z'); const after = new Date('2026-10-01T21:00:05.000Z');
    vi.setSystemTime(start);
    const scenario = f.journal.record({ observedAt: start.toISOString(), strategy: 'intraday', instrumentId: f.scenario.instrumentId,
      input: f.scenario.input, decision: 'candidate', blockers: [], warnings: [], snapshot: f.scenario.snapshot });
    const assess = f.guard.assess.getMockImplementation()!;
    f.guard.assess.mockImplementation(async () => { vi.setSystemTime(after); return assess(); });
    const claim = vi.spyOn(f.journal, 'claimExecution');
    await f.service.submitScenario(scenario.id, '42', start);
    expect(claim).toHaveBeenCalledWith(scenario.id, '42', expect.objectContaining({ now: after.toISOString(),
      from: '2026-10-01T21:00:00.000Z', to: '2026-10-02T21:00:00.000Z' }));
    expect(f.client.postLimitOrder).toHaveBeenCalledOnce();
  });
  it.each(['stale-proof', 'expired-candidate', 'revision-race', 'incomplete', 'changed-market', 'stale-market'])
    ('never sends a broker entry after %s', async condition => {
      const f = entrySetup(); const assess = f.guard.assess.getMockImplementation()!;
      f.guard.assess.mockImplementation(async () => {
        const p = await assess();
        if (condition === 'stale-proof') vi.setSystemTime(new Date(now.getTime() + 30_001));
        if (condition === 'expired-candidate') vi.setSystemTime(new Date(now.getTime() + 6 * 60_000));
        if (condition === 'revision-race') f.journal.setRuntimeState('execution.sandbox_ledger_revision', String(Number(p.ledgerRevision) + 1));
        return condition === 'incomplete' ? { ...p, status: 'incomplete' } : p;
      });
      if (condition === 'changed-market') f.market.getTradingStatus.mockResolvedValueOnce({ instrumentUid: f.scenario.instrumentId,
        tradingStatus: 'SECURITY_TRADING_STATUS_NORMAL_TRADING', apiTradeAvailableFlag: true, limitOrderAvailableFlag: true })
        .mockResolvedValue({ instrumentUid: f.scenario.instrumentId, tradingStatus: 'SECURITY_TRADING_STATUS_NOT_AVAILABLE_FOR_TRADING', apiTradeAvailableFlag: false, limitOrderAvailableFlag: false });
      if (condition === 'stale-market') {
        const fresh = f.market.getOrderBook.getMockImplementation()!;
        f.market.getOrderBook.mockImplementationOnce(fresh).mockImplementation(async () => ({ ...await fresh(), orderbookTs: '2026-10-01T07:59:00Z' }));
      }
      await expect(f.service.submitScenario(f.scenario.id, '42', now)).rejects.toThrow();
      expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('pending'); expect(f.client.postLimitOrder).not.toHaveBeenCalled();
    });
});

describe('Atomic sandbox loss proof and allowance', () => {
  function proof(f: ReturnType<typeof setup>, closed = '0', trade = '0', checkedAt = now.toISOString()) {
    return f.journal.recordSandboxLossAssessment('local-account', f.journal.getSandboxLossLedger().revision,
      { status: 'ok', day: '2026-10-01', checkedAt, closedLossNano: closed, openLossNano: '0', maxTradeLossNano: trade });
  }
  function claim(f: ReturnType<typeof setup>, p: ReturnType<typeof proof>, date = now.toISOString()) {
    return f.journal.claimExecution(f.scenario.id, '42', { from: '2026-09-30T21:00:00Z', to: '2026-10-01T21:00:00Z', now: date,
      maxOrders: 10, maxRiskRub: 60, lossGuard: { proofId: p.proofId, accountId: 'local-account', maxDailyLossRub: 60, maxTradeLossRub: 20 } });
  }
  it('uses proof once and invalidates it across journal instances', () => {
    const f = setup(false); f.journal.setExecutionKilled(false); const p = proof(f);
    expect(claim(f, p).status).toBe('submitting');
    expect(new ScenarioJournal(f.path).getSandboxLossLedger().revision).not.toBe(p.ledgerRevision);
    expect(() => f.journal.recordSandboxLossAssessment('local-account', p.ledgerRevision, p)).toThrow('raced'); f.noWrites();
  });
  it.each(['stale', 'future', 'wrong-account', 'wrong-id', 'new-day', 'unknown-loss', 'limit', 'revision'])
    ('keeps the order pending when proof is %s', condition => {
      const f = setup(false); f.journal.setExecutionKilled(false); let p = proof(f);
      if (condition === 'stale') p = proof(f, '0', '0', '2026-10-01T07:59:29.999Z');
      if (condition === 'future') p = proof(f, '0', '0', '2026-10-01T08:00:00.001Z');
      if (condition === 'wrong-account' || condition === 'wrong-id' || condition === 'unknown-loss' || condition === 'limit') {
        f.journal.setRuntimeState('execution.sandbox_loss_guard', JSON.stringify({ ...p,
          ...(condition === 'wrong-account' ? { accountId: 'other' } : {}), ...(condition === 'wrong-id' ? { proofId: randomUUID() } : {}),
          ...(condition === 'unknown-loss' ? { openLossNano: null } : {}), ...(condition === 'limit' ? { status: 'limit' } : {}) }));
      }
      if (condition === 'revision') f.journal.claimExecution(f.scenario.id, '42');
      expect(() => claim(f, p, condition === 'new-day' ? '2026-10-01T21:00:00Z' : now.toISOString())).toThrow();
      expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe(condition === 'revision' ? 'submitting' : 'pending'); f.noWrites();
    });
  it('permits the exact remaining planned budget but not one nanoruble above it', () => {
    const a = setup(false); a.journal.setExecutionKilled(false); expect(claim(a, proof(a, '51000000000', '19000000000')).status).toBe('submitting');
    const b = setup(false); b.journal.setExecutionKilled(false);
    expect(() => claim(b, proof(b, '51000000001', '19000000000'))).toThrow('allowance'); expect(b.journal.getExecutionByScenario(b.scenario.id)?.status).toBe('pending');
  });
  it.each([['60000000000', '0'], ['0', '20000000000']])('blocks at an actual loss threshold', (closed, trade) => {
    const f = setup(false); f.journal.setExecutionKilled(false); expect(() => claim(f, proof(f, closed, trade))).toThrow('allowance');
  });
  it('late entry fees invalidate the earlier proof, while identical reconciliation does not', () => {
    const f = setup(); const p = proof(f);
    const parse = (payload: unknown) => parseSandboxOrderState(payload, { requestId: f.order.orderRequestId, instrumentId: f.scenario.instrumentId, lots: 5, lotSize: 10 }, now);
    f.journal.recordExecutionReconciliation(f.scenario.id, parse(f.entryPayload()));
    expect(f.journal.getSandboxLossLedger().revision).toBe(p.ledgerRevision);
    f.journal.recordExecutionReconciliation(f.scenario.id, parse({ ...f.entryPayload(), executedCommission: { currency: 'rub', units: '2', nano: 500000000 } }));
    expect(f.journal.getSandboxLossLedger().revision).not.toBe(p.ledgerRevision);
    expect(() => f.journal.recordSandboxLossAssessment('local-account', p.ledgerRevision, p)).toThrow('raced');
  });
  it('a second pending claim cannot reuse proof consumed by another journal instance', () => {
    const f = setup(false); f.journal.setExecutionKilled(false);
    const s = f.journal.record({ observedAt: entryAt, strategy: 'intraday', instrumentId: f.scenario.instrumentId,
      input: f.scenario.input, decision: 'candidate', blockers: [], warnings: [], snapshot: f.scenario.snapshot });
    f.journal.queueExecution({ scenarioId: s.id, mode: 'sandbox', instrumentId: s.instrumentId, side: 'long', lots: 5,
      limitPrice: 10, estimatedRiskRub: 9, orderRequestId: randomUUID() });
    const p = proof(f); claim(f, p);
    expect(() => new ScenarioJournal(f.path).claimExecution(s.id, '42', { from: '2026-09-30T21:00:00Z', to: '2026-10-01T21:00:00Z',
      now: now.toISOString(), maxOrders: 10, maxRiskRub: 60, lossGuard: { proofId: p.proofId, accountId: 'local-account', maxDailyLossRub: 60, maxTradeLossRub: 20 } })).toThrow('allowance');
    expect(f.journal.getExecutionByScenario(s.id)?.status).toBe('pending');
  });
  it('uncertain reconciliation invalidates the prior proof without erasing position evidence', () => {
    const f = setup(); const p = proof(f); f.journal.recordExecutionUncertain(f.scenario.id, 'unavailable');
    expect(f.journal.getSandboxLossProofState().current).toBe(false);
    expect(() => f.journal.recordSandboxLossAssessment('local-account', p.ledgerRevision, p)).toThrow('raced');
    expect(f.journal.getExecutionSnapshot(f.scenario.id)?.lotsExecuted).toBe(5);
  });
  it('a limit or incomplete assessment sets durable kill and a later OK never clears it', () => {
    const f = setup(false); f.journal.setExecutionKilled(false); const p = proof(f);
    f.journal.recordSandboxLossAssessment('local-account', p.ledgerRevision, { ...p, status: 'incomplete', closedLossNano: null, openLossNano: null, maxTradeLossNano: null });
    proof(f); expect(new ScenarioJournal(f.path).isExecutionKilled()).toBe(true);
  });
});

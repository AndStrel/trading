import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ScenarioJournal } from './scenario-journal.js';
import { seedPreparedSandbox } from '../execution/sandbox-prepared.test-helper.js';
import { sandboxBootstrapKey } from '../execution/sandbox-prepared-account.js';
import type { SandboxCashBaseline, SandboxCashObservation } from '../execution/sandbox-cash-reconciliation.js';
import type { SandboxOrderSnapshot } from '../execution/sandbox-order-state.js';
import { nativeStopKey } from '../execution/sandbox-stop-state.js';

const directories: string[] = [];
const claimedAt = '2026-10-03T07:00:00.000Z';
const closedAt = '2026-10-03T07:05:00.000Z';
const observedAt = '2026-10-03T07:06:00.000Z';
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sandbox-cash-journal-'));
  directories.push(directory);
  const path = join(directory, 'journal.sqlite'), journal = new ScenarioJournal(path);
  seedPreparedSandbox(journal, 'synthetic-account');
  journal.setExecutionKilled(false);
  const scenario = journal.record({ observedAt: claimedAt, strategy: 'intraday', instrumentId: 'synthetic-share',
    input: { side: 'long', entryPrice: 100, stopPrice: 99, targetPrice: 105, lotSize: 1, slippageRate: 0.0005 },
    decision: 'candidate', blockers: [], warnings: [], snapshot: { tradePlan: { lots: 1, positionRub: 100, totalRiskRub: 2 } } });
  const order = journal.queueExecution({ scenarioId: scenario.id, mode: 'sandbox', instrumentId: scenario.instrumentId,
    side: 'long', lots: 1, limitPrice: 100, estimatedRiskRub: 2, orderRequestId: '00000000-0000-4000-8000-000000000005' });
  const raw = journal.getRuntimeState(sandboxBootstrapKey)!, generation = journal.getRuntimeState('execution.kill_generation')!;
  const baseline: SandboxCashBaseline = { version: 1, accountId: 'synthetic-account', entryRequestId: order.orderRequestId,
    cashNano: '1000000000000', observedFrom: '2026-10-03T06:59:59.000Z', observedAt: claimedAt,
    ledgerRevision: journal.getSandboxLedgerRevision(), killGeneration: generation, preparedRaw: raw };
  const limits = { from: '2026-10-02T21:00:00.000Z', to: '2026-10-03T21:00:00.000Z', now: claimedAt,
    maxOrders: 3, maxRiskRub: 60, singlePosition: true, preparedSandbox: { raw, accountId: 'synthetic-account', generation }, cashBaseline: baseline };
  const entry: SandboxOrderSnapshot = { brokerOrderId: 'synthetic-buy', executionStatus: 'EXECUTION_REPORT_STATUS_FILL',
    terminal: true, lotsExecuted: 1, grossNano: '100000000000', commissionNano: '1000000000',
    stages: [{ tradeId: 'synthetic-buy-fill', lots: 1, priceNano: '100000000000', executedAt: '2026-10-03T07:00:01.000Z' }] };
  const exit: SandboxOrderSnapshot = { brokerOrderId: 'synthetic-sell', executionStatus: 'EXECUTION_REPORT_STATUS_FILL',
    terminal: true, lotsExecuted: 1, grossNano: '105000000000', commissionNano: '1000000000',
    stages: [{ tradeId: 'synthetic-sell-fill', lots: 1, priceNano: '105000000000', executedAt: closedAt }] };
  function close() {
    journal.claimExecution(scenario.id, 'synthetic-chat', limits);
    journal.markExecutionAccepted(scenario.id, entry.brokerOrderId, 'synthetic', 1);
    journal.recordExecutionReconciliation(scenario.id, entry);
    journal.claimNativeStop({ scenarioId: scenario.id, accountId: baseline.accountId,
      entryRequestId: order.orderRequestId, requestId: '00000000-0000-4000-8000-000000000006', instrumentId: scenario.instrumentId,
      lots: 1, stopNano: '99000000000', limitNano: '99000000000', createdAt: '2026-10-03T07:01:00.000Z', brokerStopId: null });
    journal.acknowledgeNativeStop(scenario.id, '00000000-0000-4000-8000-000000000006', 'synthetic-stop');
    journal.observeNativeStop(scenario.id, { status: 'STOP_ORDER_STATUS_EXECUTED', childOrderId: exit.brokerOrderId });
    const key = nativeStopKey(journal.getNativeStop(scenario.id)!.intent);
    journal.recordSandboxExitEvidence(scenario.id, exit, observedAt, new Date(observedAt), key);
    return key;
  }
  function observation(cashNano = '1003000000000'): SandboxCashObservation {
    return { version: 1, accountId: baseline.accountId, entryRequestId: order.orderRequestId, cashNano,
      observedFrom: observedAt, observedAt, ledgerRevision: journal.getSandboxLedgerRevision(), epoch: journal.getSandboxCashObservationEpoch() };
  }
  return { journal, path, scenario, order, baseline, limits, entry, exit, close, observation };
}

describe('immutable sandbox cash journal', () => {
  it('stores the baseline in the winning claim and never replaces it after restart or unknown acknowledgement', () => {
    const f = fixture(), other = new ScenarioJournal(f.path);
    f.journal.claimExecution(f.scenario.id, 'synthetic-chat', f.limits);
    expect(() => other.claimExecution(f.scenario.id, 'synthetic-chat', { ...f.limits, cashBaseline: { ...f.baseline, cashNano: '999000000000' } })).toThrow();
    f.journal.recordExecutionUncertain(f.scenario.id, 'synthetic timeout');
    const restarted = new ScenarioJournal(f.path);
    expect(restarted.getExecutionByScenario(f.scenario.id)?.status).toBe('submitting');
    expect(restarted.getSandboxCashBaseline(f.scenario.id)).toEqual(f.baseline);
    expect(() => restarted.claimExecution(f.scenario.id, 'synthetic-chat', f.limits)).toThrow();
    expect(restarted.getSandboxCashBaseline(f.scenario.id)).toEqual(f.baseline);
  });

  it.each(['missing', 'revision', 'account', 'request', 'generation', 'prepared', 'expired', 'selection'])
    ('rejects %s cash proof atomically without storing a baseline or changing pending status', condition => {
      const f = fixture(), limits = { ...f.limits, cashBaseline: { ...f.baseline } };
      if (condition === 'missing') delete (limits as Partial<typeof limits>).cashBaseline;
      if (condition === 'revision') limits.cashBaseline.ledgerRevision = '999';
      if (condition === 'account') limits.cashBaseline.accountId = 'synthetic-foreign';
      if (condition === 'request') limits.cashBaseline.entryRequestId = 'synthetic-foreign';
      if (condition === 'generation') limits.cashBaseline.killGeneration = 'synthetic-foreign';
      if (condition === 'prepared') limits.cashBaseline.preparedRaw = '{}';
      if (condition === 'expired') limits.now = '2026-10-03T07:00:30.001Z';
      if (condition === 'selection') limits.cashBaseline.selection = { key: 'synthetic-selection', raw: '{}' };
      expect(() => f.journal.claimExecution(f.scenario.id, 'synthetic-chat', limits)).toThrow();
      expect(f.journal.getSandboxCashBaseline(f.scenario.id)).toBeNull();
      expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('pending');
    });

  it('rolls back the baseline when a later risk gate rejects the same transaction', () => {
    const f = fixture();
    expect(() => f.journal.claimExecution(f.scenario.id, 'synthetic-chat', { ...f.limits, maxRiskRub: 1 })).toThrow('risk');
    expect(f.journal.getSandboxCashBaseline(f.scenario.id)).toBeNull();
  });

  it('retains append-only cash snapshots but never upgrades missing operation coverage to cash proof', () => {
    const f = fixture(), key = f.close();
    expect(f.journal.listSandboxResults()[0]).toMatchObject({ complete: true, cashProven: false });
    f.journal.appendSandboxCashObservation(f.scenario.id, f.observation(), key, undefined, new Date(observedAt));
    expect(f.journal.getSandboxCashReconciliation(f.scenario.id)).toMatchObject({ cashProven: false, status: 'incomplete',
      deltaNano: '3000000000', expectedDeltaNano: '3000000000' });
    f.journal.appendSandboxCashObservation(f.scenario.id, f.observation('1004000000000'), key, undefined, new Date(observedAt));
    expect(f.journal.getSandboxCashObservations(f.scenario.id).map(item => item.cashNano)).toEqual(['1003000000000', '1004000000000']);
    expect(f.journal.listSandboxResults()[0]).toMatchObject({ complete: true, cashProven: false,
      cashReconciliation: { status: 'mismatch', deltaNano: '4000000000', expectedDeltaNano: '3000000000' } });
  });

  it('fences delayed cash reads against a newer fee observation and never rewrites the baseline', () => {
    const f = fixture(), key = f.close(), old = f.observation();
    f.journal.recordExecutionReconciliation(f.scenario.id, { ...f.entry, commissionNano: '2000000000' });
    expect(() => f.journal.appendSandboxCashObservation(f.scenario.id, old, key, undefined, new Date(observedAt))).toThrow('changed');
    expect(f.journal.getSandboxCashObservations(f.scenario.id)).toEqual([]);
    f.journal.appendSandboxCashObservation(f.scenario.id, f.observation(), key, undefined, new Date(observedAt));
    expect(f.journal.getSandboxCashReconciliation(f.scenario.id)).toMatchObject({ cashProven: false, status: 'mismatch',
      expectedDeltaNano: '2000000000', deltaNano: '3000000000' });
    expect(f.journal.getSandboxCashBaseline(f.scenario.id)).toEqual(f.baseline);
  });

  it.each(['identity', 'expired', 'before-flat'])('rejects %s post-flat observations without mutating history', condition => {
    const f = fixture(), key = f.close(), observation = f.observation();
    if (condition === 'identity') observation.entryRequestId = 'synthetic-foreign';
    if (condition === 'before-flat') observation.observedFrom = '2026-10-03T07:05:59.000Z';
    const at = condition === 'expired' ? '2026-10-03T07:06:30.001Z' : observedAt;
    expect(() => f.journal.appendSandboxCashObservation(f.scenario.id, observation, key, undefined, new Date(at))).toThrow();
    expect(f.journal.getSandboxCashObservations(f.scenario.id)).toEqual([]);
  });

  it.each(['kill', 'prepared', 'selection', 'account'])('rejects a %s epoch change during cash reads without relying on the monetary ledger revision', condition => {
    const f = fixture(), key = f.close(), observation = f.observation();
    const revision = f.journal.getSandboxLedgerRevision();
    if (condition === 'kill') f.journal.setExecutionKilled(true);
    if (condition === 'prepared') f.journal.setRuntimeState(sandboxBootstrapKey, '{}');
    if (condition === 'selection') f.journal.setRuntimeState('trading.selection.v1', '{"revision":99}');
    if (condition === 'account') f.journal.setRuntimeState('execution.sandbox_account_id', 'synthetic-foreign');
    expect(f.journal.getSandboxLedgerRevision()).toBe(revision);
    expect(() => f.journal.appendSandboxCashObservation(f.scenario.id, observation, key, undefined, new Date(observedAt))).toThrow('changed');
    expect(f.journal.getSandboxCashObservations(f.scenario.id)).toEqual([]);
  });
});

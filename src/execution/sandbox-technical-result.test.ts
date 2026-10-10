import { describe, expect, it } from 'vitest';
import { technicalAcceptanceFailure, technicalCashAcceptanceReport } from './sandbox-technical-result.js';
describe('Exact cash technical acceptance result', () => {
  it('accepts only complete + current reconciled proof', () => {
    expect(technicalCashAcceptanceReport({ complete: true, netPnlNano: '-122300000', cashProven: true,
      cashReconciliation: { status: 'reconciled' } })).toEqual({ result: 'sandbox-cash-confirmed', flatConfirmed: true,
      cashProven: true, cashStatus: 'reconciled', executionBasedNetRub: '−0,13 ₽', realOrders: false });
  });
  it.each(['mismatch', 'incomplete', undefined, 'private-raw-value'])(
    'refuses complete fills and inconsistent proof with status %s', (status) => {
      expect(technicalCashAcceptanceReport({ complete: true, netPnlNano: '1000000000', cashProven: true,
        cashReconciliation: { status } })).toMatchObject({ result: 'sandbox-cash-incomplete', flatConfirmed: true, cashProven: false });
    });
  it('refuses legacy absence, incomplete fills and missing result', () => {
    for (const value of [undefined, { complete: true, netPnlNano: '0' },
      { complete: false, netPnlNano: null, cashProven: true, cashReconciliation: { status: 'reconciled' } }]) {
      expect(technicalCashAcceptanceReport(value).cashProven).toBe(false);
    }
  });
  it('does not echo malformed amounts or private unknown status/reasons', () => {
    const report = technicalCashAcceptanceReport({ complete: false, netPnlNano: 'private-account',
      cashReconciliation: { status: 'private-token' } });
    expect(report.executionBasedNetRub).toBeNull(); expect(report.cashStatus).toBeNull();
    expect(JSON.stringify(report)).not.toContain('private');
  });
  it('keeps a fixed failure when persisting kill throws with private context', () => {
    const report = technicalAcceptanceFailure('close', () => { throw new Error('/private/token/account/journal.sqlite'); });
    expect(report).toEqual({ result: 'sandbox-test-unconfirmed', stage: 'close', retryEntry: false,
      localJournalKillConfirmed: false, realOrders: false });
    expect(JSON.stringify(report)).not.toContain('private');
  });
  it('confirms local kill only when the explicit persistence/readback succeeds', () => {
    expect(technicalAcceptanceFailure('entry', () => true).localJournalKillConfirmed).toBe(true);
    expect(technicalAcceptanceFailure('entry', () => false).localJournalKillConfirmed).toBe(false);
    expect(technicalAcceptanceFailure('authorization').localJournalKillConfirmed).toBe(false);
  });
  it('cannot reflect arbitrary private diagnostic stage text', () => {
    expect(technicalAcceptanceFailure('private-account')).toMatchObject({ stage: 'unknown', localJournalKillConfirmed: false });
  });
});

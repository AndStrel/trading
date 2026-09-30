import { describe, expect, it } from 'vitest';
import { assertSnapshotProgress, parseSandboxOrderState } from './sandbox-order-state.js';

const now = new Date('2026-09-30T12:00:00.000Z');
const expected = { requestId: 'local-request', instrumentId: 'local-instrument', lots: 5, lotSize: 10 };
function payload(overrides: Record<string, unknown> = {}) {
  return { orderId: 'local-broker-order', orderRequestId: expected.requestId, instrumentUid: expected.instrumentId,
    direction: 'ORDER_DIRECTION_BUY', orderType: 'ORDER_TYPE_LIMIT', currency: 'rub',
    executionReportStatus: 'EXECUTION_REPORT_STATUS_PARTIALLYFILL', lotsRequested: '5', lotsExecuted: '3',
    stages: [{ tradeId: 'trade-1', quantity: '3', price: { currency: 'RUB', units: '100', nano: 123456789 },
      executionTime: now.toISOString() }],
    executedCommission: { currency: 'rub', units: '1', nano: 500000000 },
    serviceCommission: { currency: 'rub', units: '0', nano: 250000000 }, ...overrides };
}
describe('Sandbox order evidence', () => {
  it('computes per-unit prices times lots and lot size exactly in nanorubles', () => {
    expect(parseSandboxOrderState(payload(), expected, now)).toMatchObject({
      lotsExecuted: 3, grossNano: '3003703703670', commissionNano: '1750000000', terminal: false,
    });
  });
  it('does not turn missing commissions into zero, but accepts explicitly supplied zero', () => {
    expect(parseSandboxOrderState(payload({ serviceCommission: undefined }), expected, now).commissionNano).toBeNull();
    const zero = { currency: 'rub' };
    expect(parseSandboxOrderState(payload({ executedCommission: zero, serviceCommission: zero }), expected, now).commissionNano).toBe('0');
  });
  it('retains terminal partial fills instead of declaring no position', () => {
    expect(parseSandboxOrderState(payload({ executionReportStatus: 'EXECUTION_REPORT_STATUS_CANCELLED' }), expected, now))
      .toMatchObject({ terminal: true, lotsExecuted: 3 });
  });
  it.each([
    { orderRequestId: 'another-request' }, { instrumentUid: 'another-instrument' },
    { direction: 'ORDER_DIRECTION_SELL' }, { currency: 'usd' }, { orderType: 'ORDER_TYPE_MARKET' },
    { lotsRequested: '6' }, { lotsExecuted: '6' }, { lotsExecuted: '3.0' }, { lotsExecuted: undefined },
    { executionReportStatus: 'EXECUTION_REPORT_STATUS_UNSPECIFIED' },
    { executionReportStatus: 'EXECUTION_REPORT_STATUS_NEW' },
    { executionReportStatus: 'EXECUTION_REPORT_STATUS_FILL' }, { stages: [] },
    { stages: [payload().stages[0], payload().stages[0]] },
    { stages: [{ ...payload().stages[0], price: { currency: 'rub', units: '0', nano: 0 } }] },
    { stages: [{ ...payload().stages[0], executionTime: '2026-09-30T12:02:00Z' }] },
    { serviceCommission: { currency: 'rub', units: '-1', nano: 0 } },
  ])('rejects incomplete or contradictory state without raw payload leakage: %j', changes => {
    expect(() => parseSandboxOrderState(payload(changes), expected, now)).toThrow('incomplete, inconsistent');
    try { parseSandboxOrderState(payload(changes), expected, now); } catch (error) {
      expect(String(error)).not.toContain(expected.instrumentId);
      expect(String(error)).not.toContain('local-broker-order');
    }
  });
  it('rejects regressed fills, replaced trades, changed identity and lower fees', () => {
    const prior = parseSandboxOrderState(payload(), expected, now);
    expect(() => assertSnapshotProgress(prior, { ...prior, lotsExecuted: 2 })).toThrow('contradicts');
    expect(() => assertSnapshotProgress(prior, { ...prior, brokerOrderId: 'other' })).toThrow('contradicts');
    expect(() => assertSnapshotProgress(prior, { ...prior, stages: [] })).toThrow('contradicts');
    expect(() => assertSnapshotProgress(prior, { ...prior, commissionNano: null })).toThrow('contradicts');
    expect(() => assertSnapshotProgress(prior, { ...prior, commissionNano: '0' })).toThrow('contradicts');
    expect(() => assertSnapshotProgress(prior, { ...prior, stages: [{ ...prior.stages[0]!, priceNano: '100' }] })).toThrow('contradicts');
    expect(() => assertSnapshotProgress(prior, prior)).not.toThrow();
  });
});

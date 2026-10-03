import { describe, expect, it } from 'vitest';
import { assertSnapshotProgress, parseSandboxExitOrderState, parseSandboxOrderState, parseSandboxSessionExitOrderState } from './sandbox-order-state.js';
import { assessSandboxCashOperations } from './sandbox-cash-operations.js';

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
    ['2026-09-30T12:00:00.123456789Z', '2026-09-30T12:00:00.123456789Z'],
    ['2026-09-30T15:00:00.123456789+03:00', '2026-09-30T12:00:00.123456789Z'],
    ['2026-09-30T09:00:00.000000001-03:00', '2026-09-30T12:00:00.000000001Z'],
    ['2026-09-30T15:00:00.123000000+03:00', '2026-09-30T12:00:00.123Z'],
    ['2026-09-30T12:00:00.1Z', '2026-09-30T12:00:00.100Z'],
    ['2026-09-30T12:00:00.1234Z', '2026-09-30T12:00:00.1234Z'],
  ])('normalizes %s to UTC without losing any nanosecond value', (executionTime, executedAt) => {
    const parsed = parseSandboxOrderState(payload({ stages: [{ ...payload().stages[0], executionTime }] }), expected, now);
    expect(parsed.stages[0]!.executedAt).toBe(executedAt);
  });
  it.each(['2026-09-30T12:00Z', '2026-09-30T12:00:00.1234567891Z', '2026-09-30T12:01:00.000000001Z'])('rejects incomplete time, unsupported precision or a one-nano future bound overflow: %s', executionTime => {
    expect(() => parseSandboxOrderState(payload({ stages: [{ ...payload().stages[0], executionTime }] }), expected, now)).toThrow('incomplete, inconsistent');
  });
  it('enforces a sub-millisecond notBefore for both native children and own session exits', () => {
    const sell = payload({ direction: 'ORDER_DIRECTION_SELL',
      stages: [{ ...payload().stages[0], executionTime: '2026-09-30T12:00:00.123456788Z' }] });
    const child = { brokerOrderId: 'local-broker-order', instrumentId: expected.instrumentId, lots: 5, lotSize: 10,
      notBefore: '2026-09-30T12:00:00.123456789Z' };
    expect(() => parseSandboxExitOrderState(sell, child, now)).toThrow();
    expect(() => parseSandboxSessionExitOrderState(sell, { ...child, requestId: expected.requestId }, now)).toThrow();
  });
  it('matches freshly parsed nine-digit fills to cursor operations, never a legacy truncated snapshot', () => {
    const entryAt = '2026-09-30T12:00:00.123456789Z', exitAt = '2026-09-30T12:00:00.123456790Z';
    const price = { currency: 'rub', units: '100', nano: 0 }, zero = { currency: 'rub', units: '0', nano: 0 };
    const entry = parseSandboxOrderState(payload({ executionReportStatus: 'EXECUTION_REPORT_STATUS_CANCELLED',
      executedCommission: zero, serviceCommission: zero,
      stages: [{ ...payload().stages[0], price, executionTime: entryAt }] }), expected, now);
    const exit = parseSandboxExitOrderState(payload({ orderId: 'local-cash-exit', direction: 'ORDER_DIRECTION_SELL',
      executionReportStatus: 'EXECUTION_REPORT_STATUS_CANCELLED', executedCommission: zero, serviceCommission: zero,
      stages: [{ ...payload().stages[0], tradeId: 'cash-exit-trade', price, executionTime: exitAt }] }),
    { brokerOrderId: 'local-cash-exit', instrumentId: expected.instrumentId, lots: 5, lotSize: 10, notBefore: entryAt }, now);
    const operation = (side: 'BUY' | 'SELL', date: string, num: string) => ({ id: `synthetic-${side}`, brokerAccountId: 'synthetic-account',
      instrumentUid: expected.instrumentId, date, type: `OPERATION_TYPE_${side}`, state: 'OPERATION_STATE_EXECUTED',
      quantity: '30', quantityDone: '30', quantityRest: '0', price, commission: zero,
      payment: { currency: 'rub', units: side === 'BUY' ? '-3000' : '3000', nano: 0 },
      tradesInfo: { trades: [{ num, date, quantity: '30', price }] } });
    const window = { version: 1 as const, accountId: 'synthetic-account', from: '2026-09-30T11:59:00.000Z', to: '2026-09-30T12:01:00.000Z',
      pages: [{ cursor: null, payload: { hasNext: false, nextCursor: '',
        items: [operation('BUY', entryAt, entry.stages[0]!.tradeId), operation('SELL', exitAt, exit.stages[0]!.tradeId)] } }] };
    const ownership = { accountId: window.accountId, from: window.from, to: window.to, instrumentId: expected.instrumentId,
      lotSize: 10, failedCloseFeesNano: '0', entry, exit };
    expect(assessSandboxCashOperations(window, ownership)).toEqual({ complete: true, paymentNano: '0', reasons: [] });
    const legacy = { ...entry, stages: [{ ...entry.stages[0]!, executedAt: '2026-09-30T12:00:00.123Z' }] };
    expect(assessSandboxCashOperations(window, { ...ownership, entry: legacy }).complete).toBe(false);
    expect(() => assertSnapshotProgress(legacy, entry)).toThrow('contradicts');
  });
  it.each(['', undefined])('accepts native child client ID %j only with the exact acknowledged exchange child', orderRequestId => {
    const sell = payload({ orderRequestId, direction: 'ORDER_DIRECTION_SELL' });
    const child = { brokerOrderId: 'local-broker-order', instrumentId: expected.instrumentId, lots: 5, lotSize: 10, notBefore: now.toISOString() };
    expect(parseSandboxExitOrderState(sell, child, now)).toMatchObject({ brokerOrderId: 'local-broker-order', lotsExecuted: 3 });
    expect(() => parseSandboxExitOrderState(sell, { ...child, brokerOrderId: 'foreign-child' }, now)).toThrow();
    expect(() => parseSandboxExitOrderState(sell, { ...child, instrumentId: 'foreign-instrument' }, now)).toThrow();
    expect(() => parseSandboxOrderState(payload({ orderRequestId }), { ...expected, requestId: '' }, now)).toThrow();
    expect(() => parseSandboxOrderState(payload({ orderRequestId }), expected, now)).toThrow();
    for (const requestId of ['', expected.requestId]) {
      expect(() => parseSandboxSessionExitOrderState(sell, { ...child, requestId }, now)).toThrow();
    }
  });
  it('does not expand the broker string dialect to null request IDs', () => {
    const sell = payload({ orderRequestId: null, direction: 'ORDER_DIRECTION_SELL' });
    expect(() => parseSandboxExitOrderState(sell, { brokerOrderId: 'local-broker-order', instrumentId: expected.instrumentId,
      lots: 5, lotSize: 10, notBefore: now.toISOString() }, now)).toThrow();
  });
  it.each([
    { orderRequestId: 'another-request' }, { orderRequestId: undefined }, { orderRequestId: '' }, { orderRequestId: null }, { instrumentUid: 'another-instrument' },
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
  it('rejects increased fills after terminal cancellation even if status is unchanged', () => {
    const prior = parseSandboxOrderState(payload({ executionReportStatus: 'EXECUTION_REPORT_STATUS_CANCELLED' }), expected, now);
    expect(() => assertSnapshotProgress(prior, { ...prior, lotsExecuted: 4 })).toThrow('contradicts');
  });
});

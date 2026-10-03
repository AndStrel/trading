import { describe, expect, it } from 'vitest';
import { parseSandboxExitOrderState, parseSandboxOrderState, type SandboxOrderSnapshot } from './sandbox-order-state.js';
import { analyzeSandboxRoundTrip, formatNanoRub } from './sandbox-round-trip.js';

const now = new Date('2026-10-01T08:00:00.000Z');
const entryAt = '2026-10-01T07:00:00.000Z'; const exitAt = '2026-10-01T07:10:00.000Z';
const expected = { brokerOrderId: 'local-child', instrumentId: 'local-instrument', lots: 5, lotSize: 10, notBefore: entryAt };
function payload(changes: Record<string, unknown> = {}) {
  return { orderId: 'local-child', instrumentUid: 'local-instrument', direction: 'ORDER_DIRECTION_SELL', orderType: 'ORDER_TYPE_LIMIT',
    executionReportStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsRequested: '5', lotsExecuted: '5', currency: 'rub',
    stages: [{ tradeId: 'local-sell', quantity: '5', price: { currency: 'rub', units: '11', nano: 123456789 }, executionTime: exitAt }],
    executedCommission: { currency: 'rub', units: '1', nano: 123456789 }, serviceCommission: { currency: 'rub', units: '0', nano: 123456789 }, ...changes };
}
function entry() {
  return parseSandboxOrderState({ ...payload(), orderId: 'local-entry', orderRequestId: 'local-uuid', direction: 'ORDER_DIRECTION_BUY',
    stages: [{ tradeId: 'local-buy', quantity: '5', price: { currency: 'rub', units: '10', nano: 123456789 }, executionTime: entryAt }] },
  { requestId: 'local-uuid', instrumentId: expected.instrumentId, lots: 5, lotSize: 10 }, now);
}
describe('Sandbox child sell and exact round-trip result', () => {
  it('accepts child exchange identity without OUR request UUID, but not as a BUY entry', () => {
    expect(parseSandboxExitOrderState(payload(), expected, now).brokerOrderId).toBe('local-child');
    expect(() => parseSandboxOrderState(payload(), { requestId: 'local-uuid', instrumentId: expected.instrumentId, lots: 5, lotSize: 10 }, now)).toThrow();
  });
  it.each([{ orderId: 'foreign' }, { instrumentUid: 'foreign' }, { direction: 'ORDER_DIRECTION_BUY' },
    { orderType: 'ORDER_TYPE_MARKET' }, { lotsRequested: '6' }, { lotsExecuted: '6' }, { lotsExecuted: undefined },
    { currency: 'usd' }, { stages: [{ ...payload().stages[0], executionTime: '2026-10-01T06:59:59Z' }] },
    { stages: [{ ...payload().stages[0], executionTime: '2026-10-01T08:02:00Z' }] }, { stages: [] }])
    ('rejects inconsistent child: %j', changes => expect(() => parseSandboxExitOrderState(payload(changes), expected, now)).toThrow());
  it('subtracts only reported entry/exit commissions from actual prices using integers', () => {
    const result = analyzeSandboxRoundTrip(entry(), parseSandboxExitOrderState(payload(), expected, now), 10);
    expect(result).toEqual({ soldLots: 5, remainingLots: 0, fullySold: true, netPnlNano: '47506172844', closedAt: exitAt });
    expect(formatNanoRub(result.netPnlNano!)).toBe('47,50 ₽');
  });
  it('rejects an exit one nanosecond before the latest entry, even within the same millisecond', () => {
    const bought = entry(); bought.stages[0]!.executedAt = '2026-10-01T07:10:00.123456790Z';
    const sold = parseSandboxExitOrderState(payload({ stages: [{ ...payload().stages[0], executionTime: '2026-10-01T07:10:00.123456789Z' }] }), expected, now);
    expect(() => analyzeSandboxRoundTrip(bought, sold, 10)).toThrow('precedes');
  });
  it('selects the exact latest entry among out-of-order same-millisecond stages', () => {
    const bought = entry(), stage = bought.stages[0]!;
    bought.stages = [{ ...stage, tradeId: 'entry-late', lots: 2, executedAt: '2026-10-01T07:10:00.123456790Z' },
      { ...stage, tradeId: 'entry-early', lots: 3, executedAt: '2026-10-01T07:10:00.123456788Z' }];
    const sold = parseSandboxExitOrderState(payload({ stages: [{ ...payload().stages[0], executionTime: '2026-10-01T07:10:00.123456789Z' }] }), expected, now);
    expect(() => analyzeSandboxRoundTrip(bought, sold, 10)).toThrow('precedes');
  });
  it('retains the exact latest exit as closedAt without rounding or depending on stage order', () => {
    const sold = parseSandboxExitOrderState(payload({ stages: [
      { ...payload().stages[0], tradeId: 'sell-late', quantity: '2', executionTime: '2026-10-01T07:10:00.123456790Z' },
      { ...payload().stages[0], tradeId: 'sell-early', quantity: '3', executionTime: '2026-10-01T07:10:00.123456789Z' },
    ] }), expected, now);
    expect(analyzeSandboxRoundTrip(entry(), sold, 10)).toMatchObject({ fullySold: true, netPnlNano: '47506172844',
      closedAt: '2026-10-01T07:10:00.12345679Z' });
    expect(analyzeSandboxRoundTrip(entry(), { ...sold, stages: [...sold.stages].reverse() }, 10).closedAt)
      .toBe('2026-10-01T07:10:00.12345679Z');
  });
  it('does not allocate unknown entry cost to a partial exit or declare a final PnL', () => {
    const exit = parseSandboxExitOrderState(payload({ executionReportStatus: 'EXECUTION_REPORT_STATUS_CANCELLED', lotsExecuted: '2',
      stages: [{ ...payload().stages[0], quantity: '2' }] }), expected, now);
    expect(analyzeSandboxRoundTrip(entry(), exit, 10)).toEqual({ soldLots: 2, remainingLots: 3, fullySold: false, netPnlNano: null, closedAt: null });
  });
  it('missing fees stay unknown rather than becoming zero', () => {
    const exit = parseSandboxExitOrderState(payload({ serviceCommission: undefined }), expected, now);
    expect(analyzeSandboxRoundTrip(entry(), exit, 10).netPnlNano).toBeNull();
    const zero = { currency: 'rub', units: '0', nano: 0 };
    const explicitlyZero = parseSandboxExitOrderState(payload({ executedCommission: zero, serviceCommission: zero }), expected, now);
    expect(analyzeSandboxRoundTrip({ ...entry(), commissionNano: '0' }, explicitlyZero, 10).netPnlNano).toBe('50000000000');
  });
  it.each([
    { brokerOrderId: 'local-entry' }, { grossNano: '0' }, { commissionNano: '-1' },
    { stages: [{ tradeId: 'local-buy', lots: 5, priceNano: '11123456789', executedAt: exitAt }] },
    { stages: [{ tradeId: 'other', lots: 5, priceNano: '11123456789', executedAt: '2026-10-01T06:59:59Z' }] },
  ])('rejects forged snapshot rather than computing money: %j', changes => {
    const exit = parseSandboxExitOrderState(payload(), expected, now);
    expect(() => analyzeSandboxRoundTrip(entry(), { ...exit, ...changes } as SandboxOrderSnapshot, 10)).toThrow();
  });
  it('does not display rounded-away losses as a win or zero', () => {
    expect(formatNanoRub('-1')).toBe('−0,01 ₽'); expect(formatNanoRub('1')).toBe('0,00 ₽');
    expect(formatNanoRub('-100000001')).toBe('−0,11 ₽');
  });
});

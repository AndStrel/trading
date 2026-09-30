import { describe, expect, it } from 'vitest';
import { assertNoActiveSandboxStops, assertSandboxPosition, decimalPriceNano, nanoQuotation, parseSandboxStop,
  type SandboxStopIntent } from './sandbox-stop-state.js';

const now = new Date('2026-09-30T12:00:00.000Z');
const intent: SandboxStopIntent = { scenarioId: 1, accountId: 'local-account', instrumentId: 'local-instrument',
  requestId: 'local-request', entryRequestId: 'local-entry', lots: 5, stopNano: '9900000000', limitNano: '9900000000',
  createdAt: now.toISOString(), brokerStopId: 'local-stop' };
const stop = (changes: Record<string, unknown> = {}) => ({ stopOrderId: 'local-stop', status: 'STOP_ORDER_STATUS_ACTIVE',
  instrumentUid: intent.instrumentId, currency: 'rub', direction: 'STOP_ORDER_DIRECTION_SELL', orderType: 'STOP_ORDER_TYPE_STOP_LIMIT',
  lotsRequested: '5', stopPrice: { currency: 'rub', units: '9', nano: 900000000 },
  price: { currency: 'rub', units: '9', nano: 900000000 }, createDate: now.toISOString(), ...changes });
const positions = () => ({ accountId: intent.accountId, limitsLoadingInProgress: false,
  securities: [{ instrumentUid: intent.instrumentId, balance: '50', blocked: '0', exchangeBlocked: false, instrumentType: 'share' }],
  futures: [], options: [] });

describe('Sandbox stop evidence', () => {
  it.each([[9.9, '9900000000'], [0.000000001, '1'], [1e-7, '100'], [1000000, '1000000000000000']])
    ('converts %s exactly to %s nanorubles', (price, nano) => expect(decimalPriceNano(Number(price))).toBe(nano));
  it.each([0, -1, Infinity, NaN, 1e-10, 1000001, 0.1234567891])('rejects invalid price %s', price => {
    expect(() => decimalPriceNano(price)).toThrow(/stop price/i);
  });
  it('builds quotations using integer arithmetic', () => expect(nanoQuotation('9900000001')).toEqual({ units: '9', nano: 900000001 }));
  it.each(['0', '-1', '1.0', '1e9', '1000000000000001'])('rejects invalid nano quotation %s', nano => {
    expect(() => nanoQuotation(nano)).toThrow();
  });
  it('requires an explicit complete empty stop book', () => {
    expect(() => assertNoActiveSandboxStops({ stopOrders: [] })).not.toThrow();
    expect(() => assertNoActiveSandboxStops({})).toThrow();
    expect(() => assertNoActiveSandboxStops({ stopOrders: [stop()] })).toThrow();
    expect(() => assertNoActiveSandboxStops({ stopOrders: [stop({ status: 'STOP_ORDER_STATUS_CANCELED' })] })).not.toThrow();
  });
  it('confirms only the acknowledged stop identity', () => {
    expect(parseSandboxStop({ stopOrders: [stop()] }, intent, now)).toEqual({ status: 'STOP_ORDER_STATUS_ACTIVE', childOrderId: null });
    expect(() => parseSandboxStop({ stopOrders: [stop()] }, { ...intent, brokerStopId: null }, now)).toThrow();
    expect(() => parseSandboxStop({ stopOrders: [] }, intent, now)).toThrow();
    expect(() => parseSandboxStop({ stopOrders: [stop(), stop()] }, intent, now)).toThrow();
    expect(() => parseSandboxStop({ stopOrders: [stop(), stop({ stopOrderId: 'foreign' })] }, intent, now)).toThrow();
  });
  it.each([
    { instrumentUid: 'foreign' }, { currency: 'usd' }, { lotsRequested: '6' }, { lotsRequested: '5.0' },
    { direction: 'STOP_ORDER_DIRECTION_BUY' }, { orderType: 'STOP_ORDER_TYPE_STOP_LOSS' },
    { stopPrice: { currency: 'rub', units: '9', nano: 900000001 } }, { price: { currency: 'usd', units: '9', nano: 900000000 } },
    { exchangeOrderType: 'EXCHANGE_ORDER_TYPE_MARKET' }, { exchangeOrderId: 'premature-child' },
    { status: 'STOP_ORDER_STATUS_UNSPECIFIED' }, { createDate: '2026-09-30T11:58:00Z' }, { createDate: '2026-09-30T12:02:00Z' },
    { status: 'STOP_ORDER_STATUS_CANCELED', exchangeOrderId: 'unexpected-child' },
  ])('rejects conflicting stop without leaking identifiers: %j', changes => {
    expect(() => parseSandboxStop({ stopOrders: [stop(changes)] }, intent, now)).toThrow('not confirmed');
    try { parseSandboxStop({ stopOrders: [stop(changes)] }, intent, now); } catch (error) {
      expect(String(error)).not.toContain(intent.instrumentId);
    }
  });
  it('records executed stop as a child order, not as closed holdings', () => {
    expect(() => parseSandboxStop({ stopOrders: [stop({ status: 'STOP_ORDER_STATUS_EXECUTED' })] }, intent, now)).toThrow();
    expect(parseSandboxStop({ stopOrders: [stop({ status: 'STOP_ORDER_STATUS_EXECUTED', exchangeOrderId: 'child' })] }, intent, now))
      .toEqual({ status: 'STOP_ORDER_STATUS_EXECUTED', childOrderId: 'child' });
  });
  it('matches unblocked instrument units, not lots, on an exclusive account', () => {
    expect(() => assertSandboxPosition(positions(), intent.accountId, intent.instrumentId, 50n)).not.toThrow();
    expect(() => assertSandboxPosition(positions(), intent.accountId, intent.instrumentId, 5n)).toThrow();
    expect(() => assertSandboxPosition(positions(), 'other-account', intent.instrumentId, 50n)).toThrow();
    expect(() => assertSandboxPosition({ ...positions(), securities: [...positions().securities, positions().securities[0]] }, intent.accountId, intent.instrumentId, 50n)).toThrow();
  });
  it.each([{ blocked: '1' }, { exchangeBlocked: true }, { balance: '49' }, { instrumentType: 'bond' }, { instrumentUid: 'other' }])
    ('rejects conflicting holding: %j', changes => {
      expect(() => assertSandboxPosition({ ...positions(), securities: [{ ...positions().securities[0], ...changes }] }, intent.accountId, intent.instrumentId, 50n)).toThrow();
    });
  it.each([{ limitsLoadingInProgress: true }, { options: [{}] }, { futures: undefined }])('rejects incomplete positions: %j', changes => {
    expect(() => assertSandboxPosition({ ...positions(), ...changes }, intent.accountId, intent.instrumentId, 50n)).toThrow();
  });
});

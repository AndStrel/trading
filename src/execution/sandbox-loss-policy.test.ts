import { describe, expect, it } from 'vitest';
import type { SandboxOrderSnapshot } from './sandbox-order-state.js';
import { moscowLossDay, sandboxBidValue, sandboxClosedDayLoss, sandboxMarkedTradeLoss } from './sandbox-loss-policy.js';

const now = new Date('2026-10-01T08:00:00Z');
const status = { instrumentUid: 'fixture', tradingStatus: 'SECURITY_TRADING_STATUS_NORMAL_TRADING',
  apiTradeAvailableFlag: true, limitOrderAvailableFlag: true };
const level = (units: string, quantity: string) => ({ price: { units, nano: 0 }, quantity });
const book = () => ({ instrumentUid: 'fixture', orderbookTs: now.toISOString(),
  bids: [level('10', '2'), level('9', '3')], asks: [level('11', '5')] });
const entry: SandboxOrderSnapshot = { brokerOrderId: 'buy', executionStatus: 'EXECUTION_REPORT_STATUS_FILL', terminal: true,
  lotsExecuted: 5, grossNano: '500000000000', commissionNano: '2000000000',
  stages: [{ tradeId: 'buy-fill', lots: 5, priceNano: '10000000000', executedAt: '2026-10-01T07:50:00Z' }] };
const partial: SandboxOrderSnapshot = { brokerOrderId: 'sell', executionStatus: 'EXECUTION_REPORT_STATUS_PARTIALLYFILL', terminal: false,
  lotsExecuted: 2, grossNano: '202000000000', commissionNano: '1000000000',
  stages: [{ tradeId: 'sell-fill', lots: 2, priceNano: '10100000000', executedAt: '2026-10-01T07:55:00Z' }] };

describe('Conservative sandbox loss amounts', () => {
  it('values every lot across BID depth with the per-unit lot size', () => {
    expect(sandboxBidValue(book(), status, 'fixture', 5, 10, now)).toEqual({ grossNano: '470000000000', quoteAt: now.toISOString() });
  });
  it.each(['insufficient', 'stale', 'future', 'missing-time', 'wrong-uid', 'duplicate', 'unsorted', 'crossed', 'zero-price', 'fractional-volume', 'no-bid'])
    ('never substitutes a last price for %s', condition => {
      const b = book();
      if (condition === 'insufficient') b.bids[1]!.quantity = '2';
      if (condition === 'stale') b.orderbookTs = '2026-10-01T07:59:44.999Z';
      if (condition === 'future') b.orderbookTs = '2026-10-01T08:00:01.001Z';
      if (condition === 'missing-time') b.orderbookTs = undefined as unknown as string;
      if (condition === 'wrong-uid') b.instrumentUid = 'other';
      if (condition === 'duplicate') b.bids[1]!.price.units = '10';
      if (condition === 'unsorted') b.bids.reverse();
      if (condition === 'crossed') b.asks[0]!.price.units = '8';
      if (condition === 'zero-price') b.bids[0]!.price.units = '0';
      if (condition === 'fractional-volume') b.bids[0]!.quantity = '0.5';
      if (condition === 'no-bid') b.bids = [];
      expect(() => sandboxBidValue({ ...b, lastPrice: { units: '1000', nano: 0 } }, status, 'fixture', 5, 10, now)).toThrow('BID');
    });
  it.each([{ ...status, instrumentUid: 'other' }, { ...status, apiTradeAvailableFlag: false },
    { ...status, limitOrderAvailableFlag: false }, { ...status, tradingStatus: 'SECURITY_TRADING_STATUS_NOT_AVAILABLE_FOR_TRADING' }])
    ('requires matching and tradeable instrument', s => expect(() => sandboxBidValue(book(), s, 'fixture', 5, 10, now)).toThrow());
  it('deducts actual entry fees and forecast remaining exit costs rounded upward', () => {
    expect(sandboxMarkedTradeLoss(entry, null, '495000000000', 10, 0.003, 0.0005)).toEqual({
      netIfLiquidatedNano: '-8740000000', lossNano: '8740000000', remainingLots: 5 });
  });
  it('does not deduct forecast expenses again from actual partial sales', () => {
    expect(sandboxMarkedTradeLoss(entry, partial, '297000000000', 10, 0.003, 0.0005)).toEqual({
      // 0.891 RUB commission -> 0.90; 0.1485 RUB slippage -> 0.15.
      netIfLiquidatedNano: '-5050000000', lossNano: '5050000000', remainingLots: 3 });
  });
  it('a profitable mark consumes zero loss but does not create negative loss credits', () => {
    expect(sandboxMarkedTradeLoss(entry, null, '550000000000', 10, 0.003, 0).lossNano).toBe('0');
  });
  it.each(['entry-fee', 'exit-fee', 'nonterminal-entry', 'floor', 'gross'])('rejects incomplete or under-costed %s', condition => {
    expect(() => sandboxMarkedTradeLoss(condition === 'entry-fee' ? { ...entry, commissionNano: null }
      : condition === 'nonterminal-entry' ? { ...entry, terminal: false } : entry,
    condition === 'exit-fee' ? { ...partial, commissionNano: null } : null,
    condition === 'gross' ? '-1' : '495000000000', 10, condition === 'floor' ? 0.001 : 0.003, 0.0005)).toThrow();
  });
  it('never resets an overnight open position basis at midnight', () => {
    const overnight = { ...entry, stages: entry.stages.map(stage => ({ ...stage, executedAt: '2026-09-30T08:00:00Z' })) };
    expect(sandboxMarkedTradeLoss(overnight, null, '495000000000', 10, 0.003, 0.0005).lossNano).toBe('8740000000');
  });
  it('assigns closed losses to Moscow exit day and never offsets them with profits', () => {
    expect(moscowLossDay(new Date('2026-09-30T21:00:00Z'))).toBe('2026-10-01');
    expect(sandboxClosedDayLoss([
      { complete: true, closedAt: '2026-09-30T20:59:59Z', netPnlNano: '-9000000000' },
      { complete: true, closedAt: '2026-09-30T21:00:00Z', netPnlNano: '-10000000000' },
      { complete: true, closedAt: now.toISOString(), netPnlNano: '100000000000' },
    ], now)).toBe(10000000000n);
  });
  it.each([{ complete: false, closedAt: now.toISOString(), netPnlNano: '0' },
    { complete: true, closedAt: now.toISOString(), netPnlNano: null },
    { complete: true, closedAt: null, netPnlNano: '0' }, { complete: true, closedAt: 'bad', netPnlNano: '0' }])
    ('does not invent zero closed loss from incomplete evidence', result => expect(() => sandboxClosedDayLoss([result], now)).toThrow());
});

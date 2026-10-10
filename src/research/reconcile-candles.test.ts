import { describe, expect, it } from 'vitest';
import { reconcileMoexDay } from './reconcile-candles.js';

const fixture = () => ({ instrumentId: 'test', lotSize: 10,
  columns: ['begin', 'volume', 'value', 'open', 'high', 'low', 'close'],
  rows: [['2025-10-27 08:16:00', 1396, 1622124.9, 116.18, 116.21, 116.18, 116.21]],
  reference: [{ time: '2025-10-27T05:16:00Z', isComplete: true, volume: '1396',
    open: { value: '116.18' }, high: { value: '116.21' }, low: { value: '116.18' }, close: { value: '116.21' } }],
});
describe('independent source reconciliation', () => {
  it('accepts mixed units only with exact broker and turnover corroboration', () => {
    const f = fixture();
    expect(reconcileMoexDay(f).corrections).toHaveLength(1);
    expect(reconcileMoexDay(f).candles[0]!.volume).toBe(1396);
    f.rows[0]![1] = 13960;
    expect(reconcileMoexDay(f).corrections).toHaveLength(0);
  });
  it('fails closed on changed prices, missing reference or inconsistent turnover', () => {
    const f = fixture();
    f.rows[0]![3] = 115;
    expect(() => reconcileMoexDay(f)).toThrow('Price mismatch');
    expect(() => reconcileMoexDay({ ...fixture(), reference: [] })).toThrow('coverage');
    const g = fixture(); g.rows[0]![2] = 1;
    expect(() => reconcileMoexDay(g)).toThrow('Turnover');
  });
});

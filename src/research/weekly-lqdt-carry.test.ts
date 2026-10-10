import { describe, expect, it } from 'vitest';
import { breakevenRatio, buyAndHoldLqdt, simulateWeeklyLqdtCarry } from './weekly-lqdt-carry.js';
import type { DailyBar } from './weekly-trend.js';

function risingBars(): DailyBar[] {
  const rows: DailyBar[] = [];
  const start = Date.parse('2024-11-04T12:00:00Z');
  for (let week = 0; week < 14; week++) {
    for (let day = 0; day < 5; day++) {
      const date = new Date(start + (week * 7 + day) * 86_400_000).toISOString().slice(0, 10);
      const price = 100 * 1.002 ** (week * 5 + day);
      rows.push({ day: date, open: price, high: price, low: price, close: price, volume: 100 });
    }
  }
  return rows;
}

describe('weekly LQDT carry', () => {
  it('uses exact round-trip cost as a lagged threshold and leaves out-of-window exits pending', () => {
    expect(breakevenRatio).toBeGreaterThan(1.007);
    const result = simulateWeeklyLqdtCarry(risingBars(), '2025-01-01', '2025-01-31', 'conditional');
    expect(result.decisions[0]).toMatchObject({ day: '2025-01-06', status: 'opened' });
    expect(result.pending.length).toBeGreaterThan(0);
    expect(result.trades.every((trade) => trade.exitDay <= '2025-01-31')).toBe(true);
  });

  it('does not let later closes change the first decision', () => {
    const original = risingBars();
    const changed = original.map((bar) => bar.day > '2025-01-06' ?
      { ...bar, open: 80, high: 80, low: 80, close: 80 } : bar);
    const first = simulateWeeklyLqdtCarry(original, '2025-01-01', '2025-01-31', 'conditional').decisions[0];
    const second = simulateWeeklyLqdtCarry(changed, '2025-01-01', '2025-01-31', 'conditional').decisions[0];
    expect(second).toEqual(first);
  });

  it('charges entry and exit costs on the continuous holding comparator', () => {
    const rows = risingBars();
    const result = buyAndHoldLqdt(rows, '2025-01-01', '2025-01-31');
    expect(result.endingLiquidationValue).toBeLessThan(1_000_000 * result.finalClose / result.entry);
  });
});

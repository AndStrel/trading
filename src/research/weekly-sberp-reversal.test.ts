import { describe, expect, it } from 'vitest';
import { simulateWeeklySberpReversal } from './weekly-sberp-reversal.js';
import type { DailyBar } from './weekly-trend.js';

const bar = (day: string, open: number, close: number): DailyBar =>
  ({ day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 100 });

describe('weekly SBERP reversal', () => {
  it('uses only completed prior-week closes, enters at next open and exits next week', () => {
    const rows = [bar('2025-01-06', 100, 100), bar('2025-01-10', 100, 100),
      bar('2025-01-13', 98, 98), bar('2025-01-17', 97, 97),
      bar('2025-01-20', 96, 120), bar('2025-01-24', 120, 120),
      bar('2025-01-27', 110, 110)];
    const result = simulateWeeklySberpReversal(rows, 'reversal');
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ entryDay: '2025-01-20', exitDay: '2025-01-27',
      entry: 96, exit: 110 });
    expect(result.decisions[0]?.previousWeekReturnPct).toBeCloseTo(-3);
  });

  it('rejects a stale weekly gap and includes round-trip costs', () => {
    const rows = [bar('2025-01-06', 100, 100), bar('2025-01-27', 96, 96),
      bar('2025-02-03', 96, 96), bar('2025-02-10', 96, 96)];
    expect(simulateWeeklySberpReversal(rows, 'reversal').trades).toHaveLength(0);
    const adjacent = [bar('2025-01-06', 100, 100), bar('2025-01-13', 98, 98),
      bar('2025-01-20', 97, 97), bar('2025-01-27', 97, 97)];
    expect(simulateWeeklySberpReversal(adjacent, 'reversal').trades[0]?.netPct).toBeLessThan(0);
  });

  it('does not use a future trading halt to cancel an entry', () => {
    const rows = [bar('2025-01-06', 100, 100), bar('2025-01-13', 97, 97),
      bar('2025-01-20', 96, 96), bar('2025-02-10', 90, 90)];
    expect(simulateWeeklySberpReversal(rows, 'reversal').trades[0]).toMatchObject({
      entryDay: '2025-01-20', exitDay: '2025-02-10',
    });
  });
});

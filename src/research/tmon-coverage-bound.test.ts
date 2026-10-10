import { describe, expect, it } from 'vitest';
import { tmonCoverageBound } from './tmon-coverage-bound.js';
import type { SiCandle } from './si-first-hour.js';

const candle = (date: string, time: string, open: number): SiCandle =>
  ({ time: `${date} ${time}:00`, open, close: open, high: open, low: open, volume: 1 });

describe('TMON missing-exit upper bound', () => {
  it('counts every entered date and assigns missing exits an optimistic win', () => {
    const date = '2025-01-02';
    const result = tmonCoverageBound([
      { date, candles: [candle(date, '10:01', 100), candle(date, '16:55', 100.005)] },
      { date: '2025-01-03', candles: [candle('2025-01-03', '10:02', 100)] },
      { date: '2025-01-06', candles: [candle('2025-01-06', '12:00', 100)] },
      { date: '2025-01-07', candles: [] },
    ]);
    expect(result).toMatchObject({ activeDays: 3, cancelledEntries: 1, enteredDays: 2,
      completedDays: 1, unresolvedExits: 1, requiredWins: 2 });
    expect(result.cases.gross.observedWins).toBe(1);
    expect(result.cases.base.observedWins).toBe(0);
    expect(result.cases.base.optimisticWins).toBe(1);
    expect(result.cases.base.canReach51Percent).toBe(false);
  });
});

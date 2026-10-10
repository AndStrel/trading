import { describe, expect, it } from 'vitest';
import type { SiCandle } from './si-first-hour.js';
import { trurMissingExitBound } from './trur-missing-exit-bound.js';

const candle = (date: string, time: string, open: number): SiCandle =>
  ({ time: `${date} ${time}:00`, open, close: open, high: open, low: open, volume: 1 });

describe('TRUR missing-exit upper bound', () => {
  it('counts unknown exits in the denominator and only in the optimistic numerator', () => {
    const days = [
      { date: '2025-01-02', candles: [candle('2025-01-02', '10:01', 100), candle('2025-01-02', '16:55', 100.03)] },
      { date: '2025-01-03', candles: [candle('2025-01-03', '10:02', 100)] },
      { date: '2025-01-06', candles: [candle('2025-01-06', '12:00', 100)] },
    ];
    const result = trurMissingExitBound(days);
    expect(result).toMatchObject({ activeDays: 3, enteredDays: 2, completedDays: 1,
      unresolvedExits: 1, cancelledEntries: 1, requiredWins: 2 });
    expect(result.cases.gross.observedWins).toBe(1);
    expect(result.cases.base.observedWins).toBe(0);
    expect(result.cases.base.upperWinFraction).toBe(0.5);
  });
});

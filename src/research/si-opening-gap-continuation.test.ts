import { describe, expect, it } from 'vitest';
import { evaluateSiOpeningGap } from './si-opening-gap-continuation.js';
import type { SiCandle } from './si-first-hour.js';

function day(date: string, price: number): SiCandle[] {
  return Array.from({ length: 421 }, (_, index) => {
    const minute = 600 + index;
    return { time: `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`,
      open: price, close: price, high: price, low: price, volume: 1 };
  });
}

describe('Si opening-gap continuation', () => {
  it('keeps the gap direction and exits by 16:55 on a flat holding day', () => {
    const decision = evaluateSiOpeningGap({ date: '2026-09-25', contract: 'SiZ6', previousDate: '2026-09-24',
      previousContract: 'SiZ6', previousCandles: day('2026-09-24', 100), candles: day('2026-09-25', 101) });
    expect(decision).toMatchObject({ status: 'trade', side: 'long', exitReason: 'time', entry: 101, exit: 101 });
    expect(decision.baseNet).toBeLessThan(0);
  });

  it('excludes unobserved weekend and contract-roll intervals', () => {
    const input = { date: '2026-09-21', contract: 'SiZ6', previousDate: '2026-09-18', previousContract: 'SiZ6',
      previousCandles: day('2026-09-18', 100), candles: day('2026-09-21', 101) };
    expect(evaluateSiOpeningGap(input).status).toBe('excluded');
    expect(evaluateSiOpeningGap({ ...input, previousDate: '2026-09-20', previousContract: 'SiU6' }).status).toBe('excluded');
  });

  it('uses the stop when target and stop touch in the same minute', () => {
    const current = day('2026-09-25', 101);
    current[5] = { ...current[5]!, high: 103, low: 100 };
    const decision = evaluateSiOpeningGap({ date: '2026-09-25', contract: 'SiZ6', previousDate: '2026-09-24',
      previousContract: 'SiZ6', previousCandles: day('2026-09-24', 100), candles: current });
    expect(decision).toMatchObject({ status: 'trade', exitReason: 'stop', exit: 100.495 });
  });
});

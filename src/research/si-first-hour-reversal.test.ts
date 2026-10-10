import { describe, expect, it } from 'vitest';
import { evaluateSiReversalDay } from './si-first-hour-reversal.js';
import type { SiCandle } from './si-first-hour.js';

const spec = { date: '2026-04-06', contract: 'SiM6' } as const;
const candles: SiCandle[] = Array.from({ length: 421 }, (_, index) => {
  const minute = 10 * 60 + index;
  const hhmm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return { time: `${spec.date} ${hhmm}:00`, open: 100 + index / 1000,
    close: 100 + (index + 1) / 1000, high: 101, low: 99, volume: 1 };
});

describe('Si first-hour reversal', () => {
  it('takes the opposite side after a positive first hour', () => {
    const result = evaluateSiReversalDay(spec, candles);
    expect(result.status).toBe('trade');
    expect(result.side).toBe('short');
    expect(result.entry).toBe(candles[61]?.open);
    expect(result.exit).toBe(candles[415]?.open);
    expect(result.baseNet).toBeLessThan(result.gross!);
  });

  it('does not infer fills across missing minutes', () => {
    expect(evaluateSiReversalDay(spec, candles.filter((candle) => !candle.time.includes('13:30'))).status).toBe('missing_holding');
  });
});

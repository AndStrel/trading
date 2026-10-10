import { describe, expect, it } from 'vitest';
import { evaluateSiUsSessionDay, summarizeSiUsSessionBound } from './si-us-session-continuation.js';
import type { SiCandle } from './si-first-hour.js';

const date = '2026-04-13';
const candle = (time: string, price: number): SiCandle =>
  ({ time: `${date} ${time}:00`, open: price, close: price, high: price, low: price, volume: 1 });

describe('Si US-session fixed continuation', () => {
  it('uses only completed signal minutes and counts a missing exit as unresolved', () => {
    const daytime = Array.from({ length: 30 }, (_, index) => candle(`16:${String(30 + index).padStart(2, '0')}`, index === 29 ? 101 : 100));
    const spec = { date, contract: 'SiM6' as const };
    const unresolved = evaluateSiUsSessionDay(spec, daytime, [candle('17:01', 100)]);
    expect(unresolved.status).toBe('unresolved_exit');
    const bound = summarizeSiUsSessionBound([unresolved]);
    expect(bound.entered).toBe(1);
    expect(bound.baseUpperWins).toBe(1);
    const completed = evaluateSiUsSessionDay(spec, daytime, [candle('17:01', 100), candle('22:00', 101)]);
    expect(completed.status).toBe('trade');
    expect(completed.baseNet).toBeLessThan(completed.gross!);
  });
});

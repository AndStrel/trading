import { describe, expect, it } from 'vitest';
import { evaluateTmonDiscountDay } from './tmon-inav-discount.js';
import type { SiCandle } from './si-first-hour.js';
import type { InavCandle } from './tmon-inav-source.js';

const date = '2026-04-06';
const candle = (hhmm: string, close: number): SiCandle => ({ time: `${date} ${hhmm}:00`, open: close, close,
  high: close, low: close, volume: 1 });
const nav = (hhmm: string): InavCandle => ({ time: `${date} ${hhmm}:00`, open: 100, close: 100, high: 100, low: 100 });

describe('TMON published-iNAV discount', () => {
  it('enters only after a completed discount signal', () => {
    const result = evaluateTmonDiscountDay(date,
      [candle('10:15', 99.84), candle('10:16', 99.85), candle('16:55', 99.90)], [nav('10:15')]);
    expect(result.status).toBe('trade');
    expect(result.entryTime).toBe(`${date} 10:16:00`);
    expect(result.baseNet).toBeLessThan(result.gross!);
  });
  it('does not retry after a missing immediate entry', () => {
    expect(evaluateTmonDiscountDay(date, [candle('10:15', 99.84), candle('16:55', 100)], [nav('10:15')]).status)
      .toBe('cancelled_entry');
  });
});

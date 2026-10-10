import { describe, expect, it } from 'vitest';
import { evaluateTgldInavLag } from './tgld-inav-lag.js';
import type { SiCandle } from './si-first-hour.js';
import type { InavCandle } from './tmon-inav-source.js';

const date = '2026-04-06';
const fund = (minute: string, price: number): SiCandle => ({ time: `${date} ${minute}:00`, open: price, close: price,
  high: price, low: price, volume: 1 });
const nav = (minute: string, price: number): InavCandle => ({ time: `${date} ${minute}:00`, open: price, close: price,
  high: price, low: price });

describe('TGLD relative to published iNAV', () => {
  it('uses the next printed minute after a completed lag signal', () => {
    const result = evaluateTgldInavLag(date, [fund('10:00', 10), fund('10:15', 10), fund('10:16', 10.01), fund('16:55', 10.1)],
      [nav('10:00', 10), nav('10:15', 10.03)]);
    expect(result.status).toBe('trade');
    expect(result.entryTime).toBe(`${date} 10:16:00`);
    expect(result.baseNet).toBeLessThan(result.gross!);
  });
  it('does not trigger when iNAV itself fell', () => {
    expect(evaluateTgldInavLag(date, [fund('10:00', 10), fund('10:15', 9.9)],
      [nav('10:00', 10), nav('10:15', 9.95)]).status).toBe('cash');
  });
});

import { describe, expect, it } from 'vitest';

import { evaluateSiFromBrentLead } from './si-from-brent-lead.js';
import type { SiCandle } from './si-first-hour.js';

const date = '2026-04-01';

function candles(price: number): SiCandle[] {
  return Array.from({ length: 421 }, (_, index) => {
    const minute = 600 + index;
    return {
      time: `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`,
      open: price, high: price, low: price, close: price, volume: 1000,
    };
  });
}

function at(data: SiCandle[], time: string): SiCandle {
  const candle = data.find((item) => item.time.slice(11, 16) === time);
  if (!candle) throw new Error(`Missing test candle ${time}`);
  return candle;
}

describe('Si from Brent first-hour lead', () => {
  it('trades only Si opposite to the observed Brent direction', () => {
    const br = candles(100);
    const si = candles(100);
    Object.assign(at(br, '10:59'), { high: 101, close: 101 });
    Object.assign(at(si, '11:02'), { low: 98.9, close: 99 });
    const result = evaluateSiFromBrentLead(date, 'SiM6', 'BRK6', br, si);
    expect(result).toMatchObject({ status: 'trade', side: 'short', entry: 100, exitReason: 'target' });
    expect(result.exit).toBeCloseTo(99);
    expect(result.baseNet).toBeGreaterThan(0);
  });

  it('does not use later Brent gaps to suppress a complete first-hour signal', () => {
    const br = candles(100);
    const si = candles(100);
    Object.assign(at(br, '10:59'), { low: 99, close: 99 });
    Object.assign(at(si, '11:02'), { high: 101.1, close: 101 });
    const laterGap = br.filter((candle) => candle.time.slice(11, 16) !== '13:29');
    expect(evaluateSiFromBrentLead(date, 'SiM6', 'BRK6', laterGap, si)).toMatchObject({ status: 'trade', side: 'long', exitReason: 'target' });
  });

  it('keeps missing pre-signal Brent history and Si holding history explicit', () => {
    const br = candles(100);
    const si = candles(100);
    Object.assign(at(br, '10:59'), { high: 101, close: 101 });
    const earlyGap = br.filter((candle) => candle.time.slice(11, 16) !== '10:05');
    expect(evaluateSiFromBrentLead(date, 'SiM6', 'BRK6', earlyGap, si).status).toBe('missing_br_history');
    const holdingGap = si.filter((candle) => candle.time.slice(11, 16) !== '13:29');
    expect(evaluateSiFromBrentLead(date, 'SiM6', 'BRK6', br, holdingGap).status).toBe('unresolved_holding');
  });

  it('counts a same-minute stop before target and worsens an adverse gap', () => {
    const br = candles(100);
    const si = candles(100);
    Object.assign(at(br, '10:59'), { low: 99, close: 99 });
    Object.assign(at(si, '11:02'), { open: 99, high: 102, low: 98, close: 100 });
    const result = evaluateSiFromBrentLead(date, 'SiM6', 'BRK6', br, si);
    expect(result).toMatchObject({ status: 'trade', side: 'long', exit: 99, exitReason: 'stop' });
    expect(result.baseNet).toBeLessThan(0);
  });
});

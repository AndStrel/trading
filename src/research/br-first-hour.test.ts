import { describe, expect, it } from 'vitest';

import { evaluateBrFirstHour } from './br-first-hour.js';
import type { SiCandle } from './si-first-hour.js';

const date = '2026-04-01';

function candles(): SiCandle[] {
  return Array.from({ length: 421 }, (_, index) => {
    const minute = 600 + index;
    return {
      time: `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`,
      open: 100, high: 100, low: 100, close: 100, volume: 1000,
    };
  });
}

function at(data: SiCandle[], time: string): SiCandle {
  const candle = data.find((item) => item.time.slice(11, 16) === time);
  if (!candle) throw new Error(`Missing test candle ${time}`);
  return candle;
}

describe('BR first-hour risk-controlled replay', () => {
  it('stays in cash for an exactly flat first hour', () => {
    expect(evaluateBrFirstHour(date, 'BRK6', candles()).status).toBe('cash');
  });

  it('uses the following minute open and a conservative target fill', () => {
    const data = candles();
    Object.assign(at(data, '10:59'), { high: 101, close: 101 });
    Object.assign(at(data, '11:02'), { high: 101.7, close: 101 });
    const result = evaluateBrFirstHour(date, 'BRK6', data);
    expect(result).toMatchObject({ status: 'trade', side: 'long', entry: 100, exitReason: 'target' });
    expect(result.exit).toBeCloseTo(101.5);
    expect(result.baseNet).toBeGreaterThan(0);
    expect(result.stressNet).toBeLessThan(result.baseNet!);
  });

  it('counts an ambiguous minute as a stop and worsens a gap through it', () => {
    const data = candles();
    Object.assign(at(data, '10:59'), { high: 101, close: 101 });
    Object.assign(at(data, '11:02'), { open: 99, high: 102, low: 98, close: 100 });
    const result = evaluateBrFirstHour(date, 'BRK6', data);
    expect(result).toMatchObject({ status: 'trade', side: 'long', exit: 99, exitReason: 'stop' });
    expect(result.baseNet).toBeLessThan(0);
  });

  it('keeps a post-entry data gap unresolved', () => {
    const data = candles();
    Object.assign(at(data, '10:59'), { high: 101, close: 101 });
    const incomplete = data.filter((item) => item.time.slice(11, 16) !== '13:29');
    expect(evaluateBrFirstHour(date, 'BRK6', incomplete).status).toBe('unresolved_holding');
  });
});

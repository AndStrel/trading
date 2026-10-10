import { describe, expect, it } from 'vitest';

import { evaluateSiOpeningBreakout } from './si-opening-breakout.js';
import type { SiCandle } from './si-first-hour.js';

const date = '2023-07-03';

function candles(): SiCandle[] {
  return Array.from({ length: 421 }, (_, index) => {
    const minute = 600 + index;
    return {
      time: `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`,
      open: 100, high: 100, low: 100, close: 100, volume: 1000,
    };
  });
}

function at(data: SiCandle[], hourMinute: string): SiCandle {
  const candle = data.find((item) => item.time.slice(11, 16) === hourMinute);
  if (!candle) throw new Error(`Missing test candle ${hourMinute}`);
  return candle;
}

describe('Si opening-compression breakout', () => {
  it('requires all opening minutes and remains in cash without a breakout', () => {
    expect(evaluateSiOpeningBreakout(date, 'SiU3', candles()).status).toBe('cash');
    const incomplete = candles().filter((item) => item.time.slice(11, 16) !== '10:05');
    expect(evaluateSiOpeningBreakout(date, 'SiU3', incomplete).status).toBe('missing_opening');
  });

  it('enters only after the breakout minute and books a conservative target', () => {
    const data = candles();
    Object.assign(at(data, '11:00'), { high: 100.1, close: 100.1 });
    Object.assign(at(data, '11:01'), { high: 100.2, close: 100.1 });
    Object.assign(at(data, '11:02'), { high: 101.1, close: 100.9 });
    const result = evaluateSiOpeningBreakout(date, 'SiU3', data);
    expect(result).toMatchObject({ status: 'trade', side: 'long', signalTime: `${date} 11:00:00`, entry: 100, exit: 101, exitReason: 'target' });
    expect(result.baseNet).toBeGreaterThan(0);
    expect(result.stressNet).toBeLessThan(result.baseNet!);
  });

  it('counts the stop first if stop and target both touch in one candle', () => {
    const data = candles();
    Object.assign(at(data, '11:00'), { high: 100.1, close: 100.1 });
    Object.assign(at(data, '11:01'), { high: 101.1, low: 99.2, close: 100 });
    const result = evaluateSiOpeningBreakout(date, 'SiU3', data);
    expect(result).toMatchObject({ status: 'trade', exitReason: 'stop', exit: 99.3 });
    expect(result.baseNet).toBeLessThan(0);
  });

  it('does not silently fill missing holding history', () => {
    const data = candles();
    Object.assign(at(data, '11:00'), { high: 100.1, close: 100.1 });
    const incomplete = data.filter((item) => item.time.slice(11, 16) !== '11:02');
    expect(evaluateSiOpeningBreakout(date, 'SiU3', incomplete).status).toBe('unresolved_holding');
  });

  it('skips only the verified clearing break and prices an adverse reopening gap', () => {
    const data = candles();
    Object.assign(at(data, '11:00'), { high: 100.1, close: 100.1 });
    Object.assign(at(data, '14:05'), { open: 99, high: 99.2, low: 98.8, close: 99 });
    const withoutClearing = data.filter((item) => item.time.slice(11, 16) < '14:00' || item.time.slice(11, 16) > '14:04');
    const result = evaluateSiOpeningBreakout(date, 'SiU3', withoutClearing);
    expect(result).toMatchObject({ status: 'trade', side: 'long', exitReason: 'stop', exit: 99 });
  });
});

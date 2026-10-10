import { describe, expect, it } from 'vitest';

import { evaluateBrShockFade } from './br-shock-fade.js';
import type { SiCandle } from './si-first-hour.js';

function candlesForDay(date: string): SiCandle[] {
  const result: SiCandle[] = [];
  for (let minute = 600; minute <= 810; minute += 1) {
    const time = `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
    result.push({ time, open: 100, close: 100, high: 100, low: 100, volume: 1 });
  }
  return result;
}

describe('BR five-minute shock fade', () => {
  it('fades the first qualifying impulse and applies target pricing', () => {
    const candles = candlesForDay('2025-03-24');
    candles[4] = { ...candles[4]!, close: 100.5, high: 100.5 };
    candles[5] = { ...candles[5]!, open: 100.5 };
    candles[6] = { ...candles[6]!, high: 100.5, low: 99.8 };
    const decision = evaluateBrShockFade('2025-03-24', 'BRJ5', candles);
    expect(decision.status).toBe('trade');
    if (decision.status !== 'trade') throw new Error('Expected completed trade');
    expect(decision.side).toBe('short');
    expect(decision.exitReason).toBe('target');
    expect(decision.baseNet!).toBeGreaterThan(0);
  });

  it('resolves same-minute target and stop in the adverse direction', () => {
    const candles = candlesForDay('2025-03-24');
    candles[4] = { ...candles[4]!, close: 100.5, high: 100.5 };
    candles[5] = { ...candles[5]!, open: 100.5 };
    candles[6] = { ...candles[6]!, high: 101.2, low: 99.8 };
    const decision = evaluateBrShockFade('2025-03-24', 'BRJ5', candles);
    expect(decision.status).toBe('trade');
    if (decision.status !== 'trade') throw new Error('Expected completed trade');
    expect(decision.exitReason).toBe('stop');
  });

  it('rejects a session with incomplete signal discovery coverage', () => {
    const candles = candlesForDay('2025-03-24').filter((candle) => !candle.time.endsWith('10:17:00'));
    expect(evaluateBrShockFade('2025-03-24', 'BRJ5', candles).status).toBe('signal_data_gap');
  });

  it('keeps an entered path unresolved if a required holding minute is absent', () => {
    const candles = candlesForDay('2025-03-24');
    const signalIndex = candles.findIndex((candle) => candle.time.endsWith('12:59:00'));
    candles[signalIndex] = { ...candles[signalIndex]!, close: 100.5, high: 100.5 };
    const entryIndex = candles.findIndex((candle) => candle.time.endsWith('13:00:00'));
    candles[entryIndex] = { ...candles[entryIndex]!, open: 100.5 };
    const missingIndex = candles.findIndex((candle) => candle.time.endsWith('13:07:00'));
    candles.splice(missingIndex, 1);
    expect(evaluateBrShockFade('2025-03-24', 'BRJ5', candles).status).toBe('unresolved_exit');
  });
});

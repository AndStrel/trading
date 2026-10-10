import { describe, expect, it } from 'vitest';
import { evaluateSiMainMomentum } from './si-main-session-momentum.js';
import type { SiCandle } from './si-first-hour.js';

function candles(date: string, firstMinute: number, count: number, price: number): SiCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const minute = firstMinute + index;
    return { time: `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`,
      open: price, close: price, high: price, low: price, volume: 1 };
  });
}

describe('Si main-session handoff momentum', () => {
  it('enters after the signal and charges round-trip costs', () => {
    const signal = candles('2026-09-25', 540, 60, 100);
    signal[59] = { ...signal[59]!, close: 101, high: 101 };
    const decision = evaluateSiMainMomentum({ date: '2026-09-25', contract: 'SiZ6', signalCandles: signal,
      holdingCandles: candles('2026-09-25', 600, 421, 101) });
    expect(decision).toMatchObject({ status: 'trade', side: 'long', entry: 101, exit: 101, exitReason: 'time' });
    expect(decision.baseNet).toBeLessThan(0);
  });

  it('chooses stop when both levels touch in the same minute', () => {
    const signal = candles('2026-09-25', 540, 60, 100);
    signal[59] = { ...signal[59]!, close: 101, high: 101 };
    const holding = candles('2026-09-25', 600, 421, 101);
    holding[1] = { ...holding[1]!, high: 103, low: 100 };
    expect(evaluateSiMainMomentum({ date: '2026-09-25', contract: 'SiZ6', signalCandles: signal,
      holdingCandles: holding })).toMatchObject({ status: 'trade', exitReason: 'stop', exit: 100.495 });
  });
});

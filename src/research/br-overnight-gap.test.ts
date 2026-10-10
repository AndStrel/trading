import { describe, expect, it } from 'vitest';

import { evaluateBrOvernightGap } from './br-overnight-gap.js';
import type { SiCandle } from './si-first-hour.js';

function candlesForDay(date: string): SiCandle[] {
  const result: SiCandle[] = [];
  for (let minute = 600; minute <= 1015; minute += 1) {
    if (minute >= 840 && minute <= 844) continue;
    const time = `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
    result.push({ time, open: 100, close: 100, high: 100, low: 100, volume: 1 });
  }
  return result;
}

describe('BR overnight gap continuation', () => {
  it('enters with a qualifying gap and fills at the fixed target', () => {
    const candles = candlesForDay('2025-03-25');
    candles[0] = { ...candles[0]!, open: 100.3, close: 100.3, high: 100.3 };
    candles[1] = { ...candles[1]!, open: 100.3 };
    candles[2] = { ...candles[2]!, high: 101.4 };
    const decision = evaluateBrOvernightGap('2025-03-25', 'BRJ5', 100, candles);
    expect(decision.status).toBe('trade');
    if (decision.status !== 'trade') throw new Error('Expected completed trade');
    expect(decision.side).toBe('long');
    expect(decision.exitReason).toBe('target');
    expect(decision.baseNet!).toBeGreaterThan(0);
  });

  it('uses the stop when a candle crosses both levels', () => {
    const candles = candlesForDay('2025-03-25');
    candles[0] = { ...candles[0]!, open: 100.3, close: 100.3, high: 100.3 };
    candles[1] = { ...candles[1]!, open: 100.3 };
    candles[2] = { ...candles[2]!, high: 101.4, low: 99.5 };
    const decision = evaluateBrOvernightGap('2025-03-25', 'BRJ5', 100, candles);
    expect(decision.status).toBe('trade');
    if (decision.status !== 'trade') throw new Error('Expected completed trade');
    expect(decision.exitReason).toBe('stop');
  });

  it('stays in cash when the overnight gap is below the threshold', () => {
    const candles = candlesForDay('2025-03-25');
    expect(evaluateBrOvernightGap('2025-03-25', 'BRJ5', 100, candles).status).toBe('cash');
  });

  it('fades the same qualifying gap when the fixed direction mode is selected', () => {
    const candles = candlesForDay('2025-03-25');
    candles[0] = { ...candles[0]!, open: 100.3, close: 100.3, high: 100.3 };
    candles[1] = { ...candles[1]!, open: 100.3 };
    const decision = evaluateBrOvernightGap('2025-03-25', 'BRJ5', 100, candles, 'fade');
    expect(decision.side).toBe('short');
  });

  it('keeps a missing reference and a missing entered path explicit', () => {
    const candles = candlesForDay('2025-03-25');
    expect(evaluateBrOvernightGap('2025-03-25', 'BRJ5', undefined, candles).status).toBe('missing_gap_reference');
    candles.splice(2, 1);
    expect(evaluateBrOvernightGap('2025-03-25', 'BRJ5', 99, candles).status).toBe('unresolved_exit');
  });
});

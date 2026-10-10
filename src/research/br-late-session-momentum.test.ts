import { describe, expect, it } from 'vitest';
import { evaluateBrLateMomentum } from './br-late-session-momentum.js';
import type { SiCandle } from './si-first-hour.js';

function window(date: string, firstMinute: number, count: number, price: number): SiCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const minute = firstMinute + index;
    return { time: `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`,
      open: price, close: price, high: price, low: price, volume: 1 };
  });
}

describe('BR late-session momentum', () => {
  it('enters at 17:01 and charges both sides on a flat late window', () => {
    const base = window('2026-09-25', 600, 421, 100);
    base[419] = { ...base[419]!, close: 101, high: 101 };
    const result = evaluateBrLateMomentum({ date: '2026-09-25', contract: 'BRV6', baseCandles: base,
      lateCandles: window('2026-09-25', 1020, 120, 101) });
    expect(result).toMatchObject({ status: 'trade', side: 'long', entry: 101, exit: 101, exitReason: 'time' });
    expect(result.baseNet).toBeLessThan(0);
  });

  it('uses the adverse stop if stop and target touch together', () => {
    const base = window('2026-09-25', 600, 421, 100);
    base[419] = { ...base[419]!, close: 101, high: 101 };
    const late = window('2026-09-25', 1020, 120, 101);
    late[1] = { ...late[1]!, high: 103, low: 100 };
    expect(evaluateBrLateMomentum({ date: '2026-09-25', contract: 'BRV6', baseCandles: base,
      lateCandles: late })).toMatchObject({ status: 'trade', exitReason: 'stop', exit: 100.192 });
  });
});

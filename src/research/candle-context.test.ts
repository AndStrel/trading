import { describe, expect, it } from 'vitest';
import { simulateAgreement, simulateVolumePatterns } from './candle-context.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number, volume: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume };
}

describe('volume and agreement patterns', () => {
  it('marks a day high-volume only against the prior twenty sessions', () => {
    const bars = Array.from({ length: 21 }, (_, index) => bar(`2024-01-${String(index + 1).padStart(2, '0')}`, 10, 11, index === 20 ? 100 : 1));
    bars.push(bar('2024-01-22', 10, 12, 1));
    const trades = simulateVolumePatterns(bars);
    expect(trades.at(-1)).toMatchObject({ day: '2024-01-22', pattern: 'H' });
  });

  it('trades only when the other two names share a body sign', () => {
    const target = [bar('2024-06-03', 1, 1, 1), bar('2024-06-04', 10, 11, 1)];
    const left = [bar('2024-06-03', 10, 12, 1)];
    const right = [bar('2024-06-03', 10, 9, 1)];
    expect(simulateAgreement(target, left, right)[0]?.pattern).toBe('X');
  });
});

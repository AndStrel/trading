import { describe, expect, it } from 'vitest';
import { eventReturnPct, costScenarios } from './trading-costs.js';
import { patternPasses, patternStats, simulatePatterns } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('candle pattern groups', () => {
  it('labels the three prior bodies and trades the next open to close', () => {
    const bars = [
      bar('2024-06-03', 10, 11),
      bar('2024-06-04', 11, 10),
      bar('2024-06-05', 10, 12),
      bar('2024-06-06', 20, 22),
    ];
    const trades = simulatePatterns(bars, 'body');
    expect(trades).toEqual([expect.objectContaining({
      day: '2024-06-06',
      pattern: 'UDU',
      netPct: eventReturnPct(20, 22, costScenarios.traderBeforeSubscription),
    })]);
  });

  it('does not treat a 2024-only pass as confirmation', () => {
    const discovery = patternStats([{ day: '2024-01-03', pattern: 'UUU', netPct: 1, stressPct: 1 }]);
    expect(patternPasses({ ...discovery, trades: 20, winRate: 0.55, meanNetPct: 0.1, meanStressPct: 0.05 }, 20, false)).toBe(true);
    expect(patternPasses({ trades: 20, winRate: 0.55, meanNetPct: 0.1, meanStressPct: -0.01 }, 20, true)).toBe(false);
  });
});

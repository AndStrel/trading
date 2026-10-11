import { describe, expect, it } from 'vitest';
import { eventReturnPct, costScenarios } from './trading-costs.js';
import { simulateSessionSplit } from './session-split.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('session split', () => {
  it('sells the next open after buying the close', () => {
    const trades = simulateSessionSplit([bar('2024-06-03', 100, 110), bar('2024-06-04', 120, 120)], 'overnight');
    expect(trades).toHaveLength(1);
    expect(trades[0]?.netPct).toBeCloseTo(eventReturnPct(110, 120, costScenarios.traderBeforeSubscription), 8);
  });

  it('keeps the cash session inside one day and steps five sessions without overlap', () => {
    const bars = ['2024-06-03', '2024-06-04', '2024-06-05', '2024-06-06', '2024-06-07', '2024-06-10'].map((day, index) => bar(day, 100 + index, 100 + index));
    expect(simulateSessionSplit(bars, 'cash-session')).toHaveLength(6);
    const held = simulateSessionSplit(bars, 'five-session');
    expect(held).toHaveLength(1);
    expect(held[0]?.day).toBe('2024-06-03');
    expect(held[0]?.exitDay).toBe('2024-06-10');
  });

  it('drops sessions after the frozen 2025 sample', () => {
    const trades = simulateSessionSplit([bar('2025-12-30', 100, 100), bar('2026-01-05', 110, 110)], 'overnight');
    expect(trades).toHaveLength(0);
  });
});

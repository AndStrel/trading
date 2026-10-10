import { describe, expect, it } from 'vitest';
import { qualitySummary } from './data-quality.js';

const candle = (time: string) => ({ instrumentId: 'test', time, open: 1, high: 1, low: 1, close: 1, volume: 1 });

describe('observed history quality', () => {
  it('does not count overnight closures as intraday missing minutes', () => {
    const quality = qualitySummary([
      candle('2025-01-03T07:00:00Z'), candle('2025-01-03T07:02:00Z'), candle('2025-01-06T07:00:00Z'),
    ], 3, 0, 0, 2025);
    expect(quality.withinDayMissingMinutes).toBe(1);
    expect(quality.withinDayGapCount).toBe(1);
    expect(quality.observedDays).toBe(2);
    expect(quality.missingMonths).toHaveLength(11);
    expect(quality.blockers).toContain('missing-months');
    expect(quality.calendarValidated).toBe(false);
  });
  it('uses Moscow dates and rejects invalid, duplicate and empty coverage', () => {
    const quality = qualitySummary([candle('2024-12-31T21:00:00Z'), candle('2024-12-31T21:00:00Z')], 4, 1, 1, 2025);
    expect(quality.monthCounts).toEqual({ '2025-01': 2 });
    expect(quality.outsideRequestedYearCount).toBe(0);
    expect(quality.blockers).toContain('unordered-or-duplicate-timestamps');
    expect(quality.blockers).toContain('invalid-source-rows');
    expect(qualitySummary([], 0, 0, 0, 2025).blockers).toContain('empty-archive');
  });
});

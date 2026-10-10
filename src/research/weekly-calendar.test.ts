import { describe, expect, it } from 'vitest';
import { weeklyCalendarRows, weeklyCalendarStats } from './weekly-calendar.js';

describe('weekly calendar execution', () => {
  it('uses only the fixed Moscow Tuesday and Friday minute opens across the year boundary', () => {
    const rows = weeklyCalendarRows([
      { time: '2023-12-26T07:05:00.000Z', open: 100 },
      { time: '2023-12-29T14:30:00.000Z', open: 102 },
      { time: '2024-01-02T07:05:00.000Z', open: 200 },
      { time: '2024-01-05T14:30:00.000Z', open: 202 },
      { time: '2024-01-05T20:49:00.000Z', open: 999 },
    ]);
    expect(rows.map((r) => r.week)).toEqual(['2023-12-25', '2024-01-01']);
    expect(rows[0]?.netPct).toBeGreaterThan(0);
    expect(rows[1]?.exit).toBe(202);
    expect(rows[1]?.netPct).toBeGreaterThan(0);
    expect(weeklyCalendarStats(rows).trades).toBe(2);
  });

  it('records missing execution candles rather than borrowing another minute', () => {
    const rows = weeklyCalendarRows([
      { time: '2024-01-09T07:05:00.000Z', open: 100 },
      { time: '2024-01-12T14:31:00.000Z', open: 110 },
    ]);
    expect(rows[0]).toMatchObject({ status: 'skipped', reason: 'missing-friday-exit', netPct: null });
    expect(weeklyCalendarStats(rows).trades).toBe(0);
  });
});

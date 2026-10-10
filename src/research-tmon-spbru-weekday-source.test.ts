import { describe, expect, it } from 'vitest';
import { weekdayDates } from './research-tmon-spbru-weekday-source.js';

describe('TMON SPBRU weekday date scope', () => {
  it('includes every weekday and no weekend over the frozen range', () => {
    const dates = weekdayDates();
    expect(dates).toHaveLength(410);
    expect(dates[0]).toBe('2025-03-03');
    expect(dates.at(-1)).toBe('2026-09-25');
    expect(dates.every((date) => {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      return day >= 1 && day <= 5;
    })).toBe(true);
  });
});

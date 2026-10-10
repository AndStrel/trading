import { describe, expect, it } from 'vitest';
import { tgld2025Weekdays, tgldWeekdays } from './research-tgld-2025-source.js';

describe('TGLD 2025 source calendar', () => {
  it('enumerates the full calendar year without weekends or duplicate dates', () => {
    const dates = tgld2025Weekdays();
    expect(dates).toHaveLength(261);
    expect(dates[0]).toBe('2025-01-01');
    expect(dates.at(-1)).toBe('2025-12-31');
    expect(new Set(dates).size).toBe(dates.length);
    for (const date of dates) {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
  });

  it('handles leap-year 2024 separately from the 2025 archive', () => {
    const dates = tgldWeekdays('2024');
    expect(dates).toHaveLength(262);
    expect(dates[0]).toBe('2024-01-01');
    expect(dates.at(-1)).toBe('2024-12-31');
    expect(dates).toContain('2024-02-29');
  });
});

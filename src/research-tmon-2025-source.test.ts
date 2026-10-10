import { describe, expect, it } from 'vitest';
import { tmon2025Weekdays } from './research-tmon-2025-source.js';

describe('TMON 2025 source calendar', () => {
  it('enumerates weekdays once without inventing holiday exclusions', () => {
    const dates = tmon2025Weekdays();
    expect(dates).toHaveLength(261);
    expect(dates[0]).toBe('2025-01-01');
    expect(dates.at(-1)).toBe('2025-12-31');
    expect(new Set(dates).size).toBe(dates.length);
    for (const date of dates) expect([0, 6]).not.toContain(new Date(`${date}T00:00:00Z`).getUTCDay());
  });
});

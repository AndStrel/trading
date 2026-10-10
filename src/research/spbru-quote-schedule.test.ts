import { describe, expect, it } from 'vitest';
import { scheduledSpbruQuoteMinute } from './spbru-quote-schedule.js';

describe('TMON@/SPBRU read-only schedule', () => {
  it('samples every five minutes in Moscow daytime, including weekends', () => {
    expect(scheduledSpbruQuoteMinute(new Date('2026-09-29T07:05:00Z'))).toBe('2026-09-29T10:05+03:00');
    expect(scheduledSpbruQuoteMinute(new Date('2026-09-27T19:55:00Z'))).toBe('2026-09-27T22:55+03:00');
    expect(scheduledSpbruQuoteMinute(new Date('2026-09-29T07:04:59Z'))).toBeNull();
    expect(scheduledSpbruQuoteMinute(new Date('2026-09-29T07:10:00Z'))).toBe('2026-09-29T10:10+03:00');
    expect(scheduledSpbruQuoteMinute(new Date('2026-09-29T20:00:00Z'))).toBeNull();
  });
});

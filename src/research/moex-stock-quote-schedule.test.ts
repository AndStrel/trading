import { describe, expect, it } from 'vitest';
import { scheduledQuoteMinute } from './moex-stock-quote-schedule.js';

describe('TMON quote schedule', () => {
  it('runs only on Moscow weekdays from 10:15 through 17:20', () => {
    expect(scheduledQuoteMinute(new Date('2026-09-26T08:00:00Z'))).toBeNull();
    expect(scheduledQuoteMinute(new Date('2026-09-28T07:14:59Z'))).toBeNull();
    expect(scheduledQuoteMinute(new Date('2026-09-28T07:15:00Z'))).toBe('2026-09-28T10:15');
    expect(scheduledQuoteMinute(new Date('2026-09-28T14:20:59Z'))).toBe('2026-09-28T17:20');
    expect(scheduledQuoteMinute(new Date('2026-09-28T14:21:00Z'))).toBeNull();
  });
});

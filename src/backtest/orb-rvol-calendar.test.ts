import { describe, expect, it } from 'vitest';

import {
  getMoexEquities2025SessionSchedule,
  MOEX_EQUITIES_2025_CALENDAR_ID,
} from './orb-rvol-calendar.js';

const sessionWindow = {
  startMinuteMoscow: 10 * 60,
  endMinuteMoscow: 18 * 60 + 40,
};

describe('MOEX equities 2025 calendar', () => {
  it('keeps documented New Year special trading dates eligible', () => {
    for (const sessionDate of ['2025-01-03', '2025-01-06', '2025-01-08']) {
      const schedule = getMoexEquities2025SessionSchedule({ sessionDate, ...sessionWindow });
      expect(schedule?.source).toBe(`${MOEX_EQUITIES_2025_CALENDAR_ID}:special`);
    }
  });

  it('rejects dates where the equity market was closed', () => {
    for (const sessionDate of [
      '2025-01-01',
      '2025-01-02',
      '2025-01-04',
      '2025-01-05',
      '2025-01-07',
      '2025-03-08',
      '2025-05-01',
      '2025-05-09',
      '2025-06-12',
      '2025-11-04',
      '2025-12-31',
    ]) {
      expect(getMoexEquities2025SessionSchedule({ sessionDate, ...sessionWindow })).toBeNull();
    }
  });

  it('rejects pre-experiment weekends but preserves the weekend-session phase', () => {
    expect(getMoexEquities2025SessionSchedule({ sessionDate: '2025-02-01', ...sessionWindow })).toBeNull();
    expect(
      getMoexEquities2025SessionSchedule({ sessionDate: '2025-03-01', ...sessionWindow })?.source,
    ).toBe(`${MOEX_EQUITIES_2025_CALENDAR_ID}:weekend`);
    expect(
      getMoexEquities2025SessionSchedule({ sessionDate: '2025-03-09', ...sessionWindow })?.source,
    ).toBe(`${MOEX_EQUITIES_2025_CALENDAR_ID}:weekend`);
  });
});

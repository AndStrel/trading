import { describe, expect, it } from 'vitest';

import {
  getMoexEquities2026SessionSchedule,
  getMoexEquities2025SessionSchedule,
  MOEX_EQUITIES_2026_CALENDAR_ID,
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

describe('MOEX equities 2026 regular-weekday calendar', () => {
  it('uses the documented dated main-session profiles', () => {
    expect(getMoexEquities2026SessionSchedule({ sessionDate: '2026-03-20' })).toEqual({
      startMinuteMoscow: 600,
      endMinuteMoscow: 1120,
      source: `${MOEX_EQUITIES_2026_CALENDAR_ID}:regular-pre-2026-03-23`,
    });
    expect(getMoexEquities2026SessionSchedule({ sessionDate: '2026-03-23' })).toEqual({
      startMinuteMoscow: 600,
      endMinuteMoscow: 1135,
      source: `${MOEX_EQUITIES_2026_CALENDAR_ID}:regular-2026-03-23-to-2026-09-13`,
    });
    expect(getMoexEquities2026SessionSchedule({ sessionDate: '2026-09-14' })).toEqual({
      startMinuteMoscow: 540,
      endMinuteMoscow: 1135,
      source: `${MOEX_EQUITIES_2026_CALENDAR_ID}:regular-from-2026-09-14`,
    });
  });

  it('excludes closed dates, special holiday sessions and weekends', () => {
    for (const sessionDate of [
      '2026-01-01', '2026-01-05', '2026-01-06', '2026-01-08', '2026-01-09',
      '2026-02-23', '2026-03-08', '2026-03-09', '2026-05-01', '2026-05-09',
      '2026-05-11', '2026-06-12', '2026-09-19', '2026-09-20', '2026-11-04',
      '2026-12-31', '2026-02-30', '2025-12-31',
    ]) {
      expect(getMoexEquities2026SessionSchedule({ sessionDate })).toBeNull();
    }
  });
});

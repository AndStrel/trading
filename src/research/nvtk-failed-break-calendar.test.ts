import { describe, expect, it } from 'vitest';

import {
  getMoexNvtkOrdinaryWeekdaySchedule,
  NVTK_FAILED_BREAK_CALENDAR_ID,
} from './nvtk-failed-break-calendar.js';

describe('MOEX NVTK 2023-2025 ordinary weekday calendar', () => {
  it('keeps regular weekday sessions at the historical main-session hours', () => {
    expect(getMoexNvtkOrdinaryWeekdaySchedule({ sessionDate: '2023-03-13' })).toEqual({
      startMinuteMoscow: 600,
      endMinuteMoscow: 1120,
      source: `${NVTK_FAILED_BREAK_CALENDAR_ID}:2023:ordinary-weekday`,
    });
    expect(getMoexNvtkOrdinaryWeekdaySchedule({ sessionDate: '2025-09-22' })?.startMinuteMoscow).toBe(600);
  });

  it('excludes closed dates, special holiday sessions, weekends and invalid years', () => {
    for (const sessionDate of [
      '2023-01-03', '2023-02-23', '2023-02-24', '2023-05-08', '2023-11-06',
      '2024-01-03', '2024-04-29', '2024-04-27', '2024-05-10', '2024-12-30',
      '2025-01-06', '2025-05-02', '2025-06-13', '2025-11-03', '2025-11-04',
      '2025-03-22', '2026-03-23', '2024-02-30',
    ]) {
      expect(getMoexNvtkOrdinaryWeekdaySchedule({ sessionDate })).toBeNull();
    }
  });
});

import type { OrbRvolSessionSchedule } from './orb-rvol.js';

export const MOEX_EQUITIES_2025_CALENDAR_ID = 'moex-equities-2025-v1' as const;
export const MOEX_EQUITIES_2026_CALENDAR_ID = 'moex-equities-2026-regular-weekdays-v1' as const;

const NO_TRADING_DATES_2025 = new Set([
  '2025-01-01',
  '2025-01-02',
  '2025-01-04',
  '2025-01-05',
  '2025-01-07',
  '2025-02-23',
  '2025-03-08',
  '2025-05-01',
  '2025-05-09',
  '2025-06-12',
  '2025-11-04',
  '2025-12-31',
]);

const SPECIAL_TRADING_DATES_2025 = new Set([
  '2025-01-03',
  '2025-01-06',
  '2025-01-08',
]);

const WEEKEND_TRADING_START_2025 = '2025-03-01';

// This experiment deliberately keeps only ordinary weekdays. MOEX ran separate
// weekend sessions and special holiday sessions in 2026; their different
// opening times are not pooled into this regular-session hypothesis.
const NO_TRADING_DATES_2026 = new Set([
  '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-07',
  '2026-02-23', '2026-03-08', '2026-05-01', '2026-05-09', '2026-06-12',
  '2026-11-04', '2026-12-31',
]);

const SPECIAL_TRADING_DATES_2026 = new Set([
  '2026-01-05', '2026-01-06', '2026-01-08', '2026-01-09', '2026-03-09', '2026-05-11',
]);

/**
 * Date eligibility for the 2025 MOEX equity research replay.
 *
 * This intentionally does not infer session hours. The caller supplies the
 * fixed historical window, while this calendar prevents closed dates from
 * entering the RVOL reference history.
 */
export function getMoexEquities2025SessionSchedule(input: {
  sessionDate: string;
  startMinuteMoscow: number;
  endMinuteMoscow: number;
}): OrbRvolSessionSchedule | null {
  if (!/^2025-\d{2}-\d{2}$/.test(input.sessionDate)) return null;
  const date = new Date(`${input.sessionDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.sessionDate) return null;
  if (NO_TRADING_DATES_2025.has(input.sessionDate)) return null;

  const dayOfWeek = date.getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  if (isWeekend && input.sessionDate < WEEKEND_TRADING_START_2025) return null;

  const sessionKind = isWeekend
    ? 'weekend'
    : SPECIAL_TRADING_DATES_2025.has(input.sessionDate)
      ? 'special'
      : 'regular';

  return {
    startMinuteMoscow: input.startMinuteMoscow,
    endMinuteMoscow: input.endMinuteMoscow,
    source: `${MOEX_EQUITIES_2025_CALENDAR_ID}:${sessionKind}`,
  };
}

/**
 * Date eligibility and dated main-session hours for the regular-weekday 2026
 * ORB replay. It excludes weekends and MOEX-designated special holiday sessions.
 */
export function getMoexEquities2026SessionSchedule(input: {
  sessionDate: string;
}): OrbRvolSessionSchedule | null {
  if (!/^2026-\d{2}-\d{2}$/.test(input.sessionDate)) return null;
  const date = new Date(`${input.sessionDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.sessionDate) return null;
  if (NO_TRADING_DATES_2026.has(input.sessionDate) || SPECIAL_TRADING_DATES_2026.has(input.sessionDate)) return null;

  const dayOfWeek = date.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;

  if (input.sessionDate < '2026-03-23') {
    return {
      startMinuteMoscow: 10 * 60,
      endMinuteMoscow: 18 * 60 + 40,
      source: `${MOEX_EQUITIES_2026_CALENDAR_ID}:regular-pre-2026-03-23`,
    };
  }
  if (input.sessionDate < '2026-09-14') {
    return {
      startMinuteMoscow: 10 * 60,
      endMinuteMoscow: 18 * 60 + 55,
      source: `${MOEX_EQUITIES_2026_CALENDAR_ID}:regular-2026-03-23-to-2026-09-13`,
    };
  }
  return {
    startMinuteMoscow: 9 * 60,
    endMinuteMoscow: 18 * 60 + 55,
    source: `${MOEX_EQUITIES_2026_CALENDAR_ID}:regular-from-2026-09-14`,
  };
}

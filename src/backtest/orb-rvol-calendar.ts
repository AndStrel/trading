import type { OrbRvolSessionSchedule } from './orb-rvol.js';

export const MOEX_EQUITIES_2025_CALENDAR_ID = 'moex-equities-2025-v1' as const;

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
    source: `${MOEX_EQUITIES_2025_CALENDAR_ID}:${"$"}{sessionKind}`,
  };
}

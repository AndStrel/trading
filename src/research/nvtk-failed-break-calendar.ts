import type { OrbRvolSessionSchedule } from '../backtest/orb-rvol.js';

export const NVTK_FAILED_BREAK_CALENDAR_ID = 'moex-nvtk-ordinary-weekdays-2023-2025-v1' as const;

const CLOSED_DATES = new Set([
  '2023-01-01', '2023-01-02', '2023-01-07', '2023-02-23', '2023-03-08', '2023-05-01',
  '2023-05-09', '2023-06-12', '2023-11-04',
  '2024-01-01', '2024-01-02', '2024-01-06', '2024-01-07', '2024-02-23', '2024-03-08',
  '2024-05-01', '2024-05-09', '2024-06-12', '2024-11-04', '2024-12-31',
  '2025-01-01', '2025-01-02', '2025-01-04', '2025-01-05', '2025-01-07', '2025-02-23',
  '2025-03-08', '2025-05-01', '2025-05-09', '2025-06-12', '2025-11-04', '2025-12-31',
]);

const SPECIAL_TRADING_DATES = new Set([
  '2023-01-03', '2023-01-04', '2023-01-05', '2023-01-06', '2023-02-24', '2023-05-08', '2023-11-06',
  '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-08', '2024-04-29', '2024-04-30',
  '2024-05-10', '2024-12-30',
  '2025-01-03', '2025-01-06', '2025-01-08', '2025-05-02', '2025-05-08', '2025-06-13', '2025-11-03',
]);

export function getMoexNvtkOrdinaryWeekdaySchedule(input: { sessionDate: string }): OrbRvolSessionSchedule | null {
  if (!/^202[3-5]-\d{2}-\d{2}$/.test(input.sessionDate)) return null;
  const date = new Date(`${input.sessionDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.sessionDate) return null;
  if (CLOSED_DATES.has(input.sessionDate) || SPECIAL_TRADING_DATES.has(input.sessionDate)) return null;
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return null;
  return {
    startMinuteMoscow: 10 * 60,
    endMinuteMoscow: 18 * 60 + 40,
    source: `${NVTK_FAILED_BREAK_CALENDAR_ID}:${input.sessionDate.slice(0, 4)}:ordinary-weekday`,
  };
}

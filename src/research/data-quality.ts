import type { HistoricalMinuteCandle } from '../history/market-data-store.js';

/** Observed coverage, NOT a trading-calendar completeness certificate. */
export function qualitySummary(
  candles: readonly HistoricalMinuteCandle[],
  rawRowCount: number,
  invalidRowCount: number,
  duplicateRowCount: number,
  year: number,
) {
  const monthCounts: Record<string, number> = {};
  const dayCounts: Record<string, number> = {};
  let largestGapMinutes = 0;
  let oneMinuteGapCount = 0;
  let withinDayMissingMinutes = 0;
  let withinDayGapCount = 0;
  let nonIncreasingTimestampCount = 0;
  let outsideRequestedYearCount = 0;
  let previousDay = '';
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;
    // Sources store UTC minute starts; exchange-local date determines coverage.
    const local = new Date(Date.parse(candle.time) + 3 * 60 * 60_000).toISOString();
    const day = local.slice(0, 10);
    const month = day.slice(0, 7);
    monthCounts[month] = (monthCounts[month] ?? 0) + 1;
    dayCounts[day] = (dayCounts[day] ?? 0) + 1;
    if (Number(local.slice(0, 4)) !== year) outsideRequestedYearCount += 1;
    if (index > 0) {
      const gap = (Date.parse(candle.time) - Date.parse(candles[index - 1]!.time)) / 60_000;
      if (gap === 1) oneMinuteGapCount += 1;
      if (gap <= 0) nonIncreasingTimestampCount += 1;
      largestGapMinutes = Math.max(largestGapMinutes, gap);
      if (previousDay === day && gap > 1) {
        withinDayGapCount += 1;
        withinDayMissingMinutes += gap - 1;
      }
    }
    previousDay = day;
  }
  const missingMonths = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
    .filter((month) => !monthCounts[month]);
  const blockers: string[] = [];
  if (candles.length === 0) blockers.push('empty-archive');
  if (invalidRowCount > 0) blockers.push('invalid-source-rows');
  if (duplicateRowCount > 0) blockers.push('duplicate-source-rows');
  if (nonIncreasingTimestampCount > 0) blockers.push('unordered-or-duplicate-timestamps');
  if (outsideRequestedYearCount > 0) blockers.push('outside-requested-year');
  if (missingMonths.length > 0) blockers.push('missing-months');
  return {
    rawRowCount, invalidRowCount, duplicateRowCount,
    invalidRate: rawRowCount === 0 ? 0 : invalidRowCount / rawRowCount,
    storedCandleCount: candles.length,
    firstCandleAt: candles[0]?.time ?? null,
    lastCandleAt: candles.at(-1)?.time ?? null,
    largestGapMinutes, oneMinuteGapCount, withinDayGapCount, withinDayMissingMinutes,
    nonIncreasingTimestampCount, outsideRequestedYearCount,
    observedDays: Object.keys(dayCounts).length, monthCounts, dayCounts, missingMonths, blockers,
    calendarValidated: false,
    warning: 'Observed candles only. Gaps can be breaks or no trades. Validate against an authoritative historical session calendar before strategy acceptance.',
  };
}

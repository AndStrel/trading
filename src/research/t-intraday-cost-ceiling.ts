import type { SiCandle } from './si-first-hour.js';
import { tLongReturn } from './t-morning-strength.js';

export type TCeilingDay = {
  date: string;
  ticker: 'TCSG' | 'T';
  status: 'incomplete' | 'complete';
  entry?: number;
  scheduledExit?: number;
  bestLaterHigh?: number;
  scheduledPro?: number;
  scheduledInvestor?: number;
  oraclePro?: number;
  oracleInvestor?: number;
};

function at(date: string, minute: number): string {
  return `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
}

export function evaluateTCeilingDay(input: {
  date: string;
  ticker: 'TCSG' | 'T';
  candles: readonly SiCandle[];
}): TCeilingDay {
  const { date, ticker, candles } = input;
  const byTime = new Map(candles.map((candle) => [candle.time, candle]));
  for (let minute = 631; minute <= 1015; minute += 1) {
    if (!byTime.has(at(date, minute))) return { date, ticker, status: 'incomplete' };
  }
  const entry = byTime.get(at(date, 631))!.open;
  const scheduledExit = byTime.get(at(date, 1015))!.open;
  // Deliberately clairvoyant upper bound: one later print high, excluding the entry candle.
  let bestLaterHigh = scheduledExit;
  for (let minute = 632; minute < 1015; minute += 1) {
    bestLaterHigh = Math.max(bestLaterHigh, byTime.get(at(date, minute))!.high);
  }
  const tick = ticker === 'TCSG' ? 0.1 : 0.02;
  return { date, ticker, status: 'complete', entry, scheduledExit, bestLaterHigh,
    scheduledPro: tLongReturn(entry, scheduledExit, 0.0005, 0, tick),
    scheduledInvestor: tLongReturn(entry, scheduledExit, 0.0005, 0.003, tick),
    oraclePro: tLongReturn(entry, bestLaterHigh, 0.0005, 0, tick),
    oracleInvestor: tLongReturn(entry, bestLaterHigh, 0.0005, 0.003, tick) };
}

export function summarizeTCeilingDays(days: readonly TCeilingDay[]) {
  const complete = days.filter((day) => day.status === 'complete');
  const metric = (key: 'scheduledPro' | 'scheduledInvestor' | 'oraclePro' | 'oracleInvestor') => {
    const values = complete.map((day) => day[key]!);
    return { positive: values.filter((value) => value > 0).length,
      positiveRate: values.length ? values.filter((value) => value > 0).length / values.length : null,
      mean: values.length ? values.reduce((total, value) => total + value, 0) / values.length : null };
  };
  return { dates: days.length, complete: complete.length, incomplete: days.length - complete.length,
    scheduledPro: metric('scheduledPro'), scheduledInvestor: metric('scheduledInvestor'),
    oraclePro: metric('oraclePro'), oracleInvestor: metric('oracleInvestor') };
}

import type { SiCandle } from './si-first-hour.js';
import type { InavCandle } from './tmon-inav-source.js';
import { tmonLongReturn } from './tmon-intraday-v2.js';

export type DiscountDecision = { date: string; status: 'missing_inav' | 'cash' | 'cancelled_entry' | 'unresolved_exit' | 'trade';
  signalTime?: string; discount?: number; entryTime?: string; exitTime?: string;
  entry?: number; exit?: number; gross?: number; baseNet?: number; stressNet?: number };

function minuteNumber(time: string): number {
  return Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));
}

export function evaluateTmonDiscountDay(date: string, tmon: readonly SiCandle[], inav: readonly InavCandle[]): DiscountDecision {
  if (!inav.some((row) => row.time === `${date} 10:15:00`)) return { date, status: 'missing_inav' };
  const byMinute = new Map(inav.map((row) => [row.time, row]));
  let signal: SiCandle | null = null;
  let discount = 0;
  for (const candle of tmon) {
    const minute = minuteNumber(candle.time);
    if (minute < 10 * 60 + 15 || minute > 14 * 60) continue;
    const nav = byMinute.get(candle.time);
    if (!nav) return { date, status: 'missing_inav' };
    const gap = candle.close / nav.close - 1;
    if (gap <= -0.0015) { signal = candle; discount = gap; break; }
  }
  if (!signal) return { date, status: 'cash' };
  const signalMinute = minuteNumber(signal.time);
  const entry = tmon.find((candle) => minuteNumber(candle.time) >= signalMinute + 1 && minuteNumber(candle.time) <= signalMinute + 2);
  if (!entry) return { date, status: 'cancelled_entry', signalTime: signal.time, discount };
  const exit = tmon.find((candle) => minuteNumber(candle.time) >= 16 * 60 + 55 && minuteNumber(candle.time) <= 17 * 60);
  if (!exit) return { date, status: 'unresolved_exit', signalTime: signal.time, discount, entryTime: entry.time, entry: entry.open };
  if (exit.time <= entry.time) throw new Error(`Invalid TMON discount exit ${date}`);
  return { date, status: 'trade', signalTime: signal.time, discount, entryTime: entry.time, exitTime: exit.time,
    entry: entry.open, exit: exit.open,
    gross: tmonLongReturn(entry.open, exit.open, 0),
    baseNet: tmonLongReturn(entry.open, exit.open, 0.0005),
    stressNet: tmonLongReturn(entry.open, exit.open, 0.001) };
}

export function summarizeTmonDiscount(decisions: readonly DiscountDecision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const base = trades.map((trade) => trade.baseNet!);
  const stress = trades.map((trade) => trade.stressNet!);
  const sum = base.reduce((total, value) => total + value, 0);
  return { dates: decisions.length, missingInav: decisions.filter((decision) => decision.status === 'missing_inav').length,
    cash: decisions.filter((decision) => decision.status === 'cash').length,
    cancelledEntry: decisions.filter((decision) => decision.status === 'cancelled_entry').length,
    unresolvedExit: decisions.filter((decision) => decision.status === 'unresolved_exit').length,
    trades: trades.length, baseWins: base.filter((value) => value > 0).length,
    baseWinRate: base.length ? base.filter((value) => value > 0).length / base.length : null,
    meanGross: trades.length ? trades.reduce((total, trade) => total + trade.gross!, 0) / trades.length : null,
    meanBase: base.length ? sum / base.length : null,
    meanStress: stress.length ? stress.reduce((total, value) => total + value, 0) / stress.length : null,
    sumBase: sum, withoutBestFiveSum: base.length >= 6 ? [...base].sort((left, right) => right - left).slice(5).reduce((total, value) => total + value, 0) : null };
}

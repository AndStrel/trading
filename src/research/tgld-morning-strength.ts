import type { SiCandle } from './si-first-hour.js';
import { tgldLongReturn } from './tgld-gold-lag.js';
import type { TgldMorningDecision } from './tgld-morning-selloff.js';

function minuteOfDay(time: string): number {
  return Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));
}

export function evaluateTgldMorningStrength(date: string, candles: readonly SiCandle[]): TgldMorningDecision {
  const byTime = new Map(candles.map((candle) => [candle.time, candle]));
  const anchor = byTime.get(`${date} 10:00:00`);
  const signal = byTime.get(`${date} 10:30:00`);
  if (!anchor || !signal) return { date, status: 'excluded', reason: 'anchor_or_signal_missing' };
  const signalReturn = signal.close / anchor.close - 1;
  if (signalReturn < 0.002) return { date, status: 'cash', signalReturn };
  const entry = candles.find((candle) => {
    const minute = minuteOfDay(candle.time);
    return minute >= 631 && minute <= 633;
  });
  if (!entry) return { date, status: 'cancelled_entry', reason: 'no_trade_within_three_minutes', signalReturn };
  const exit = candles.find((candle) => {
    const minute = minuteOfDay(candle.time);
    return minute >= 1015 && minute <= 1020;
  });
  if (!exit) return { date, status: 'unresolved_exit', signalReturn, entryTime: entry.time, entry: entry.open };
  return { date, status: 'trade', signalReturn, entryTime: entry.time, entry: entry.open,
    exitTime: exit.time, exit: exit.open, gross: tgldLongReturn(entry.open, exit.open, 0),
    baseNet: tgldLongReturn(entry.open, exit.open, 0.001),
    stressNet: tgldLongReturn(entry.open, exit.open, 0.002) };
}

export function summarizeTgldMorningStrength(decisions: readonly TgldMorningDecision[]) {
  const trades = decisions.filter((item) => item.status === 'trade');
  const values = trades.map((item) => item.baseNet!);
  const sum = (key: 'gross' | 'baseNet' | 'stressNet') => trades.reduce((total, item) => total + item[key]!, 0);
  const block = (items: readonly TgldMorningDecision[]) => {
    const complete = items.filter((item) => item.status === 'trade');
    return { trades: complete.length, winners: complete.filter((item) => item.baseNet! > 0).length,
      meanBaseNet: complete.length ? complete.reduce((total, item) => total + item.baseNet!, 0) / complete.length : null };
  };
  const sorted = [...values].sort((a, b) => a - b);
  return { dates: decisions.length, excluded: decisions.filter((item) => item.status === 'excluded').length,
    cash: decisions.filter((item) => item.status === 'cash').length,
    cancelledEntry: decisions.filter((item) => item.status === 'cancelled_entry').length,
    unresolvedExit: decisions.filter((item) => item.status === 'unresolved_exit').length,
    trades: trades.length, tradeDates: new Set(trades.map((item) => item.date)).size,
    grossWinners: trades.filter((item) => item.gross! > 0).length,
    winners: values.filter((value) => value > 0).length,
    winRate: trades.length ? values.filter((value) => value > 0).length / trades.length : null,
    meanGross: trades.length ? sum('gross') / trades.length : null,
    meanBaseNet: trades.length ? sum('baseNet') / trades.length : null,
    sumBaseNet: sum('baseNet'), meanStressNet: trades.length ? sum('stressNet') / trades.length : null,
    sumBaseNetWithoutBestFive: [...values].sort((a, b) => b - a).slice(5).reduce((total, value) => total + value, 0),
    worstBaseNet: sorted[0] ?? null,
    fifthPercentileBaseNet: sorted.length ? sorted[Math.floor(sorted.length * 0.05)] : null,
    byBlock: { januaryJune: block(decisions.filter((item) => item.date.slice(5, 7) <= '06')),
      julyDecember: block(decisions.filter((item) => item.date.slice(5, 7) >= '07')) } };
}

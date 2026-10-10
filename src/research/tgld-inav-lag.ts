import type { SiCandle } from './si-first-hour.js';
import type { InavCandle } from './tmon-inav-source.js';
import { tgldLongReturn } from './tgld-gold-lag.js';

export type TgldInavDecision = { date: string;
  status: 'excluded' | 'cash' | 'cancelled_entry' | 'unresolved_exit' | 'trade';
  reason?: string; signalTime?: string; relativeLag?: number;
  entryTime?: string; entry?: number; exitTime?: string; exit?: number;
  gross?: number; baseNet?: number; stressNet?: number };

const minuteOfDay = (time: string) => Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));

export function evaluateTgldInavLag(date: string, fundCandles: readonly SiCandle[], inavCandles: readonly InavCandle[]): TgldInavDecision {
  const fund = new Map(fundCandles.map((candle) => [candle.time, candle]));
  const nav = new Map(inavCandles.map((candle) => [candle.time, candle]));
  const fundAnchor = fund.get(`${date} 10:00:00`)?.close;
  const navAnchor = nav.get(`${date} 10:00:00`)?.close;
  if (fundAnchor === undefined || navAnchor === undefined) return { date, status: 'excluded', reason: 'anchor_missing' };
  for (const candle of fundCandles) {
    const minute = minuteOfDay(candle.time);
    if (minute < 615 || minute > 840) continue;
    const navCandle = nav.get(candle.time);
    if (!navCandle) continue;
    const navMove = navCandle.close / navAnchor - 1;
    const fundMove = candle.close / fundAnchor - 1;
    const relativeLag = navMove - fundMove;
    if (navMove < 0 || relativeLag < 0.0025) continue;
    const entry = fundCandles.find((candidate) => {
      const delta = minuteOfDay(candidate.time) - minute;
      return delta >= 1 && delta <= 2;
    });
    if (!entry) return { date, status: 'cancelled_entry', reason: 'no_trade_within_two_minutes', signalTime: candle.time, relativeLag };
    const exit = fundCandles.find((candidate) => minuteOfDay(candidate.time) >= 1015 && minuteOfDay(candidate.time) <= 1020);
    if (!exit) return { date, status: 'unresolved_exit', signalTime: candle.time, relativeLag, entryTime: entry.time, entry: entry.open };
    return { date, status: 'trade', signalTime: candle.time, relativeLag,
      entryTime: entry.time, entry: entry.open, exitTime: exit.time, exit: exit.open,
      gross: tgldLongReturn(entry.open, exit.open, 0),
      baseNet: tgldLongReturn(entry.open, exit.open, 0.001),
      stressNet: tgldLongReturn(entry.open, exit.open, 0.002) };
  }
  return { date, status: 'cash' };
}

export function summarizeTgldInavLag(decisions: readonly TgldInavDecision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const base = trades.map((trade) => trade.baseNet!);
  const stress = trades.map((trade) => trade.stressNet!);
  const baseSum = base.reduce((total, value) => total + value, 0);
  return { dates: decisions.length, excluded: decisions.filter((decision) => decision.status === 'excluded').length,
    cash: decisions.filter((decision) => decision.status === 'cash').length,
    cancelledEntry: decisions.filter((decision) => decision.status === 'cancelled_entry').length,
    unresolvedExit: decisions.filter((decision) => decision.status === 'unresolved_exit').length,
    trades: trades.length, grossWinners: trades.filter((trade) => trade.gross! > 0).length,
    baseWinners: base.filter((value) => value > 0).length,
    baseWinRate: base.length ? base.filter((value) => value > 0).length / base.length : null,
    meanGross: trades.length ? trades.reduce((total, trade) => total + trade.gross!, 0) / trades.length : null,
    meanBaseNet: trades.length ? baseSum / trades.length : null,
    meanStressNet: stress.length ? stress.reduce((total, value) => total + value, 0) / stress.length : null,
    baseSum, worstBaseNet: base.length ? Math.min(...base) : null,
    withoutBestFiveSum: base.length >= 6 ? [...base].sort((left, right) => right - left).slice(5).reduce((total, value) => total + value, 0) : null };
}

import type { SiCandle } from './si-first-hour.js';
import type { GoldPriceCandle } from '../research-gold-spot-2026-source.js';

export type TgldGoldLagDecision = {
  date: string;
  status: 'excluded' | 'cash' | 'cancelled_entry' | 'unresolved_exit' | 'trade';
  reason?: string;
  signalTime?: string;
  relativeLag?: number;
  entryTime?: string;
  entry?: number;
  exitTime?: string;
  exit?: number;
  gross?: number;
  baseNet?: number;
  stressNet?: number;
};

function minuteOfDay(time: string): number {
  return Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));
}

export function tgldLongReturn(entry: number, exit: number, slippagePerSide: number): number {
  if (![entry, exit].every((value) => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(slippagePerSide) || slippagePerSide < 0 || slippagePerSide >= 1) throw new Error('Invalid TGLD return input');
  if (slippagePerSide === 0) return exit / entry - 1;
  const buy = Math.ceil(entry * (1 + slippagePerSide) * 100 - 1e-9) / 100;
  const sell = Math.floor(exit * (1 - slippagePerSide) * 100 + 1e-9) / 100;
  return sell / buy - 1;
}

export function evaluateTgldGoldLag(input: {
  date: string;
  fundCandles: readonly SiCandle[];
  goldCandles: readonly GoldPriceCandle[];
}): TgldGoldLagDecision {
  const { date } = input;
  const fund = new Map(input.fundCandles.map((candle) => [candle.time, candle]));
  const gold = new Map(input.goldCandles.map((candle) => [candle.time, candle]));
  const fundAnchor = fund.get(`${date} 10:00:00`)?.close;
  const goldAnchor = gold.get(`${date} 10:00:00`)?.close;
  if (fundAnchor === undefined || goldAnchor === undefined) return { date, status: 'excluded', reason: 'anchor_missing' };
  for (const candle of input.fundCandles) {
    const minute = minuteOfDay(candle.time);
    if (minute < 615 || minute > 840) continue;
    const goldCandle = gold.get(candle.time);
    if (!goldCandle) continue;
    const goldMove = goldCandle.close / goldAnchor - 1;
    const fundMove = candle.close / fundAnchor - 1;
    const relativeLag = goldMove - fundMove;
    if (goldMove < 0 || relativeLag < 0.0025) continue;
    const next = input.fundCandles.find((candidate) => {
      const delta = minuteOfDay(candidate.time) - minute;
      return delta >= 1 && delta <= 2;
    });
    if (!next) return { date, status: 'cancelled_entry', reason: 'no_fund_trade_within_two_minutes', signalTime: candle.time, relativeLag };
    const exit = input.fundCandles.find((candidate) => minuteOfDay(candidate.time) >= 1015 && minuteOfDay(candidate.time) <= 1020);
    if (!exit) return { date, status: 'unresolved_exit', signalTime: candle.time, relativeLag, entryTime: next.time, entry: next.open };
    return { date, status: 'trade', signalTime: candle.time, relativeLag,
      entryTime: next.time, entry: next.open, exitTime: exit.time, exit: exit.open,
      gross: tgldLongReturn(next.open, exit.open, 0),
      baseNet: tgldLongReturn(next.open, exit.open, 0.001),
      stressNet: tgldLongReturn(next.open, exit.open, 0.002) };
  }
  return { date, status: 'cash' };
}

export function summarizeTgldGoldLag(decisions: readonly TgldGoldLagDecision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const values = trades.map((trade) => trade.baseNet!);
  const sum = (key: 'gross' | 'baseNet' | 'stressNet') => trades.reduce((total, trade) => total + trade[key]!, 0);
  const blocks = (items: readonly TgldGoldLagDecision[]) => {
    const completed = items.filter((decision) => decision.status === 'trade');
    return { trades: completed.length, winners: completed.filter((trade) => trade.baseNet! > 0).length,
      meanBaseNet: completed.length ? completed.reduce((total, trade) => total + trade.baseNet!, 0) / completed.length : null };
  };
  const sorted = [...values].sort((a, b) => a - b);
  return { dates: decisions.length, excluded: decisions.filter((decision) => decision.status === 'excluded').length,
    cash: decisions.filter((decision) => decision.status === 'cash').length,
    cancelledEntry: decisions.filter((decision) => decision.status === 'cancelled_entry').length,
    unresolvedExit: decisions.filter((decision) => decision.status === 'unresolved_exit').length,
    trades: trades.length, tradeDates: new Set(trades.map((trade) => trade.date)).size,
    grossWinners: trades.filter((trade) => trade.gross! > 0).length,
    winners: values.filter((value) => value > 0).length,
    winRate: trades.length ? values.filter((value) => value > 0).length / trades.length : null,
    meanGross: trades.length ? sum('gross') / trades.length : null,
    meanBaseNet: trades.length ? sum('baseNet') / trades.length : null,
    sumBaseNet: sum('baseNet'),
    meanStressNet: trades.length ? sum('stressNet') / trades.length : null,
    worstBaseNet: sorted[0] ?? null,
    fifthPercentileBaseNet: sorted.length ? sorted[Math.floor(sorted.length * 0.05)] : null,
    byBlock: { marchMay: blocks(decisions.filter((decision) => decision.date <= '2026-05-31')),
      juneSeptember: blocks(decisions.filter((decision) => decision.date >= '2026-06-01')) } };
}

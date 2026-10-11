import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

export type SessionKind = 'overnight' | 'cash-session' | 'five-session';
export type SessionTrade = { day: string; exitDay: string; netPct: number; stressPct: number };

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

export function sessionBars(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

export function simulateSessionSplit(input: readonly DailyBar[], kind: SessionKind): SessionTrade[] {
  const bars = sessionBars(input);
  const trades: SessionTrade[] = [];
  const push = (day: string, exitDay: string, entry: number, exit: number) => {
    trades.push({
      day,
      exitDay,
      netPct: eventReturnPct(entry, exit, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entry, exit, traderStress),
    });
  };
  if (kind === 'overnight') {
    for (let index = 0; index < bars.length - 1; index += 1) push(bars[index]!.day, bars[index + 1]!.day, bars[index]!.close, bars[index + 1]!.open);
  } else if (kind === 'cash-session') {
    for (const bar of bars) push(bar.day, bar.day, bar.open, bar.close);
  } else {
    for (let index = 0; index + 5 < bars.length; index += 5) push(bars[index]!.day, bars[index + 5]!.day, bars[index]!.open, bars[index + 5]!.open);
  }
  return trades;
}

export function sessionGateReasons(trades: readonly SessionTrade[], minTrades: number): string[] {
  const reasons: string[] = [];
  if (trades.length < minTrades) reasons.push('too-few-trades');
  const winners = trades.filter((trade) => trade.netPct > 0).length;
  if (trades.length === 0 || winners / trades.length < 0.51) reasons.push('failed-win-rate');
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanNet = mean(trades.map((trade) => trade.netPct));
  const meanStress = mean(trades.map((trade) => trade.stressPct));
  if (meanNet === null || meanNet <= 0 || meanStress === null || meanStress <= 0) reasons.push('failed-mean');
  for (const year of [2022, 2023, 2024, 2025]) {
    const yearMean = mean(trades.filter((trade) => trade.day.startsWith(String(year))).map((trade) => trade.netPct));
    if (yearMean === null || yearMean <= 0) reasons.push(`failed-${year}`);
  }
  const byDay = new Map<string, number>();
  for (const trade of trades) byDay.set(trade.day, (byDay.get(trade.day) ?? 0) + trade.netPct);
  const days = [...byDay.values()].sort((a, b) => b - a);
  if (days.length <= 5 || days.slice(5).reduce((sum, value) => sum + value, 0) <= 0) reasons.push('failed-without-best-five-days');
  return reasons;
}

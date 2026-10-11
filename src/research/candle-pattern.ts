import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

export type PatternFamily = 'body' | 'step';
export type PatternTrade = { day: string; pattern: string; netPct: number; stressPct: number };

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

export function windowBars(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => bar.day >= '2024-01-01' && bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

function sign(up: boolean): 'U' | 'D' {
  return up ? 'U' : 'D';
}

export function simulatePatterns(input: readonly DailyBar[], family: PatternFamily): PatternTrade[] {
  const bars = windowBars(input);
  const trades: PatternTrade[] = [];
  const start = family === 'body' ? 3 : 4;
  for (let index = start; index < bars.length; index += 1) {
    const pattern = family === 'body'
      ? [index - 3, index - 2, index - 1].map((at) => sign(bars[at]!.close >= bars[at]!.open)).join('')
      : [index - 3, index - 2, index - 1].map((at) => sign(bars[at]!.close >= bars[at - 1]!.close)).join('');
    const bar = bars[index]!;
    trades.push({
      day: bar.day,
      pattern,
      netPct: eventReturnPct(bar.open, bar.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(bar.open, bar.close, traderStress),
    });
  }
  return trades;
}

export type PatternStats = { trades: number; winRate: number | null; meanNetPct: number | null; meanStressPct: number | null };

export function patternStats(trades: readonly PatternTrade[]): PatternStats {
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const winners = trades.filter((trade) => trade.netPct > 0).length;
  return {
    trades: trades.length,
    winRate: trades.length === 0 ? null : winners / trades.length,
    meanNetPct: mean(trades.map((trade) => trade.netPct)),
    meanStressPct: mean(trades.map((trade) => trade.stressPct)),
  };
}

export function patternPasses(stats: PatternStats, minTrades: number, requireStress: boolean): boolean {
  return stats.trades >= minTrades &&
    stats.winRate !== null && stats.winRate >= 0.51 &&
    stats.meanNetPct !== null && stats.meanNetPct > 0 &&
    (!requireStress || (stats.meanStressPct !== null && stats.meanStressPct > 0));
}

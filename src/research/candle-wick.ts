import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { windowBars, type PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

export function wickSide(bar: DailyBar): 'L' | 'U' | 'E' {
  if (![bar.high, bar.low].every((value) => Number.isFinite(value))) throw new Error('Invalid wick');
  if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) throw new Error('Wick outside the bar');
  const upper = bar.high - Math.max(bar.open, bar.close);
  const lower = Math.min(bar.open, bar.close) - bar.low;
  if (lower > upper) return 'L';
  if (upper > lower) return 'U';
  return 'E';
}

export function simulateWickPatterns(input: readonly DailyBar[]): PatternTrade[] {
  const bars = windowBars(input);
  const trades: PatternTrade[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index]!;
    trades.push({
      day: bar.day,
      pattern: wickSide(bars[index - 1]!),
      netPct: eventReturnPct(bar.open, bar.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(bar.open, bar.close, traderStress),
    });
  }
  return trades;
}

export function wickGroupPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((a, b) => b - a).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weeklyBars } from './candle-week.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function zone(high: number, low: number, close: number): 'H' | 'M' | 'L' {
  const span = high - low;
  if (!(span > 0)) return 'M';
  const position = (close - low) / span;
  if (position >= 2 / 3) return 'H';
  if (position < 1 / 3) return 'L';
  return 'M';
}

export function simulateWeekRange(input: readonly DailyBar[]): PatternTrade[] {
  const weeks = weeklyBars(input);
  const trades: PatternTrade[] = [];
  for (let index = 1; index < weeks.length; index += 1) {
    const week = weeks[index]!;
    if (week.monday < '2024-01-01' || week.monday > '2025-12-31') continue;
    const prior = weeks[index - 1]!;
    trades.push({
      day: week.monday,
      pattern: zone(prior.high, prior.low, prior.close),
      netPct: eventReturnPct(week.open, week.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(week.open, week.close, traderStress),
    });
  }
  return trades;
}

export function weekRangePasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 12) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((a, b) => b - a).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

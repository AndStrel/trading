import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { windowBars, type PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

export type InsideFamily = 'bar' | 'bar-body';
const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function valid(bar: DailyBar) {
  if (![bar.high, bar.low].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Invalid extreme');
  if (bar.high < bar.low || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)) {
    throw new Error('Range does not contain the body');
  }
}

export function barRelation(prior: DailyBar, current: DailyBar): 'I' | 'O' | 'N' {
  valid(prior);
  valid(current);
  if (current.high < prior.high && current.low > prior.low) return 'I';
  if (current.high > prior.high && current.low < prior.low) return 'O';
  return 'N';
}

export function simulateInsidePatterns(input: readonly DailyBar[], family: InsideFamily): PatternTrade[] {
  const bars = windowBars(input);
  const trades: PatternTrade[] = [];
  for (let index = 2; index < bars.length; index += 1) {
    const relation = barRelation(bars[index - 2]!, bars[index - 1]!);
    const body = bars[index - 1]!.close >= bars[index - 1]!.open ? 'U' : 'D';
    const pattern = family === 'bar' ? relation : `${relation}${body}`;
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

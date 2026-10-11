import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { windowBars, type PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

export type RangeFamily = 'one-day' | 'two-day';
const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

export function rangeZone(bar: DailyBar): 'H' | 'M' | 'L' {
  if (![bar.high, bar.low].every((value) => Number.isFinite(value))) throw new Error('Invalid range');
  if (bar.high < bar.low || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)) {
    throw new Error('Range does not contain the body');
  }
  const span = bar.high - bar.low;
  if (!(span > 0)) return 'M';
  const position = (bar.close - bar.low) / span;
  if (position >= 2 / 3) return 'H';
  if (position < 1 / 3) return 'L';
  return 'M';
}

export function simulateRangePatterns(input: readonly DailyBar[], family: RangeFamily): PatternTrade[] {
  const bars = windowBars(input);
  const trades: PatternTrade[] = [];
  const start = family === 'one-day' ? 1 : 2;
  for (let index = start; index < bars.length; index += 1) {
    const pattern = family === 'one-day'
      ? rangeZone(bars[index - 1]!)
      : `${rangeZone(bars[index - 2]!)}${rangeZone(bars[index - 1]!)}`;
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

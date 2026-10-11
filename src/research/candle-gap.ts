import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { windowBars, type PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

export type GapFamily = 'gap-sign' | 'open-vs-range';
const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function valid(bar: DailyBar) {
  if (![bar.high, bar.low, bar.open, bar.close].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Invalid price');
  if (bar.high < bar.low || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)) {
    throw new Error('Range does not contain the body');
  }
}

export function gapSign(prior: DailyBar, current: DailyBar): 'U' | 'D' | 'Z' {
  valid(prior);
  valid(current);
  if (current.open > prior.close) return 'U';
  if (current.open < prior.close) return 'D';
  return 'Z';
}

export function openVersusRange(prior: DailyBar, current: DailyBar): 'A' | 'B' | 'I' {
  valid(prior);
  valid(current);
  if (current.open > prior.high) return 'A';
  if (current.open < prior.low) return 'B';
  return 'I';
}

export function simulateGapPatterns(input: readonly DailyBar[], family: GapFamily): PatternTrade[] {
  const bars = windowBars(input);
  const trades: PatternTrade[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const prior = bars[index - 1]!;
    const bar = bars[index]!;
    const pattern = family === 'gap-sign' ? gapSign(prior, bar) : openVersusRange(prior, bar);
    trades.push({
      day: bar.day,
      pattern,
      netPct: eventReturnPct(bar.open, bar.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(bar.open, bar.close, traderStress),
    });
  }
  return trades;
}

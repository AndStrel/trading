import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function ordered(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || bar.high < bar.low || bar.low <= 0 ||
    bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

function direction(bars: readonly DailyBar[], index: number): 'A' | 'B' | null {
  const first = bars[index - 1]!;
  const a = bars[index]!;
  const b = bars[index + 1]!;
  const c = bars[index + 2]!;
  if (a.close > first.high && b.close > a.high && c.close > b.high) return 'A';
  if (a.close < first.low && b.close < a.low && c.close < b.low) return 'B';
  return null;
}

export function simulateThreeBreak(input: readonly DailyBar[]): PatternTrade[] {
  const bars = ordered(input);
  const trades: PatternTrade[] = [];
  let index = 1;
  while (index + 7 < bars.length) {
    const pattern = direction(bars, index);
    if (!pattern) {
      index += 1;
      continue;
    }
    const entry = bars[index + 3]!;
    const exit = bars[index + 7]!;
    if (entry.day >= '2024-01-01' && entry.day <= '2025-12-31') {
      trades.push({
        day: entry.day,
        pattern,
        netPct: eventReturnPct(entry.open, exit.close, costScenarios.traderBeforeSubscription),
        stressPct: eventReturnPct(entry.open, exit.close, traderStress),
      });
    }
    index += 8;
  }
  return trades;
}

export function threeBreakPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 8) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

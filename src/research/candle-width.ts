import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function ordered(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || bar.high < bar.low || bar.low <= 0 ||
    !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

function width(bar: DailyBar): number {
  return (bar.high - bar.low) / bar.close;
}

export function simulateWidth(input: readonly DailyBar[]): PatternTrade[] {
  const bars = ordered(input);
  const trades: PatternTrade[] = [];
  for (let index = 21; index + 6 < bars.length; index += 6) {
    const signal = bars[index]!;
    const entry = bars[index + 1]!;
    if (entry.day < '2024-01-01') continue;
    const widths = bars.slice(index - 20, index).map(width).sort((a, b) => a - b);
    const median = (widths[9]! + widths[10]!) / 2;
    const exit = bars[index + 6]!;
    trades.push({
      day: entry.day,
      pattern: width(signal) > median ? 'H' : 'L',
      netPct: eventReturnPct(entry.open, exit.open, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entry.open, exit.open, traderStress),
    });
  }
  return trades;
}

export function widthGroupPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((a, b) => b - a).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

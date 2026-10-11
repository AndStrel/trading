import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function ordered(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

function daysBetween(left: string, right: string): number {
  return (Date.parse(`${right}T12:00:00Z`) - Date.parse(`${left}T12:00:00Z`)) / 86_400_000;
}

export function simulateLongGap(input: readonly DailyBar[]): PatternTrade[] {
  const bars = ordered(input);
  const trades: PatternTrade[] = [];
  let index = 0;
  while (index + 5 < bars.length) {
    const signal = bars[index]!;
    const entry = bars[index + 1]!;
    if (daysBetween(signal.day, entry.day) <= 3 || signal.close === signal.open) {
      index += 1;
      continue;
    }
    const exit = bars[index + 5]!;
    if (entry.day >= '2024-01-01') {
      trades.push({
        day: entry.day,
        pattern: signal.close > signal.open ? 'U' : 'D',
        netPct: eventReturnPct(entry.open, exit.close, costScenarios.traderBeforeSubscription),
        stressPct: eventReturnPct(entry.open, exit.close, traderStress),
      });
    }
    index += 6;
  }
  return trades;
}

export function longGapPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 4) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

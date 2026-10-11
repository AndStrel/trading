import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { windowBars, type PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
const labels = ['', 'MON', 'TUE', 'WED', 'THU', 'FRI'] as const;

export function simulateWeekday(input: readonly DailyBar[]): PatternTrade[] {
  const trades: PatternTrade[] = [];
  for (const bar of windowBars(input)) {
    const index = new Date(`${bar.day}T12:00:00Z`).getUTCDay();
    if (index < 1 || index > 5) continue;
    trades.push({
      day: bar.day,
      pattern: labels[index]!,
      netPct: eventReturnPct(bar.open, bar.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(bar.open, bar.close, traderStress),
    });
  }
  return trades;
}

export function weekdayPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 40) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

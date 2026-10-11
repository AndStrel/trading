import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weeklyBars } from './candle-week.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function bucket(monday: string): 'W1' | 'W2' | 'W3' | 'W4' | 'W5' {
  const day = Number(monday.slice(8, 10));
  if (day <= 7) return 'W1';
  if (day <= 14) return 'W2';
  if (day <= 21) return 'W3';
  if (day <= 28) return 'W4';
  return 'W5';
}

export function simulateWeekOfMonth(input: readonly DailyBar[]): PatternTrade[] {
  const trades: PatternTrade[] = [];
  for (const week of weeklyBars(input)) {
    if (week.monday < '2024-01-01' || week.monday > '2025-12-31') continue;
    trades.push({
      day: week.monday,
      pattern: bucket(week.monday),
      netPct: eventReturnPct(week.open, week.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(week.open, week.close, traderStress),
    });
  }
  return trades;
}

export function weekOfMonthPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 8) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

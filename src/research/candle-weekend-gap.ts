import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weekMonday } from './candle-week.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

export function simulateWeekendGaps(input: readonly DailyBar[]): PatternTrade[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const weeks = new Map<string, DailyBar[]>();
  for (const bar of bars) {
    const monday = weekMonday(bar.day);
    weeks.set(monday, [...(weeks.get(monday) ?? []), bar]);
  }
  const ordered = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b));
  const trades: PatternTrade[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const [monday, rows] = ordered[index]!;
    if (monday < '2024-01-01' || monday > '2025-12-31') continue;
    const mondayBar = rows.find((bar) => bar.day === monday);
    const priorClose = ordered[index - 1]![1].at(-1)!.close;
    if (!mondayBar) continue;
    if (mondayBar.open === priorClose) continue;
    trades.push({
      day: monday,
      pattern: mondayBar.open > priorClose ? 'U' : 'D',
      netPct: eventReturnPct(mondayBar.open, rows.at(-1)!.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(mondayBar.open, rows.at(-1)!.close, traderStress),
    });
  }
  return trades;
}

export function gapGroupPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const winners = trades.filter((trade) => trade.netPct > 0).length;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((a, b) => b - a).slice(1).reduce((sum, value) => sum + value, 0);
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / trades.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

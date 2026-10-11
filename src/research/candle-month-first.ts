import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

export function simulateMonthFirst(input: readonly DailyBar[]): PatternTrade[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const groups = new Map<string, DailyBar[]>();
  for (const bar of bars) groups.set(bar.day.slice(0, 7), [...(groups.get(bar.day.slice(0, 7)) ?? []), bar]);
  const trades: PatternTrade[] = [];
  for (const [month, rows] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (month < '2024-01' || month > '2025-12' || rows.length < 2) continue;
    const first = rows[0]!;
    if (first.close === first.open) continue;
    const entry = rows[1]!;
    const exit = rows.at(-1)!;
    trades.push({
      day: entry.day,
      pattern: first.close > first.open ? 'U' : 'D',
      netPct: eventReturnPct(entry.open, exit.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entry.open, exit.close, traderStress),
    });
  }
  return trades;
}

export function monthFirstPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 4) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weekMonday } from './candle-week.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

export function simulateMondayPatterns(input: readonly DailyBar[]): PatternTrade[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const weeks = new Map<string, DailyBar[]>();
  for (const bar of bars) {
    const monday = weekMonday(bar.day);
    weeks.set(monday, [...(weeks.get(monday) ?? []), bar]);
  }
  const trades: PatternTrade[] = [];
  for (const [monday, rows] of [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (monday < '2024-01-01' || monday > '2025-12-31') continue;
    const signal = rows.find((bar) => bar.day === monday);
    const rest = rows.filter((bar) => bar.day > monday);
    if (!signal || rest.length === 0) continue;
    const move = signal.close / signal.open - 1;
    if (move === 0) continue;
    const entry = rest[0]!;
    const exit = rest.at(-1)!;
    trades.push({
      day: monday,
      pattern: move > 0 ? 'U' : 'D',
      netPct: eventReturnPct(entry.open, exit.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entry.open, exit.close, traderStress),
    });
  }
  return trades;
}

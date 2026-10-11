import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

export function weekMonday(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

type WeekBar = { monday: string; open: number; high: number; low: number; close: number };

export function weeklyBars(input: readonly DailyBar[]): WeekBar[] {
  const days = input.filter((bar) => bar.day <= '2025-12-30');
  if (days.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= days[index - 1]!.day))) throw new Error('Invalid daily bars');
  const weeks = new Map<string, DailyBar[]>();
  for (const bar of days) {
    const monday = weekMonday(bar.day);
    weeks.set(monday, [...(weeks.get(monday) ?? []), bar]);
  }
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([monday, bars]) => ({
    monday,
    open: bars[0]!.open,
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
    close: bars.at(-1)!.close,
  }));
}

export function simulateWeekPatterns(input: readonly DailyBar[]): PatternTrade[] {
  const weeks = weeklyBars(input);
  const trades: PatternTrade[] = [];
  for (let index = 1; index < weeks.length; index += 1) {
    const prior = weeks[index - 1]!;
    const week = weeks[index]!;
    if (week.monday < '2024-01-01' || week.monday > '2025-12-31') continue;
    trades.push({
      day: week.monday,
      pattern: prior.close >= prior.open ? 'U' : 'D',
      netPct: eventReturnPct(week.open, week.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(week.open, week.close, traderStress),
    });
  }
  return trades;
}

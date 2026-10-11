import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weekMonday } from './candle-week.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

type WeekBar = { monday: string; open: number; close: number; side: 'H' | 'L' | null };

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function weeksOf(input: readonly DailyBar[]): WeekBar[] {
  const days = input.filter((bar) => bar.day <= '2025-12-30');
  if (days.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= days[index - 1]!.day))) throw new Error('Invalid daily bars');
  const groups = new Map<string, DailyBar[]>();
  for (const bar of days) {
    const monday = weekMonday(bar.day);
    groups.set(monday, [...(groups.get(monday) ?? []), bar]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([monday, rows]) => {
    const rising = rows.filter((row) => row.close > row.open).length / rows.length;
    return {
      monday,
      open: rows[0]!.open,
      close: rows.at(-1)!.close,
      side: rising > 0.5 ? 'H' : rising < 0.5 ? 'L' : null,
    };
  });
}

export function simulateWeekBreadth(input: readonly DailyBar[]): PatternTrade[] {
  const weeks = new Map(weeksOf(input).map((week) => [week.monday, week]));
  const trades: PatternTrade[] = [];
  for (const week of weeks.values()) {
    if (week.monday < '2024-01-01' || week.monday > '2025-12-31') continue;
    const prior = weeks.get(addDays(week.monday, -7));
    if (!prior || prior.side === null) continue;
    trades.push({
      day: week.monday,
      pattern: prior.side,
      netPct: eventReturnPct(week.open, week.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(week.open, week.close, traderStress),
    });
  }
  return trades;
}

export function weekBreadthPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

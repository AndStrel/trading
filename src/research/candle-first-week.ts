import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weekMonday } from './candle-week.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function ordered(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

export function simulateFirstWeek(input: readonly DailyBar[]): PatternTrade[] {
  const bars = ordered(input);
  const weeks = new Map<string, DailyBar[]>();
  const months = new Map<string, DailyBar[]>();
  for (const bar of bars) {
    weeks.set(weekMonday(bar.day), [...(weeks.get(weekMonday(bar.day)) ?? []), bar]);
    const month = bar.day.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), bar]);
  }
  const trades: PatternTrade[] = [];
  for (const [month, rows] of months) {
    const mondays = [...weeks.keys()].filter((monday) => monday.slice(0, 7) === month).sort();
    const firstMonday = mondays[0];
    if (!firstMonday) continue;
    const first = weeks.get(firstMonday)!;
    const nextMonday = addDays(firstMonday, 7);
    const next = weeks.get(nextMonday);
    const exit = rows.at(-1)!;
    const open = first[0]!.open;
    const close = first.at(-1)!.close;
    if (!next || nextMonday.slice(0, 7) !== month || close === open || exit.day < nextMonday) continue;
    if (nextMonday < '2024-01-01' || nextMonday > '2025-12-31') continue;
    trades.push({
      day: nextMonday,
      pattern: close > open ? 'U' : 'D',
      netPct: eventReturnPct(next[0]!.open, exit.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(next[0]!.open, exit.close, traderStress),
    });
  }
  return trades;
}

export function firstWeekPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 4) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

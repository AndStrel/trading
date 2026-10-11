import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weeklyBars } from './candle-week.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
export type WeekLeadSide = 'leader' | 'laggard';
export type WeekLeadTrade = { day: string; ticker: string; netPct: number; stressPct: number };

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function simulateWeekLead(
  books: Readonly<Record<string, readonly DailyBar[]>>,
  side: WeekLeadSide,
): WeekLeadTrade[] {
  const series = Object.fromEntries(Object.entries(books).map(([name, bars]) => [name, weeklyBars(bars)]));
  const names = Object.keys(series);
  const present = new Set(series[names[0]!]!.map((week) => week.monday).filter((monday) => names.every((name) => series[name]!.some((week) => week.monday === monday))));
  const trades: WeekLeadTrade[] = [];
  for (const monday of [...present].sort()) {
    const signal = addDays(monday, -7);
    const prior = addDays(monday, -14);
    const exit = addDays(monday, 7);
    if (monday < '2024-01-01' || monday > '2025-12-31' || ![signal, prior, exit].every((day) => present.has(day))) continue;
    const returns = names.map((name) => {
      const weeks = series[name]!;
      const signalWeek = weeks.find((week) => week.monday === signal)!;
      const priorWeek = weeks.find((week) => week.monday === prior)!;
      return { name, value: signalWeek.close / priorWeek.close - 1 };
    });
    const extreme = side === 'leader' ? Math.max(...returns.map((item) => item.value)) : Math.min(...returns.map((item) => item.value));
    const chosen = returns.filter((item) => item.value === extreme);
    if (chosen.length !== 1 || (side === 'leader' ? extreme <= 0 : extreme >= 0)) continue;
    const entryWeek = series[chosen[0]!.name]!.find((week) => week.monday === monday)!;
    const exitWeek = series[chosen[0]!.name]!.find((week) => week.monday === exit)!;
    trades.push({
      day: monday,
      ticker: chosen[0]!.name,
      netPct: eventReturnPct(entryWeek.open, exitWeek.open, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entryWeek.open, exitWeek.open, traderStress),
    });
  }
  return trades;
}

export function weekLeadPasses(trades: readonly WeekLeadTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

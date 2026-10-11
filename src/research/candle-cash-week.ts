import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weeklyBars } from './candle-week.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function simulateCashWeek(signal: readonly DailyBar[], target: readonly DailyBar[]): PatternTrade[] {
  const signalWeeks = new Map(weeklyBars(signal).map((week) => [week.monday, week]));
  const trades: PatternTrade[] = [];
  for (const week of weeklyBars(target)) {
    if (week.monday < '2024-01-01' || week.monday > '2025-12-31') continue;
    const prior = signalWeeks.get(addDays(week.monday, -7));
    if (!prior || prior.close === prior.open) continue;
    trades.push({
      day: week.monday,
      pattern: prior.close > prior.open ? 'U' : 'D',
      netPct: eventReturnPct(week.open, week.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(week.open, week.close, traderStress),
    });
  }
  return trades;
}

export function cashWeekPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

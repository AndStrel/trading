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

function relation(priorHigh: number, priorLow: number, high: number, low: number): 'I' | 'O' | 'N' {
  if (high < priorHigh && low > priorLow) return 'I';
  if (high > priorHigh && low < priorLow) return 'O';
  return 'N';
}

export function simulateWeekInside(input: readonly DailyBar[]): PatternTrade[] {
  const weeks = new Map(weeklyBars(input).map((week) => [week.monday, week]));
  const trades: PatternTrade[] = [];
  for (const week of weeks.values()) {
    if (week.monday < '2024-01-01' || week.monday > '2025-12-31') continue;
    const signal = weeks.get(addDays(week.monday, -7));
    const prior = weeks.get(addDays(week.monday, -14));
    if (!signal || !prior) continue;
    trades.push({
      day: week.monday,
      pattern: relation(prior.high, prior.low, signal.high, signal.low),
      netPct: eventReturnPct(week.open, week.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(week.open, week.close, traderStress),
    });
  }
  return trades;
}

export function weekInsidePasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 8) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

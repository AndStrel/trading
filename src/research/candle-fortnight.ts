import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weeklyBars } from './candle-week.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
const origin = Date.parse('2020-01-06T12:00:00Z');

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function evenFortnight(monday: string): boolean {
  const weeks = Math.round((Date.parse(`${monday}T12:00:00Z`) - origin) / (7 * 86_400_000));
  return weeks % 2 === 0;
}

export function simulateFortnight(input: readonly DailyBar[]): PatternTrade[] {
  const weeks = weeklyBars(input);
  const byMonday = new Map(weeks.map((week) => [week.monday, week]));
  const pairs = weeks.flatMap((week) => {
    if (!evenFortnight(week.monday)) return [];
    const next = byMonday.get(addDays(week.monday, 7));
    return next ? [{ monday: week.monday, open: week.open, close: next.close }] : [];
  });
  const trades: PatternTrade[] = [];
  for (let index = 1; index < pairs.length; index += 1) {
    const pair = pairs[index]!;
    if (pair.monday < '2024-01-01' || pair.monday > '2025-12-31') continue;
    const prior = pairs[index - 1]!;
    if (addDays(prior.monday, 14) !== pair.monday || prior.close === prior.open) continue;
    trades.push({
      day: pair.monday,
      pattern: prior.close > prior.open ? 'U' : 'D',
      netPct: eventReturnPct(pair.open, pair.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(pair.open, pair.close, traderStress),
    });
  }
  return trades;
}

export function fortnightPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 10) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

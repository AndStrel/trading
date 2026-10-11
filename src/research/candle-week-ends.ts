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

function sign(open: number, close: number): 'U' | 'D' | null {
  if (close === open) return null;
  return close > open ? 'U' : 'D';
}

export function simulateWeekEnds(input: readonly DailyBar[]): PatternTrade[] {
  const days = input.filter((bar) => bar.day <= '2025-12-30');
  if (days.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= days[index - 1]!.day))) throw new Error('Invalid daily bars');
  const byDay = new Map(days.map((bar) => [bar.day, bar]));
  const trades: PatternTrade[] = [];
  for (const week of weeklyBars(input)) {
    if (week.monday < '2024-01-01' || week.monday > '2025-12-31') continue;
    const monday = addDays(week.monday, -7);
    const mondayBar = byDay.get(monday);
    const fridayBar = byDay.get(addDays(monday, 4));
    if (!mondayBar || !fridayBar) continue;
    const mondaySign = sign(mondayBar.open, mondayBar.close);
    const fridaySign = sign(fridayBar.open, fridayBar.close);
    if (!mondaySign || !fridaySign) continue;
    trades.push({
      day: week.monday,
      pattern: `${mondaySign}${fridaySign}`,
      netPct: eventReturnPct(week.open, week.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(week.open, week.close, traderStress),
    });
  }
  return trades;
}

export function weekEndsPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 10) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

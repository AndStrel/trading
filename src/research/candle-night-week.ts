import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weekMonday, weeklyBars } from './candle-week.js';
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

export function simulateNightWeek(input: readonly DailyBar[]): PatternTrade[] {
  const bars = ordered(input);
  const factors = new Map<string, { night: number; cash: number }>();
  const incomplete = new Set(bars.length === 0 ? [] : [weekMonday(bars[0]!.day)]);
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index]!;
    const prior = bars[index - 1]!;
    const monday = weekMonday(bar.day);
    const slot = factors.get(monday) ?? { night: 1, cash: 1 };
    slot.night *= bar.open / prior.close;
    slot.cash *= bar.close / bar.open;
    factors.set(monday, slot);
  }
  const weeks = new Map(weeklyBars(bars).map((week) => [week.monday, week]));
  const trades: PatternTrade[] = [];
  for (const week of weeks.values()) {
    if (week.monday < '2024-01-01' || week.monday > '2025-12-31') continue;
    const signalMonday = addDays(week.monday, -7);
    const signal = factors.get(signalMonday);
    if (!signal || incomplete.has(signalMonday) || signal.night === signal.cash) continue;
    trades.push({
      day: week.monday,
      pattern: signal.night > signal.cash ? 'N' : 'C',
      netPct: eventReturnPct(week.open, week.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(week.open, week.close, traderStress),
    });
  }
  return trades;
}

export function nightWeekPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

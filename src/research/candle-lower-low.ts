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
    !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || bar.high < bar.low || bar.low <= 0 ||
    bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

type Week = { monday: string; open: number; close: number; updates: number };

function weeksOf(input: readonly DailyBar[]): Map<string, Week> {
  const bars = ordered(input);
  const groups = new Map<string, { open: number; close: number; updates: number }>();
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index]!;
    const monday = weekMonday(bar.day);
    const slot = groups.get(monday) ?? { open: bar.open, close: bar.close, updates: 0 };
    if (bar.low < bars[index - 1]!.low) slot.updates += 1;
    slot.close = bar.close;
    groups.set(monday, slot);
  }
  if (bars.length > 0) {
    const first = bars[0]!;
    const monday = weekMonday(first.day);
    if (!groups.has(monday)) groups.set(monday, { open: first.open, close: first.close, updates: 0 });
  }
  return new Map([...groups.entries()].map(([monday, week]) => [monday, { monday, ...week }]));
}

function pattern(updates: number): 'H' | 'M' | 'L' {
  if (updates >= 3) return 'H';
  if (updates <= 1) return 'L';
  return 'M';
}

export function simulateLowerLow(input: readonly DailyBar[]): PatternTrade[] {
  const weeks = weeksOf(input);
  const trades: PatternTrade[] = [];
  for (const week of weeks.values()) {
    if (week.monday < '2024-01-01' || week.monday > '2025-12-31') continue;
    const signal = weeks.get(addDays(week.monday, -7));
    if (!signal) continue;
    trades.push({
      day: week.monday,
      pattern: pattern(signal.updates),
      netPct: eventReturnPct(week.open, week.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(week.open, week.close, traderStress),
    });
  }
  return trades;
}

export function lowerLowPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 8) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

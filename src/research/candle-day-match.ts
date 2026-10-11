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

function body(bar: DailyBar): 'U' | 'D' | null {
  if (bar.close > bar.open) return 'U';
  if (bar.close < bar.open) return 'D';
  return null;
}

export function simulateDayMatch(left: readonly DailyBar[], right: readonly DailyBar[], target: readonly DailyBar[]): PatternTrade[] {
  const leftBars = ordered(left);
  const rightByDay = new Map(ordered(right).map((bar) => [bar.day, bar]));
  const weeks = new Map<string, DailyBar[]>();
  for (const bar of ordered(target)) weeks.set(weekMonday(bar.day), [...(weeks.get(weekMonday(bar.day)) ?? []), bar]);
  const signalDays = new Map<string, DailyBar[]>();
  for (const bar of leftBars) signalDays.set(weekMonday(bar.day), [...(signalDays.get(weekMonday(bar.day)) ?? []), bar]);
  const trades: PatternTrade[] = [];
  for (const [monday, rows] of signalDays) {
    const tradeMonday = addDays(monday, 7);
    const next = weeks.get(tradeMonday);
    if (!next || tradeMonday < '2024-01-01' || tradeMonday > '2025-12-31') continue;
    let same = 0;
    let split = 0;
    for (const bar of rows) {
      const other = rightByDay.get(bar.day);
      const leftSign = body(bar);
      const rightSign = other ? body(other) : null;
      if (!leftSign || !rightSign) continue;
      if (leftSign === rightSign) same += 1;
      else split += 1;
    }
    if (same === split) continue;
    const exit = next.at(-1)!;
    trades.push({
      day: tradeMonday,
      pattern: same > split ? 'H' : 'L',
      netPct: eventReturnPct(next[0]!.open, exit.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(next[0]!.open, exit.close, traderStress),
    });
  }
  return trades;
}

export function dayMatchPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

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

function previousMonth(month: string): string {
  return month.endsWith('-01')
    ? `${Number(month.slice(0, 4)) - 1}-12`
    : `${month.slice(0, 4)}-${String(Number(month.slice(5)) - 1).padStart(2, '0')}`;
}

function ordered(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || bar.high < bar.low || bar.low <= 0 ||
    bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

export function simulateMonthBreak(input: readonly DailyBar[]): PatternTrade[] {
  const bars = ordered(input);
  const weeks = new Map<string, DailyBar[]>();
  const months = new Map<string, { high: number; low: number }>();
  for (const bar of bars) {
    weeks.set(weekMonday(bar.day), [...(weeks.get(weekMonday(bar.day)) ?? []), bar]);
    const month = bar.day.slice(0, 7);
    const range = months.get(month) ?? { high: bar.high, low: bar.low };
    range.high = Math.max(range.high, bar.high);
    range.low = Math.min(range.low, bar.low);
    months.set(month, range);
  }
  const trades: PatternTrade[] = [];
  for (const [monday, rows] of weeks) {
    const tradeMonday = addDays(monday, 7);
    const next = weeks.get(tradeMonday);
    const range = months.get(previousMonth(monday.slice(0, 7)));
    if (!next || !range || tradeMonday < '2024-01-01' || tradeMonday > '2025-12-31') continue;
    const close = rows.at(-1)!.close;
    const exit = next.at(-1)!;
    trades.push({
      day: tradeMonday,
      pattern: close > range.high ? 'A' : close < range.low ? 'B' : 'I',
      netPct: eventReturnPct(next[0]!.open, exit.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(next[0]!.open, exit.close, traderStress),
    });
  }
  return trades;
}

export function monthBreakPasses(trades: readonly PatternTrade[], floor: number, requireStress: boolean): boolean {
  if (trades.length < floor) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

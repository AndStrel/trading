import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

type MonthPoint = { month: string; open: number; close: number; range: number };

function monthsOf(input: readonly DailyBar[]): MonthPoint[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || bar.high < bar.low || bar.low <= 0 ||
    bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const groups = new Map<string, DailyBar[]>();
  for (const bar of bars) groups.set(bar.day.slice(0, 7), [...(groups.get(bar.day.slice(0, 7)) ?? []), bar]);
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, rows]) => ({
    month,
    open: rows[0]!.open,
    close: rows.at(-1)!.close,
    range: Math.max(...rows.map((row) => row.high)) - Math.min(...rows.map((row) => row.low)),
  }));
}

function previousMonth(month: string): string {
  return month.endsWith('-01')
    ? `${Number(month.slice(0, 4)) - 1}-12`
    : `${month.slice(0, 4)}-${String(Number(month.slice(5)) - 1).padStart(2, '0')}`;
}

export function simulateGoldRange(signal: readonly DailyBar[], target: readonly DailyBar[]): PatternTrade[] {
  const signalMonths = new Map(monthsOf(signal).map((month) => [month.month, month]));
  const trades: PatternTrade[] = [];
  for (const month of monthsOf(target)) {
    if (month.month < '2024-01' || month.month > '2025-12') continue;
    const signalMonth = previousMonth(month.month);
    const current = signalMonths.get(signalMonth);
    const base = signalMonths.get(previousMonth(signalMonth));
    if (!current || !base || current.range === base.range) continue;
    trades.push({
      day: `${month.month}-01`,
      pattern: current.range > base.range ? 'E' : 'C',
      netPct: eventReturnPct(month.open, month.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(month.open, month.close, traderStress),
    });
  }
  return trades;
}

export function goldRangePasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 4) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

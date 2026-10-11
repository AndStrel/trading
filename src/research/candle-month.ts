import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

export type MonthSide = 'leader' | 'laggard';
export type MonthTrade = { month: string; ticker: string; netPct: number; stressPct: number };

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

type MonthPoint = { month: string; lastClose: number; firstOpen: number };

function monthsOf(input: readonly DailyBar[]): MonthPoint[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const groups = new Map<string, DailyBar[]>();
  for (const bar of bars) {
    const month = bar.day.slice(0, 7);
    groups.set(month, [...(groups.get(month) ?? []), bar]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, rows]) => ({
    month,
    lastClose: rows.at(-1)!.close,
    firstOpen: rows[0]!.open,
  }));
}

export function simulateMonthLeadership(
  books: Readonly<Record<string, readonly DailyBar[]>>,
  side: MonthSide,
): MonthTrade[] {
  const series = Object.fromEntries(Object.entries(books).map(([name, bars]) => [name, monthsOf(bars)]));
  const names = Object.keys(series);
  const shared = series[names[0]!]!.map((point) => point.month).filter((month) => names.every((name) => series[name]!.some((point) => point.month === month)));
  const trades: MonthTrade[] = [];
  for (let index = 2; index < shared.length - 1; index += 1) {
    const signalMonth = shared[index - 1]!;
    const entryMonth = shared[index]!;
    const exitMonth = shared[index + 1]!;
    if (entryMonth < '2024-01' || entryMonth > '2025-12') continue;
    const returns = names.map((name) => {
      const points = series[name]!;
      const prior = points.find((point) => point.month === shared[index - 2])!;
      const signal = points.find((point) => point.month === signalMonth)!;
      return { name, value: signal.lastClose / prior.lastClose - 1 };
    });
    const chosen = side === 'leader'
      ? returns.reduce((best, item) => item.value > best.value ? item : best)
      : returns.reduce((best, item) => item.value < best.value ? item : best);
    if (side === 'leader' ? chosen.value <= 0 : chosen.value >= 0) continue;
    const entry = series[chosen.name]!.find((point) => point.month === entryMonth)!;
    const exit = series[chosen.name]!.find((point) => point.month === exitMonth)!;
    trades.push({
      month: entryMonth,
      ticker: chosen.name,
      netPct: eventReturnPct(entry.firstOpen, exit.firstOpen, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entry.firstOpen, exit.firstOpen, traderStress),
    });
  }
  return trades;
}

export function monthPasses(trades: readonly MonthTrade[]): boolean {
  if (trades.length < 8) return false;
  const winners = trades.filter((trade) => trade.netPct > 0).length;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanNet = mean(trades.map((trade) => trade.netPct));
  const meanStress = mean(trades.map((trade) => trade.stressPct));
  return winners / trades.length >= 0.51 && meanNet > 0 && meanStress > 0;
}

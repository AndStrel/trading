import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
export type PairSide = 'leader' | 'laggard';
export type PairTrade = { day: string; ticker: string; netPct: number; stressPct: number };

type MonthBar = { month: string; open: number; close: number };

function monthsOf(input: readonly DailyBar[]): MonthBar[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const groups = new Map<string, DailyBar[]>();
  for (const bar of bars) groups.set(bar.day.slice(0, 7), [...(groups.get(bar.day.slice(0, 7)) ?? []), bar]);
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, rows]) => ({
    month,
    open: rows[0]!.open,
    close: rows.at(-1)!.close,
  }));
}

function nextMonth(month: string): string {
  return month.endsWith('-12')
    ? `${Number(month.slice(0, 4)) + 1}-01`
    : `${month.slice(0, 4)}-${String(Number(month.slice(5)) + 1).padStart(2, '0')}`;
}

export function simulatePairMonth(
  books: Readonly<Record<string, readonly DailyBar[]>>,
  side: PairSide,
): PairTrade[] {
  const series = Object.fromEntries(Object.entries(books).map(([name, bars]) => [name, monthsOf(bars)]));
  const names = Object.keys(series);
  const shared = series[names[0]!]!.map((month) => month.month).filter((month) => names.every((name) => series[name]!.some((item) => item.month === month)));
  const trades: PairTrade[] = [];
  for (let index = 2; index < shared.length; index += 1) {
    const older = shared[index - 2]!;
    const signal = shared[index - 1]!;
    const entry = shared[index]!;
    if (entry < '2024-01' || entry > '2025-12' || entry !== nextMonth(signal) || signal !== nextMonth(older)) continue;
    const returns = names.map((name) => {
      const points = series[name]!;
      const prior = points.find((item) => item.month === older)!;
      const current = points.find((item) => item.month === signal)!;
      return { name, value: current.close / prior.close - 1 };
    });
    const extreme = side === 'leader' ? Math.max(...returns.map((item) => item.value)) : Math.min(...returns.map((item) => item.value));
    const chosen = returns.filter((item) => item.value === extreme);
    if (chosen.length !== 1 || (side === 'leader' ? extreme <= 0 : extreme >= 0)) continue;
    const month = series[chosen[0]!.name]!.find((item) => item.month === entry)!;
    trades.push({
      day: `${entry}-01`,
      ticker: chosen[0]!.name,
      netPct: eventReturnPct(month.open, month.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(month.open, month.close, traderStress),
    });
  }
  return trades;
}

export function pairMonthPasses(trades: readonly PairTrade[], requireStress: boolean): boolean {
  if (trades.length < 4) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

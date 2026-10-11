import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
export type CrossTrade = { month: string; pattern: string; netPct: number; stressPct: number };

type MonthPoint = { month: string; lastClose: number; firstOpen: number };

function monthsOf(input: readonly DailyBar[]): MonthPoint[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const groups = new Map<string, DailyBar[]>();
  for (const bar of bars) groups.set(bar.day.slice(0, 7), [...(groups.get(bar.day.slice(0, 7)) ?? []), bar]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, rows]) => ({
    month,
    lastClose: rows.at(-1)!.close,
    firstOpen: rows[0]!.open,
  }));
}

export function simulateCrossMonth(signal: readonly DailyBar[], target: readonly DailyBar[], name: string): CrossTrade[] {
  const signals = monthsOf(signal);
  const targets = monthsOf(target);
  const shared = signals.map((point) => point.month).filter((month) => targets.some((point) => point.month === month));
  const trades: CrossTrade[] = [];
  for (let index = 2; index < shared.length - 1; index += 1) {
    const entryMonth = shared[index]!;
    if (entryMonth < '2024-01' || entryMonth > '2025-12') continue;
    const prior = signals.find((point) => point.month === shared[index - 2])!;
    const marked = signals.find((point) => point.month === shared[index - 1])!;
    const change = marked.lastClose / prior.lastClose - 1;
    if (change === 0) continue;
    const entry = targets.find((point) => point.month === entryMonth)!;
    const exit = targets.find((point) => point.month === shared[index + 1])!;
    trades.push({
      month: entryMonth,
      pattern: `${name}-${change > 0 ? 'up' : 'down'}`,
      netPct: eventReturnPct(entry.firstOpen, exit.firstOpen, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entry.firstOpen, exit.firstOpen, traderStress),
    });
  }
  return trades;
}

export function crossGroupPasses(trades: readonly CrossTrade[]): boolean {
  if (trades.length < 8) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((a, b) => b - a).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  return winners / nets.length >= 0.51 && mean(nets) > 0 && mean(trades.map((trade) => trade.stressPct)) > 0 && withoutBest > 0;
}

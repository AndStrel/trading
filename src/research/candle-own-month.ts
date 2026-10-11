import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

export type OwnMonthSide = 'continue' | 'reverse';
export type OwnMonthTrade = { month: string; netPct: number; stressPct: number };
const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

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

export function simulateOwnMonth(input: readonly DailyBar[], side: OwnMonthSide): OwnMonthTrade[] {
  const months = monthsOf(input);
  const trades: OwnMonthTrade[] = [];
  for (let index = 2; index < months.length - 1; index += 1) {
    const entry = months[index]!;
    if (entry.month < '2024-01' || entry.month > '2025-12') continue;
    const change = months[index - 1]!.lastClose / months[index - 2]!.lastClose - 1;
    if (side === 'continue' ? change <= 0 : change >= 0) continue;
    const exit = months[index + 1]!;
    trades.push({
      month: entry.month,
      netPct: eventReturnPct(entry.firstOpen, exit.firstOpen, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entry.firstOpen, exit.firstOpen, traderStress),
    });
  }
  return trades;
}

export function ownMonthPasses(trades: readonly OwnMonthTrade[]): boolean {
  if (trades.length < 4) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const winners = trades.filter((trade) => trade.netPct > 0).length;
  return winners / trades.length >= 0.51 && mean(trades.map((trade) => trade.netPct)) > 0 && mean(trades.map((trade) => trade.stressPct)) > 0;
}

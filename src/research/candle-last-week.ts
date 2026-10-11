import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weekMonday } from './candle-week.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function ordered(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

function nextMonth(month: string): string {
  return month.endsWith('-12')
    ? `${Number(month.slice(0, 4)) + 1}-01`
    : `${month.slice(0, 4)}-${String(Number(month.slice(5)) + 1).padStart(2, '0')}`;
}

export function simulateLastWeek(input: readonly DailyBar[]): PatternTrade[] {
  const bars = ordered(input);
  const months = new Map<string, DailyBar[]>();
  for (const bar of bars) months.set(bar.day.slice(0, 7), [...(months.get(bar.day.slice(0, 7)) ?? []), bar]);
  const points = [...months.entries()].sort(([left], [right]) => left.localeCompare(right));
  const trades: PatternTrade[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const [month, rows] = points[index - 1]!;
    const [tradeMonth, tradeRows] = points[index]!;
    if (tradeMonth < '2024-01' || tradeMonth > '2025-12' || tradeMonth !== nextMonth(month)) continue;
    const monday = [...new Set(rows.map((row) => weekMonday(row.day)))].filter((day) => day.slice(0, 7) === month).sort().at(-1);
    if (!monday) continue;
    const week = rows.filter((row) => weekMonday(row.day) === monday);
    const open = week[0]!.open;
    const close = week.at(-1)!.close;
    if (close === open) continue;
    trades.push({
      day: `${tradeMonth}-01`,
      pattern: close > open ? 'U' : 'D',
      netPct: eventReturnPct(tradeRows[0]!.open, tradeRows.at(-1)!.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(tradeRows[0]!.open, tradeRows.at(-1)!.close, traderStress),
    });
  }
  return trades;
}

export function lastWeekPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 4) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

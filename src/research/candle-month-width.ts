import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

type MonthBar = { month: string; open: number; high: number; low: number; close: number; width: number };

function monthsOf(input: readonly DailyBar[]): MonthBar[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || bar.high < bar.low ||
    bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const groups = new Map<string, DailyBar[]>();
  for (const bar of bars) groups.set(bar.day.slice(0, 7), [...(groups.get(bar.day.slice(0, 7)) ?? []), bar]);
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, rows]) => {
    const high = Math.max(...rows.map((row) => row.high));
    const low = Math.min(...rows.map((row) => row.low));
    const close = rows.at(-1)!.close;
    return { month, open: rows[0]!.open, high, low, close, width: (high - low) / close };
  });
}

function shiftMonth(month: string, steps: number): string {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + steps);
  return date.toISOString().slice(0, 7);
}

export function simulateMonthWidth(input: readonly DailyBar[]): PatternTrade[] {
  const months = new Map(monthsOf(input).map((month) => [month.month, month]));
  const trades: PatternTrade[] = [];
  for (const month of months.values()) {
    const signal = months.get(shiftMonth(month.month, -1));
    if (!signal || month.month < '2024-01' || month.month > '2025-12') continue;
    const history = [1, 2, 3, 4, 5].map((steps) => months.get(shiftMonth(signal.month, -steps)));
    if (history.some((item) => item === undefined)) continue;
    const ordered = history.map((item) => item!.width).sort((left, right) => left - right);
    const median = ordered[2]!;
    if (signal.width === median) continue;
    trades.push({
      day: `${month.month}-01`,
      pattern: signal.width < median ? 'N' : 'W',
      netPct: eventReturnPct(month.open, month.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(month.open, month.close, traderStress),
    });
  }
  return trades;
}

export function monthWidthPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 4) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

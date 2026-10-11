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

type Week = { monday: string; open: number; close: number; vwap: number | null };

function weeksOf(input: readonly DailyBar[]): Map<string, Week> {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || bar.high < bar.low ||
    bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) ||
    !Number.isFinite(bar.volume) || bar.volume < 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const groups = new Map<string, DailyBar[]>();
  for (const bar of bars) groups.set(weekMonday(bar.day), [...(groups.get(weekMonday(bar.day)) ?? []), bar]);
  return new Map([...groups.entries()].map(([monday, rows]) => {
    const volume = rows.reduce((sum, row) => sum + row.volume, 0);
    const weighted = rows.reduce((sum, row) => sum + ((row.high + row.low + row.close) / 3) * row.volume, 0);
    return [monday, {
      monday,
      open: rows[0]!.open,
      close: rows.at(-1)!.close,
      vwap: volume > 0 ? weighted / volume : null,
    }];
  }));
}

export function simulateVwapOpen(input: readonly DailyBar[]): PatternTrade[] {
  const weeks = weeksOf(input);
  const trades: PatternTrade[] = [];
  for (const week of weeks.values()) {
    if (week.monday < '2024-01-01' || week.monday > '2025-12-31') continue;
    const prior = weeks.get(addDays(week.monday, -7));
    if (!prior || prior.vwap === null || week.open === prior.vwap) continue;
    trades.push({
      day: week.monday,
      pattern: week.open > prior.vwap ? 'A' : 'B',
      netPct: eventReturnPct(week.open, week.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(week.open, week.close, traderStress),
    });
  }
  return trades;
}

export function vwapOpenPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

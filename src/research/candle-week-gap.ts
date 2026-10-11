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
    !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || bar.high < bar.low || bar.low <= 0 ||
    bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

export function simulateWeekGap(input: readonly DailyBar[]): PatternTrade[] {
  const bars = ordered(input);
  const weeks = new Map<string, DailyBar[]>();
  for (const bar of bars) weeks.set(weekMonday(bar.day), [...(weeks.get(weekMonday(bar.day)) ?? []), bar]);
  const trades: PatternTrade[] = [];
  for (const [monday, rows] of weeks) {
    if (monday < '2024-01-01' || monday > '2025-12-31') continue;
    const prior = weeks.get(addDays(monday, -7));
    const openBar = rows.find((row) => row.day === monday);
    if (!prior || !openBar) continue;
    const high = Math.max(...prior.map((row) => row.high));
    const low = Math.min(...prior.map((row) => row.low));
    if (openBar.open <= high && openBar.open >= low) continue;
    trades.push({
      day: monday,
      pattern: openBar.open > high ? 'A' : 'B',
      netPct: eventReturnPct(openBar.open, rows.at(-1)!.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(openBar.open, rows.at(-1)!.close, traderStress),
    });
  }
  return trades;
}

export function weekGapPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 8) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

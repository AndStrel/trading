import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weekMonday } from './candle-week.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function ordered(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || bar.high < bar.low || bar.low <= 0 ||
    bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

function daysBetween(left: string, right: string): number {
  return (Date.parse(`${right}T12:00:00Z`) - Date.parse(`${left}T12:00:00Z`)) / 86_400_000;
}

function weekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export function simulateGapSize(input: readonly DailyBar[]): PatternTrade[] {
  const bars = ordered(input);
  const weeks = new Map<string, DailyBar[]>();
  for (const bar of bars) weeks.set(weekMonday(bar.day), [...(weeks.get(weekMonday(bar.day)) ?? []), bar]);
  const trades: PatternTrade[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const friday = bars[index - 1]!;
    const monday = bars[index]!;
    if (weekday(monday.day) !== 1 || weekday(friday.day) !== 5 || daysBetween(friday.day, monday.day) !== 3) continue;
    if (monday.day < '2024-01-01' || monday.day > '2025-12-31') continue;
    const span = friday.high - friday.low;
    if (span === 0) continue;
    const ratio = (monday.open - friday.close) / span;
    const pattern = ratio > 0.5 ? 'A' : ratio < -0.5 ? 'B' : 'I';
    const week = weeks.get(monday.day);
    if (!week) continue;
    trades.push({
      day: monday.day,
      pattern,
      netPct: eventReturnPct(monday.open, week.at(-1)!.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(monday.open, week.at(-1)!.close, traderStress),
    });
  }
  return trades;
}

export function gapSizePasses(trades: readonly PatternTrade[], pattern: 'A' | 'B' | 'I', requireStress: boolean): boolean {
  if (trades.length < (pattern === 'I' ? 20 : 8)) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

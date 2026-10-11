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
    !Number.isFinite(bar.volume) || bar.volume < 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

function place(day: string): 'M' | 'F' | 'O' {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (weekday === 1) return 'M';
  if (weekday === 5) return 'F';
  return 'O';
}

export function simulateVolumeDay(input: readonly DailyBar[]): PatternTrade[] {
  const bars = ordered(input);
  const weeks = new Map<string, DailyBar[]>();
  for (const bar of bars) weeks.set(weekMonday(bar.day), [...(weeks.get(weekMonday(bar.day)) ?? []), bar]);
  const trades: PatternTrade[] = [];
  for (const [monday, rows] of weeks) {
    const tradeMonday = addDays(monday, 7);
    const next = weeks.get(tradeMonday);
    if (!next || tradeMonday < '2024-01-01' || tradeMonday > '2025-12-31') continue;
    const peak = Math.max(...rows.map((row) => row.volume));
    if (peak <= 0) continue;
    const first = rows.find((row) => row.volume === peak)!;
    const exit = next.at(-1)!;
    trades.push({
      day: tradeMonday,
      pattern: place(first.day),
      netPct: eventReturnPct(next[0]!.open, exit.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(next[0]!.open, exit.close, traderStress),
    });
  }
  return trades;
}

export function volumeDayPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 8) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

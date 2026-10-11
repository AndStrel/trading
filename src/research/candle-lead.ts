import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
export type LeadTrade = { day: string; pattern: 'S' | 'G'; netPct: number; stressPct: number };

function ordered(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

export function simulateLead(sber: readonly DailyBar[], gazp: readonly DailyBar[], sbmx: readonly DailyBar[]): LeadTrade[] {
  const sberByDay = new Map(ordered(sber).map((bar) => [bar.day, bar]));
  const gazpByDay = new Map(ordered(gazp).map((bar) => [bar.day, bar]));
  const aligned = ordered(sbmx).flatMap((bar) => {
    const left = sberByDay.get(bar.day);
    const right = gazpByDay.get(bar.day);
    return left && right ? [{ day: bar.day, open: bar.open, sber: left.close / left.open - 1, gazp: right.close / right.open - 1 }] : [];
  });
  const trades: LeadTrade[] = [];
  for (let index = 0; index + 6 < aligned.length;) {
    const signal = aligned[index]!;
    if (signal.day < '2023-12-01') {
      index += 1;
      continue;
    }
    const entry = aligned[index + 1]!;
    if (entry.day < '2024-01-01') {
      index += 1;
      continue;
    }
    if (signal.sber === signal.gazp) {
      index += 1;
      continue;
    }
    const exit = aligned[index + 6]!;
    trades.push({
      day: entry.day,
      pattern: signal.sber > signal.gazp ? 'S' : 'G',
      netPct: eventReturnPct(entry.open, exit.open, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entry.open, exit.open, traderStress),
    });
    index += 6;
  }
  return trades;
}

export function leadGroupPasses(trades: readonly LeadTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((a, b) => b - a).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

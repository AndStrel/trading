import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
export type BlockTrade = { day: string; pattern: string; netPct: number; stressPct: number };

function ordered(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  return bars;
}

export function simulateBlocks(signal: readonly DailyBar[], target: readonly DailyBar[], name: string): BlockTrade[] {
  const signalByDay = new Map(ordered(signal).map((bar) => [bar.day, bar]));
  const targetBars = ordered(target).filter((bar) => signalByDay.has(bar.day));
  const aligned = targetBars.map((bar) => ({ day: bar.day, targetOpen: bar.open, signalOpen: signalByDay.get(bar.day)!.open, signalClose: signalByDay.get(bar.day)!.close }));
  const trades: BlockTrade[] = [];
  for (let index = 5; index + 5 < aligned.length; index += 5) {
    const prior = aligned.slice(index - 5, index);
    const current = aligned[index]!;
    const exit = aligned[index + 5]!;
    if (current.day < '2024-01-01') continue;
    const change = prior.at(-1)!.signalClose / prior[0]!.signalOpen - 1;
    if (change === 0) continue;
    trades.push({
      day: current.day,
      pattern: `${name}-${change > 0 ? 'U' : 'D'}`,
      netPct: eventReturnPct(current.targetOpen, exit.targetOpen, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(current.targetOpen, exit.targetOpen, traderStress),
    });
  }
  return trades;
}

export function blockGroupPasses(trades: readonly BlockTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((a, b) => b - a).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

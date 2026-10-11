import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

type MonthSlice = { month: string; open: number; close: number; tailOpen: number | null; tailClose: number | null };

function monthsOf(input: readonly DailyBar[]): MonthSlice[] {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const groups = new Map<string, DailyBar[]>();
  for (const bar of bars) groups.set(bar.day.slice(0, 7), [...(groups.get(bar.day.slice(0, 7)) ?? []), bar]);
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, rows]) => {
    const tail = rows.length >= 5 ? rows.slice(-5) : [];
    return {
      month,
      open: rows[0]!.open,
      close: rows.at(-1)!.close,
      tailOpen: tail[0]?.open ?? null,
      tailClose: tail.at(-1)?.close ?? null,
    };
  });
}

export function simulateMonthEnd(input: readonly DailyBar[]): PatternTrade[] {
  const months = monthsOf(input);
  const trades: PatternTrade[] = [];
  for (let index = 1; index < months.length; index += 1) {
    const month = months[index]!;
    const prior = months[index - 1]!;
    if (month.month < '2024-01' || month.month > '2025-12') continue;
    const expected = prior.month.endsWith('-12')
      ? `${Number(prior.month.slice(0, 4)) + 1}-01`
      : `${prior.month.slice(0, 4)}-${String(Number(prior.month.slice(5)) + 1).padStart(2, '0')}`;
    if (month.month !== expected || prior.tailOpen === null || prior.tailClose === null || prior.tailClose === prior.tailOpen) continue;
    trades.push({
      day: `${month.month}-01`,
      pattern: prior.tailClose > prior.tailOpen ? 'U' : 'D',
      netPct: eventReturnPct(month.open, month.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(month.open, month.close, traderStress),
    });
  }
  return trades;
}

export function monthEndPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 4) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}

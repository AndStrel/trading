import { costScenarios, eventReturnPct } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

export type QuietTrade = { entryDay: string; exitDay: string; entry: number; exit: number;
  netPct: number; stressPct: number; principal: number; proceeds: number };

export function median(values: readonly number[]): number {
  if (!values.length || values.some((value) => !Number.isFinite(value))) throw new Error('Invalid median input');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function isWeekday(day: string): boolean {
  const n = new Date(`${day}T12:00:00Z`).getUTCDay();
  return n >= 1 && n <= 5;
}

function week(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function simulateWeeklyQuietTrend(input: readonly DailyBar[], mode: 'quiet-trend' | 'always-long') {
  const bars = input.filter((bar) => isWeekday(bar.day));
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 ||
    !Number.isFinite(bar.close) || bar.close <= 0 || !Number.isFinite(bar.high) || bar.high <= 0 ||
    !Number.isFinite(bar.low) || bar.low <= 0 || (index > 0 && bar.day <= bars[index - 1]!.day))) {
    throw new Error('Invalid or unordered daily bars');
  }
  const range = (end: number) => {
    const window = bars.slice(end - 19, end + 1);
    return Math.max(...window.map((bar) => bar.high)) / Math.min(...window.map((bar) => bar.low)) - 1;
  };
  const trades: QuietTrade[] = [];
  const decisions: { day: string; status: string; currentRange?: number; medianRange?: number }[] = [];
  let cash = 1_000_000;
  let position: { entryIndex: number; exitIndex: number; principal: number; shares: number } | null = null;
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index]!;
    if (position && position.exitIndex === index) {
      const previous = bars[position.entryIndex]!;
      const proceeds = position.shares * bar.open * (1 - costScenarios.investorBase.slippage) *
        (1 - costScenarios.investorBase.commission);
      cash += proceeds;
      trades.push({ entryDay: previous.day, exitDay: bar.day, entry: previous.open, exit: bar.open,
        netPct: (proceeds / position.principal - 1) * 100,
        stressPct: eventReturnPct(previous.open, bar.open, costScenarios.investorStress),
        principal: position.principal, proceeds });
      position = null;
    }
    if (index > 0 && week(bar.day) === week(bars[index - 1]!.day)) continue;
    if (position) { decisions.push({ day: bar.day, status: 'position-open' }); continue; }
    const previous = bars[index - 1];
    if (!previous || (Date.parse(bar.day) - Date.parse(previous.day)) / 86_400_000 > 7) {
      decisions.push({ day: bar.day, status: 'stale-history' }); continue;
    }
    if (index < 271) { decisions.push({ day: bar.day, status: 'warmup' }); continue; }
    const ranges = Array.from({ length: 252 }, (_, offset) => range(index - 1 - offset));
    const currentRange = ranges[0]!;
    const medianRange = median(ranges);
    if (mode === 'quiet-trend' && !(previous.close > bars[index - 253]!.close &&
      currentRange <= medianRange)) {
      decisions.push({ day: bar.day, status: 'no-signal', currentRange, medianRange }); continue;
    }
    const principal = cash;
    const shares = principal / (bar.open * (1 + costScenarios.investorBase.slippage) *
      (1 + costScenarios.investorBase.commission));
    cash = 0;
    position = { entryIndex: index, exitIndex: index + 5, principal, shares };
    decisions.push({ day: bar.day, status: 'opened', currentRange, medianRange });
  }
  const lastOpen = bars.at(-1)?.open;
  const pending = position === null ? null : { entryDay: bars[position.entryIndex]!.day,
    exitIndex: position.exitIndex, shares: position.shares };
  return { mode, trades, decisions, pending, endingCash: cash,
    endingLiquidationValue: position && lastOpen ? cash + position.shares * lastOpen *
      (1 - costScenarios.investorBase.slippage) * (1 - costScenarios.investorBase.commission) : cash };
}

export function quietStats(trades: readonly QuietTrade[]) {
  const values = trades.map((trade) => trade.netPct);
  const winners = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const sum = (numbers: readonly number[]) => numbers.reduce((total, value) => total + value, 0);
  return { trades: trades.length, weeks: new Set(trades.map((trade) => week(trade.entryDay))).size,
    winners: winners.length, winRate: trades.length ? winners.length / trades.length : null,
    meanNetPct: trades.length ? sum(values) / trades.length : null,
    profitFactor: losses.length ? sum(winners) / -sum(losses) : null,
    withoutBestFiveSumPct: sum([...values].sort((a, b) => b - a).slice(5)),
    stressMeanPct: trades.length ? sum(trades.map((trade) => trade.stressPct)) / trades.length : null };
}

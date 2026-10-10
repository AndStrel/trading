import { costScenarios, eventReturnPct } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';
import type { RelativeTrade } from './weekly-relative-strength.js';

type Position = { exitIndex: number; entryDay: string; entry: number;
  principal: number; shares: number };
type Week = { week: string; startDay: string; firstOpen: number; lastClose: number; volume: number };
function monday(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
function gap(a: string, b: string): number {
  return (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000;
}
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[9]! + sorted[10]!) / 2;
}
export function simulateWeeklySberpVolumeConfirmation(input: readonly DailyBar[]) {
  const bars = input.filter((bar) => {
    const n = new Date(`${bar.day}T12:00:00Z`).getUTCDay();
    return n >= 1 && n <= 5;
  });
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 ||
    !Number.isFinite(bar.close) || bar.close <= 0 || !Number.isFinite(bar.volume) || bar.volume < 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const completed: Week[] = [], trades: RelativeTrade[] = [];
  const decisions: { day: string; status: string; priorVolume?: number;
    baselineVolume?: number; positivePriorWeek?: boolean }[] = [];
  let current: Week | null = null, cash = 1_000_000, positions: Position[] = [], maxConcurrent = 0;
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index]!;
    const exiting = positions.filter((position) => position.exitIndex === index);
    positions = positions.filter((position) => position.exitIndex !== index);
    for (const position of exiting) {
      const proceeds = position.shares * bar.open * (1 - costScenarios.investorBase.slippage) *
        (1 - costScenarios.investorBase.commission);
      cash += proceeds;
      trades.push({ entryDay: position.entryDay, exitDay: bar.day, entry: position.entry,
        exit: bar.open, principal: position.principal, proceeds,
        netPct: (proceeds / position.principal - 1) * 100,
        stressPct: eventReturnPct(position.entry, bar.open, costScenarios.investorStress) });
    }
    const week = monday(bar.day);
    const working = current as Week | null;
    if (working !== null && working.week === week) {
      working.lastClose = bar.close;
      working.volume += bar.volume;
      continue;
    }
    if (current !== null) completed.push(current);
    current = { week, startDay: bar.day, firstOpen: bar.open, lastClose: bar.close, volume: bar.volume };
    if (completed.length < 21) {
      decisions.push({ day: bar.day, status: 'warmup' }); continue;
    }
    const prior = completed.at(-1)!, before = completed.at(-2)!;
    const baselineVolume = median(completed.slice(-21, -1).map((item) => item.volume));
    const positivePriorWeek = prior.lastClose > prior.firstOpen;
    const common = { day: bar.day, priorVolume: prior.volume, baselineVolume, positivePriorWeek };
    if (gap(before.startDay, prior.startDay) > 14 || gap(prior.startDay, bar.day) > 14) {
      decisions.push({ ...common, status: 'stale-week' }); continue;
    }
    if (!positivePriorWeek || prior.volume <= 1.5 * baselineVolume) {
      decisions.push({ ...common, status: 'no-signal' }); continue;
    }
    if (positions.length >= 5) {
      decisions.push({ ...common, status: 'capacity-skip' }); continue;
    }
    const equity = cash + positions.reduce((sum, position) => sum + position.shares * bar.open *
      (1 - costScenarios.investorBase.slippage) * (1 - costScenarios.investorBase.commission), 0);
    const principal = Math.min(cash, equity / 5);
    if (principal < 1) {
      decisions.push({ ...common, status: 'cash-skip' }); continue;
    }
    cash -= principal;
    positions.push({ exitIndex: index + 20, entryDay: bar.day, entry: bar.open, principal,
      shares: principal / (bar.open * (1 + costScenarios.investorBase.slippage) *
        (1 + costScenarios.investorBase.commission)) });
    maxConcurrent = Math.max(maxConcurrent, positions.length);
    decisions.push({ ...common, status: 'opened' });
  }
  const lastOpen = bars.at(-1)?.open;
  return { trades, decisions, maxConcurrent, endingCash: cash,
    pending: positions.map(({ exitIndex: unused, ...position }) => position),
    endingLiquidationValue: lastOpen === undefined ? cash : cash + positions.reduce((sum, position) =>
      sum + position.shares * lastOpen * (1 - costScenarios.investorBase.slippage) *
      (1 - costScenarios.investorBase.commission), 0) };
}

import { costScenarios, eventReturnPct } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';
import type { RelativeTrade } from './weekly-relative-strength.js';

type Position = { exitIndex: number; entryDay: string; entry: number;
  principal: number; shares: number };
function monday(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
function dayGap(a: string, b: string): number {
  return (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000;
}
export function simulateWeeklySberpTrendPullback(input: readonly DailyBar[]) {
  const bars = input.filter((bar) => {
    const n = new Date(`${bar.day}T12:00:00Z`).getUTCDay();
    return n >= 1 && n <= 5;
  });
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 ||
    !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const trades: RelativeTrade[] = [];
  const decisions: { day: string; status: string; priorWeekReturnPct?: number;
    priorClose?: number; sma200?: number }[] = [];
  let cash = 1_000_000, positions: Position[] = [], maxConcurrent = 0;
  const weekStarts: number[] = [];
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index]!;
    const exits = positions.filter((position) => position.exitIndex === index);
    positions = positions.filter((position) => position.exitIndex !== index);
    for (const position of exits) {
      const proceeds = position.shares * bar.open * (1 - costScenarios.investorBase.slippage) *
        (1 - costScenarios.investorBase.commission);
      cash += proceeds;
      trades.push({ entryDay: position.entryDay, exitDay: bar.day, entry: position.entry,
        exit: bar.open, principal: position.principal, proceeds,
        netPct: (proceeds / position.principal - 1) * 100,
        stressPct: eventReturnPct(position.entry, bar.open, costScenarios.investorStress) });
    }
    if (index > 0 && monday(bar.day) === monday(bars[index - 1]!.day)) continue;
    weekStarts.push(index);
    if (index < 200 || weekStarts.length < 3) {
      decisions.push({ day: bar.day, status: 'warmup' }); continue;
    }
    const priorStart = weekStarts.at(-2)!, beforeStart = weekStarts.at(-3)!;
    const priorClose = bars[index - 1]!.close;
    const beforeClose = bars[priorStart - 1]!.close;
    const priorWeekReturnPct = (priorClose / beforeClose - 1) * 100;
    const sma200 = bars.slice(index - 200, index).reduce((sum, item) => sum + item.close, 0) / 200;
    const common = { day: bar.day, priorWeekReturnPct, priorClose, sma200 };
    if (dayGap(bars[beforeStart]!.day, bars[priorStart]!.day) > 14 ||
      dayGap(bars[priorStart]!.day, bar.day) > 14) {
      decisions.push({ ...common, status: 'stale-week' }); continue;
    }
    if (priorWeekReturnPct > -1.5 || priorClose <= sma200) {
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
    positions.push({ exitIndex: index + 20, entryDay: bar.day, entry: bar.open,
      principal, shares: principal / (bar.open * (1 + costScenarios.investorBase.slippage) *
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

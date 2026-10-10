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
const base = costScenarios.investorBase;
export const breakevenRatio = ((1 + base.slippage) * (1 + base.commission)) /
  ((1 - base.slippage) * (1 - base.commission));

export function simulateWeeklyLqdtCarry(input: readonly DailyBar[], from: string, thru: string,
  mode: 'conditional' | 'always-long') {
  if (from > thru) throw new Error('Invalid evaluation interval');
  const bars = input.filter((bar) => {
    const n = new Date(`${bar.day}T12:00:00Z`).getUTCDay();
    return n >= 1 && n <= 5 && bar.day <= thru;
  });
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 ||
    !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const trades: RelativeTrade[] = [];
  const decisions: { day: string; status: string; trailingRatio?: number; breakevenRatio?: number }[] = [];
  let cash = 1_000_000, positions: Position[] = [], maxConcurrent = 0;
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index]!;
    const exiting = positions.filter((position) => position.exitIndex === index);
    positions = positions.filter((position) => position.exitIndex !== index);
    for (const position of exiting) {
      const proceeds = position.shares * bar.open * (1 - base.slippage) * (1 - base.commission);
      cash += proceeds;
      trades.push({ entryDay: position.entryDay, exitDay: bar.day, entry: position.entry,
        exit: bar.open, principal: position.principal, proceeds,
        netPct: (proceeds / position.principal - 1) * 100,
        stressPct: eventReturnPct(position.entry, bar.open, costScenarios.investorStress) });
    }
    if (bar.day < from || (index > 0 && monday(bar.day) === monday(bars[index - 1]!.day))) continue;
    if (index < 21) { decisions.push({ day: bar.day, status: 'warmup' }); continue; }
    const prior = bars[index - 1]!, lagged = bars[index - 21]!;
    if ((Date.parse(bar.day) - Date.parse(prior.day)) / 86_400_000 > 7) {
      decisions.push({ day: bar.day, status: 'stale-history' }); continue;
    }
    const trailingRatio = prior.close / lagged.close;
    const common = { day: bar.day, trailingRatio, breakevenRatio };
    if (mode === 'conditional' && trailingRatio <= breakevenRatio) {
      decisions.push({ ...common, status: 'no-signal' }); continue;
    }
    if (positions.length >= 5) { decisions.push({ ...common, status: 'capacity-skip' }); continue; }
    const equity = cash + positions.reduce((sum, position) => sum + position.shares * bar.open *
      (1 - base.slippage) * (1 - base.commission), 0);
    const principal = Math.min(cash, equity / 5);
    if (principal < 1) { decisions.push({ ...common, status: 'cash-skip' }); continue; }
    cash -= principal;
    positions.push({ exitIndex: index + 20, entryDay: bar.day, entry: bar.open, principal,
      shares: principal / (bar.open * (1 + base.slippage) * (1 + base.commission)) });
    maxConcurrent = Math.max(maxConcurrent, positions.length);
    decisions.push({ ...common, status: 'opened' });
  }
  const last = bars.at(-1);
  return { trades, decisions, maxConcurrent, endingCash: cash,
    pending: positions.map(({ exitIndex: unused, ...position }) => position),
    endingLiquidationValue: last === undefined ? cash : cash + positions.reduce((sum, position) =>
      sum + position.shares * last.close * (1 - base.slippage) * (1 - base.commission), 0) };
}

export function buyAndHoldLqdt(input: readonly DailyBar[], from: string, thru: string) {
  const bars = input.filter((bar) => {
    const n = new Date(`${bar.day}T12:00:00Z`).getUTCDay();
    return n >= 1 && n <= 5 && bar.day >= from && bar.day <= thru;
  });
  const first = bars[0], last = bars.at(-1);
  if (!first || !last) throw new Error('No buy-and-hold bars');
  const shares = 1_000_000 / (first.open * (1 + base.slippage) * (1 + base.commission));
  return { entryDay: first.day, entry: first.open, finalDay: last.day,
    finalClose: last.close, endingLiquidationValue: shares * last.close *
      (1 - base.slippage) * (1 - base.commission) };
}

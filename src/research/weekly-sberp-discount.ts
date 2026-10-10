import { costScenarios, eventReturnPct } from './trading-costs.js';
import { median } from './weekly-quiet-trend.js';
import type { DailyBar } from './weekly-trend.js';
import type { RelativeTrade } from './weekly-relative-strength.js';

type Position = { entryIndex: number; exitIndex: number; entryDay: string; entry: number;
  principal: number; shares: number };

function weekday(day: string): boolean {
  const value = new Date(`${day}T12:00:00Z`).getUTCDay();
  return value >= 1 && value <= 5;
}

function week(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function discountSignal(ratios: readonly number[], entryIndex: number) {
  if (entryIndex < 253) throw new Error('Insufficient ratio history');
  const last = ratios[entryIndex - 1];
  const reference = ratios.slice(entryIndex - 253, entryIndex - 1);
  if (reference.length !== 252 || last === undefined ||
    ![last, ...reference].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid ratio history');
  }
  const center = median(reference);
  const mad = median(reference.map((value) => Math.abs(value - center)));
  const robustSigma = 1.4826 * mad;
  return { ratio: last, median: center, robustSigma,
    signal: mad > 0 && last < center - robustSigma };
}

export function simulateWeeklySberpDiscount(
  sberInput: readonly DailyBar[],
  sberpInput: readonly DailyBar[],
  from = '0000-01-01',
  thru = '9999-12-31',
) {
  const sber = sberInput.filter((bar) => weekday(bar.day));
  const sberp = sberpInput.filter((bar) => weekday(bar.day));
  if (sber.length !== sberp.length || sber.some((bar, index) => bar.day !== sberp[index]?.day)) {
    throw new Error('SBER and SBERP calendars differ');
  }
  for (const bars of [sber, sberp]) {
    if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 ||
      !Number.isFinite(bar.close) || bar.close <= 0 ||
      (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  }
  const ratios = sber.map((bar, index) => sberp[index]!.close / bar.close);
  const trades: RelativeTrade[] = [];
  const decisions: { day: string; status: string; ratio?: number;
    median?: number; robustSigma?: number }[] = [];
  let cash = 1_000_000;
  let positions: Position[] = [];
  let maxConcurrent = 0;
  for (let index = 0; index < sberp.length; index++) {
    const bar = sberp[index]!;
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
    if (bar.day < from || bar.day > thru) continue;
    if (index > 0 && week(bar.day) === week(sberp[index - 1]!.day)) continue;
    const previous = sberp[index - 1];
    if (!previous || index < 253) { decisions.push({ day: bar.day, status: 'warmup' }); continue; }
    if ((Date.parse(bar.day) - Date.parse(previous.day)) / 86_400_000 > 7) {
      decisions.push({ day: bar.day, status: 'stale-history' }); continue;
    }
    const signal = discountSignal(ratios, index);
    const context = { day: bar.day, ratio: signal.ratio, median: signal.median,
      robustSigma: signal.robustSigma };
    if (!signal.signal) { decisions.push({ ...context, status: 'no-signal' }); continue; }
    if (positions.length >= 5) { decisions.push({ ...context, status: 'capacity-skip' }); continue; }
    const equity = cash + positions.reduce((total, position) => total + position.shares * bar.open *
      (1 - costScenarios.investorBase.slippage) * (1 - costScenarios.investorBase.commission), 0);
    const principal = Math.min(cash, equity / 5);
    if (principal < 1) { decisions.push({ ...context, status: 'cash-skip' }); continue; }
    cash -= principal;
    positions.push({ entryIndex: index, exitIndex: index + 20, entryDay: bar.day, entry: bar.open,
      principal, shares: principal / (bar.open * (1 + costScenarios.investorBase.slippage) *
        (1 + costScenarios.investorBase.commission)) });
    maxConcurrent = Math.max(maxConcurrent, positions.length);
    decisions.push({ ...context, status: 'opened' });
  }
  const lastOpen = sberp.at(-1)?.open;
  return { trades, decisions, maxConcurrent, endingCash: cash,
    pending: positions.map(({ entryIndex: unused, exitIndex: unusedExit, ...position }) => position),
    endingLiquidationValue: lastOpen === undefined ? cash : cash + positions.reduce((total, position) =>
      total + position.shares * lastOpen * (1 - costScenarios.investorBase.slippage) *
      (1 - costScenarios.investorBase.commission), 0) };
}

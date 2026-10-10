import { costScenarios, eventReturnPct } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

type Position = { entryIndex: number; exitIndex: number; entryDay: string; entry: number;
  principal: number; shares: number };
export type RelativeTrade = { entryDay: string; exitDay: string; entry: number; exit: number;
  principal: number; proceeds: number; netPct: number; stressPct: number };

function weekday(day: string): boolean {
  const value = new Date(`${day}T12:00:00Z`).getUTCDay();
  return value >= 1 && value <= 5;
}

function week(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function simulateWeeklyRelativeStrength(sberInput: readonly DailyBar[], gazpInput: readonly DailyBar[]) {
  const sber = sberInput.filter((bar) => weekday(bar.day));
  const gazp = gazpInput.filter((bar) => weekday(bar.day));
  if (sber.length !== gazp.length || sber.some((bar, index) => bar.day !== gazp[index]?.day)) {
    throw new Error('SBER and GAZP calendars differ');
  }
  for (const bars of [sber, gazp]) {
    if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 ||
      !Number.isFinite(bar.close) || bar.close <= 0 ||
      (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  }
  const trades: RelativeTrade[] = [];
  const decisions: { day: string; status: string; trend?: boolean; relative?: boolean }[] = [];
  let cash = 1_000_000;
  let positions: Position[] = [];
  let maxConcurrent = 0;
  for (let index = 0; index < sber.length; index++) {
    const bar = sber[index]!;
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
    if (index > 0 && week(bar.day) === week(sber[index - 1]!.day)) continue;
    const previous = sber[index - 1];
    const lagged = sber[index - 253];
    const relativeBaseSber = sber[index - 64];
    const relativeBaseGazp = gazp[index - 64];
    if (!previous || !lagged || !relativeBaseSber || !relativeBaseGazp) {
      decisions.push({ day: bar.day, status: 'warmup' }); continue;
    }
    if ((Date.parse(bar.day) - Date.parse(previous.day)) / 86_400_000 > 7) {
      decisions.push({ day: bar.day, status: 'stale-history' }); continue;
    }
    const trend = previous.close > lagged.close;
    const relative = previous.close / relativeBaseSber.close >
      gazp[index - 1]!.close / relativeBaseGazp.close;
    if (!trend || !relative) { decisions.push({ day: bar.day, status: 'no-signal', trend, relative }); continue; }
    if (positions.length >= 5) { decisions.push({ day: bar.day, status: 'capacity-skip', trend, relative }); continue; }
    const equity = cash + positions.reduce((total, position) => total + position.shares * bar.open *
      (1 - costScenarios.investorBase.slippage) * (1 - costScenarios.investorBase.commission), 0);
    const principal = Math.min(cash, equity / 5);
    if (principal < 1) { decisions.push({ day: bar.day, status: 'cash-skip', trend, relative }); continue; }
    cash -= principal;
    positions.push({ entryIndex: index, exitIndex: index + 20, entryDay: bar.day, entry: bar.open,
      principal, shares: principal / (bar.open * (1 + costScenarios.investorBase.slippage) *
        (1 + costScenarios.investorBase.commission)) });
    maxConcurrent = Math.max(maxConcurrent, positions.length);
    decisions.push({ day: bar.day, status: 'opened', trend, relative });
  }
  const lastOpen = sber.at(-1)?.open;
  return { trades, decisions, maxConcurrent, endingCash: cash,
    pending: positions.map(({ entryIndex: unused, exitIndex: unusedExit, ...position }) => position),
    endingLiquidationValue: lastOpen === undefined ? cash : cash + positions.reduce((total, position) =>
      total + position.shares * lastOpen * (1 - costScenarios.investorBase.slippage) *
      (1 - costScenarios.investorBase.commission), 0) };
}

export function relativeStats(trades: readonly RelativeTrade[]) {
  const values = trades.map((trade) => trade.netPct);
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const sum = (items: readonly number[]) => items.reduce((total, value) => total + value, 0);
  return { trades: trades.length, weeks: new Set(trades.map((trade) => week(trade.entryDay))).size,
    winners: wins.length, winRate: trades.length ? wins.length / trades.length : null,
    meanNetPct: trades.length ? sum(values) / trades.length : null,
    profitFactor: losses.length ? sum(wins) / -sum(losses) : null,
    withoutBestFiveSumPct: sum([...values].sort((a, b) => b - a).slice(5)),
    stressMeanPct: trades.length ? sum(trades.map((trade) => trade.stressPct)) / trades.length : null };
}

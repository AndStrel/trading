import { costScenarios, eventReturnPct } from './trading-costs.js';

export type DailyBar = {
  day: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
type SignalMode = 'trend' | 'always-long';
type Position = { entryIndex: number; exitIndex: number; entryDay: string; entryWeek: string;
  entry: number; principal: number; shares: number };
export type TrendTrade = { entryDay: string; exitDay: string; entryWeek: string; entry: number; exit: number;
  principal: number; proceeds: number; grossPct: number; netPct: number; stressPct: number; calendarDaysHeld: number };
export type TrendDecision = { day: string; week: string; signal: boolean | null;
  status: 'opened' | 'no-signal' | 'warmup' | 'stale-history' | 'capacity-skip' | 'cash-skip';
  previousClose: number | null; laggedClose: number | null };

function weekMonday(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

function isWeekday(day: string) {
  const dayOfWeek = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

export function simulateWeeklyTrend(input: readonly DailyBar[], mode: SignalMode) {
  const bars = input.filter((bar) => isWeekday(bar.day));
  if (bars.some((bar, i) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) ||
    bar.close <= 0 || (i > 0 && bar.day <= bars[i - 1]!.day))) throw new Error('Invalid or unordered daily bars');
  const trades: TrendTrade[] = [], decisions: TrendDecision[] = [];
  let cash = 1_000_000, positions: Position[] = [], maxConcurrent = 0;
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index]!;
    const exits = positions.filter((position) => position.exitIndex === index);
    positions = positions.filter((position) => position.exitIndex !== index);
    for (const position of exits) {
      const proceeds = position.shares * bar.open * (1 - costScenarios.investorBase.slippage) *
        (1 - costScenarios.investorBase.commission);
      cash += proceeds;
      trades.push({ entryDay: position.entryDay, exitDay: bar.day, entryWeek: position.entryWeek,
        entry: position.entry, exit: bar.open, principal: position.principal, proceeds,
        grossPct: eventReturnPct(position.entry, bar.open, costScenarios.gross),
        netPct: (proceeds / position.principal - 1) * 100,
        stressPct: eventReturnPct(position.entry, bar.open, costScenarios.investorStress),
        calendarDaysHeld: (Date.parse(bar.day) - Date.parse(position.entryDay)) / 86_400_000 });
    }
    const week = weekMonday(bar.day);
    if (index > 0 && week === weekMonday(bars[index - 1]!.day)) continue;
    const previous = bars[index - 1], lagged = bars[index - 253];
    const common = { day: bar.day, week, previousClose: previous?.close ?? null, laggedClose: lagged?.close ?? null };
    if (!previous || !lagged) { decisions.push({ ...common, signal: null, status: 'warmup' }); continue; }
    if ((Date.parse(bar.day) - Date.parse(previous.day)) / 86_400_000 > 7) {
      decisions.push({ ...common, signal: null, status: 'stale-history' }); continue;
    }
    const signal = mode === 'always-long' || previous.close > lagged.close;
    if (!signal) { decisions.push({ ...common, signal, status: 'no-signal' }); continue; }
    if (positions.length >= 5) { decisions.push({ ...common, signal, status: 'capacity-skip' }); continue; }
    const equity = cash + positions.reduce((sum, p) => sum + p.shares * bar.open *
      (1 - costScenarios.investorBase.slippage) * (1 - costScenarios.investorBase.commission), 0);
    const principal = Math.min(cash, equity / 5);
    if (principal < 1) { decisions.push({ ...common, signal, status: 'cash-skip' }); continue; }
    cash -= principal;
    positions.push({ entryIndex: index, exitIndex: index + 20, entryDay: bar.day, entryWeek: week,
      entry: bar.open, principal,
      shares: principal / (bar.open * (1 + costScenarios.investorBase.slippage) *
        (1 + costScenarios.investorBase.commission)) });
    maxConcurrent = Math.max(maxConcurrent, positions.length);
    decisions.push({ ...common, signal, status: 'opened' });
  }
  const lastOpen = bars.at(-1)?.open;
  return { mode, trades, decisions, maxConcurrent, endingCash: cash,
    pending: positions.map(({ entryIndex: unused, exitIndex: unusedExit, ...position }) => position),
    endingLiquidationValue: lastOpen === undefined ? cash : cash + positions.reduce((sum, p) =>
      sum + p.shares * lastOpen * (1 - costScenarios.investorBase.slippage) *
      (1 - costScenarios.investorBase.commission), 0),
  };
}

export function weeklyTrendStats(trades: readonly TrendTrade[]) {
  const values = trades.map((trade) => trade.netPct), sorted = [...values].sort((a, b) => b - a);
  const wins = values.filter((v) => v > 0), losses = values.filter((v) => v < 0);
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  const positive = sum(wins), negative = -sum(losses);
  return { trades: trades.length, entryWeeks: new Set(trades.map((t) => t.entryWeek)).size,
    winners: wins.length, winRate: trades.length ? wins.length / trades.length : null,
    meanNetPct: trades.length ? sum(values) / trades.length : null,
    profitFactor: negative > 0 ? positive / negative : null,
    withoutBestFiveSumPct: sum(sorted.slice(5)),
    stressWinRate: trades.length ? trades.filter((t) => t.stressPct > 0).length / trades.length : null,
    stressMeanPct: trades.length ? sum(trades.map((t) => t.stressPct)) / trades.length : null,
    maxCalendarDaysHeld: trades.length ? Math.max(...trades.map((t) => t.calendarDaysHeld)) : null };
}

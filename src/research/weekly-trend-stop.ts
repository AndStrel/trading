import { costScenarios, eventReturnPct } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

type Position = { entryIndex: number; exitIndex: number; entry: number; entryDay: string;
  principal: number; shares: number; stop: number };
export type StopTrade = { entryDay: string; exitDay: string; entry: number; exit: number;
  principal: number; proceeds: number; netPct: number; stressPct: number;
  reason: 'stop' | 'time'; gapThroughStop: boolean };

function weekday(day: string): boolean {
  const value = new Date(`${day}T12:00:00Z`).getUTCDay();
  return value >= 1 && value <= 5;
}

function week(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function atrAtEntry(bars: readonly DailyBar[], entryIndex: number): number {
  if (entryIndex < 21) throw new Error('Insufficient ATR history');
  let total = 0;
  for (let index = entryIndex - 20; index < entryIndex; index++) {
    const bar = bars[index]!;
    const previousClose = bars[index - 1]!.close;
    total += Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose));
  }
  return total / 20;
}

export function simulateWeeklyTrendStop(input: readonly DailyBar[], withStop: boolean) {
  const bars = input.filter((bar) => weekday(bar.day));
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 ||
    !Number.isFinite(bar.close) || bar.close <= 0 || !Number.isFinite(bar.high) ||
    bar.high < Math.max(bar.open, bar.close) || !Number.isFinite(bar.low) ||
    bar.low <= 0 || bar.low > Math.min(bar.open, bar.close) ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) {
    throw new Error('Invalid or unordered daily bars');
  }
  let cash = 1_000_000;
  let positions: Position[] = [];
  const trades: StopTrade[] = [];
  const decisions: { day: string; status: string; signal?: boolean; atr?: number }[] = [];
  let maxConcurrent = 0;
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index]!;
    const remaining: Position[] = [];
    for (const position of positions) {
      const timeExit = index === position.exitIndex;
      const stopHit = withStop && bar.low <= position.stop;
      if (!timeExit && !stopHit) { remaining.push(position); continue; }
      const gapThroughStop = !timeExit && index > position.entryIndex && bar.open < position.stop;
      const exit = timeExit ? bar.open : (gapThroughStop ? bar.open : position.stop);
      const proceeds = position.shares * exit * (1 - costScenarios.investorBase.slippage) *
        (1 - costScenarios.investorBase.commission);
      cash += proceeds;
      trades.push({ entryDay: position.entryDay, exitDay: bar.day, entry: position.entry,
        exit, principal: position.principal, proceeds, netPct: (proceeds / position.principal - 1) * 100,
        stressPct: eventReturnPct(position.entry, exit, costScenarios.investorStress),
        reason: timeExit ? 'time' : 'stop', gapThroughStop });
    }
    positions = remaining;
    if (index > 0 && week(bar.day) === week(bars[index - 1]!.day)) continue;
    const previous = bars[index - 1];
    const lagged = bars[index - 253];
    if (!previous || !lagged) { decisions.push({ day: bar.day, status: 'warmup' }); continue; }
    if ((Date.parse(bar.day) - Date.parse(previous.day)) / 86_400_000 > 7) {
      decisions.push({ day: bar.day, status: 'stale-history' }); continue;
    }
    const signal = previous.close > lagged.close;
    if (!signal) { decisions.push({ day: bar.day, status: 'no-signal', signal }); continue; }
    if (positions.length >= 5) { decisions.push({ day: bar.day, status: 'capacity-skip', signal }); continue; }
    const atr = atrAtEntry(bars, index);
    const stop = bar.open - 2 * atr;
    if (stop <= 0) { decisions.push({ day: bar.day, status: 'invalid-stop', signal, atr }); continue; }
    const equity = cash + positions.reduce((total, position) => total + position.shares * bar.open *
      (1 - costScenarios.investorBase.slippage) * (1 - costScenarios.investorBase.commission), 0);
    const principal = Math.min(cash, equity / 5);
    if (principal < 1) { decisions.push({ day: bar.day, status: 'cash-skip', signal, atr }); continue; }
    cash -= principal;
    positions.push({ entryIndex: index, exitIndex: index + 20, entry: bar.open, entryDay: bar.day,
      principal, shares: principal / (bar.open * (1 + costScenarios.investorBase.slippage) *
        (1 + costScenarios.investorBase.commission)), stop });
    maxConcurrent = Math.max(maxConcurrent, positions.length);
    decisions.push({ day: bar.day, status: 'opened', signal, atr });
    // The entry candle is known only after its open; a same-day low can trigger the fixed stop.
    if (withStop && bar.low <= stop) {
      const position = positions.pop()!;
      const proceeds = position.shares * stop * (1 - costScenarios.investorBase.slippage) *
        (1 - costScenarios.investorBase.commission);
      cash += proceeds;
      trades.push({ entryDay: bar.day, exitDay: bar.day, entry: bar.open, exit: stop,
        principal, proceeds, netPct: (proceeds / principal - 1) * 100,
        stressPct: eventReturnPct(bar.open, stop, costScenarios.investorStress),
        reason: 'stop', gapThroughStop: false });
    }
  }
  const lastOpen = bars.at(-1)?.open;
  return { withStop, trades, decisions, maxConcurrent, endingCash: cash,
    pending: positions.map(({ entryIndex: unused, exitIndex: unusedExit, ...position }) => position),
    endingLiquidationValue: lastOpen === undefined ? cash : cash + positions.reduce((total, position) =>
      total + position.shares * lastOpen * (1 - costScenarios.investorBase.slippage) *
      (1 - costScenarios.investorBase.commission), 0) };
}

export function stopStats(trades: readonly StopTrade[]) {
  const values = trades.map((trade) => trade.netPct);
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const sum = (items: readonly number[]) => items.reduce((total, value) => total + value, 0);
  return { trades: trades.length, weeks: new Set(trades.map((trade) => week(trade.entryDay))).size,
    winners: wins.length, winRate: trades.length ? wins.length / trades.length : null,
    meanNetPct: trades.length ? sum(values) / trades.length : null,
    profitFactor: losses.length ? sum(wins) / -sum(losses) : null,
    withoutBestFiveSumPct: sum([...values].sort((a, b) => b - a).slice(5)),
    stressMeanPct: trades.length ? sum(trades.map((trade) => trade.stressPct)) / trades.length : null,
    stopExits: trades.filter((trade) => trade.reason === 'stop').length,
    gapThroughStops: trades.filter((trade) => trade.gapThroughStop).length };
}

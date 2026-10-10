import type { SiCandle } from './si-first-hour.js';
import { tLongReturn, type TCostScenario } from './t-morning-strength.js';

type Returns = Record<TCostScenario, number>;
export type TRiskDecision = {
  date: string;
  ticker: 'TCSG' | 'T';
  status: 'excluded' | 'cash' | 'cancelled_entry' | 'unresolved_exit' | 'trade';
  reason?: string;
  signalReturn?: number;
  entryTime?: string;
  entry?: number;
  exitTime?: string;
  exit?: number;
  exitReason?: 'stop' | 'target' | 'time';
  gross?: number;
  returns?: Returns;
};

function at(date: string, minute: number): string {
  return `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
}
function minuteOfDay(time: string): number {
  return Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));
}

export function evaluateTMorningStrengthRisk(input: {
  date: string;
  ticker: 'TCSG' | 'T';
  candles: readonly SiCandle[];
}): TRiskDecision {
  const { date, ticker, candles } = input;
  const base = { date, ticker };
  const byTime = new Map(candles.map((candle) => [candle.time, candle]));
  const anchor = byTime.get(at(date, 600));
  const signal = byTime.get(at(date, 630));
  if (!anchor || !signal) return { ...base, status: 'excluded', reason: 'anchor_or_signal_missing' };
  const signalReturn = signal.close / anchor.close - 1;
  if (signalReturn < 0.002) return { ...base, status: 'cash', signalReturn };
  let entry: SiCandle | undefined;
  for (let minute = 631; minute <= 633; minute += 1) {
    entry = byTime.get(at(date, minute));
    if (entry) break;
  }
  if (!entry) return { ...base, status: 'cancelled_entry', reason: 'no_trade_within_three_minutes', signalReturn };
  const entryMinute = minuteOfDay(entry.time);
  const stop = entry.open * 0.992;
  const target = entry.open * 1.015;
  let exit: number | undefined;
  let exitTime: string | undefined;
  let exitReason: 'stop' | 'target' | 'time' | undefined;
  for (let minute = entryMinute; minute <= 1020; minute += 1) {
    const candle = byTime.get(at(date, minute));
    if (!candle) return { ...base, status: 'unresolved_exit', reason: 'holding_minute_missing',
      signalReturn, entryTime: entry.time, entry: entry.open };
    if (minute >= 1015) {
      exit = candle.open;
      exitTime = candle.time;
      exitReason = 'time';
      break;
    }
    if (candle.low <= stop) {
      exit = Math.min(stop, candle.open);
      exitTime = candle.time;
      exitReason = 'stop';
      break;
    }
    if (candle.high >= target) {
      exit = target;
      exitTime = candle.time;
      exitReason = 'target';
      break;
    }
  }
  if (exit === undefined || exitTime === undefined || exitReason === undefined) {
    return { ...base, status: 'unresolved_exit', reason: 'no_exit_print', signalReturn, entryTime: entry.time, entry: entry.open };
  }
  const tick = ticker === 'TCSG' ? 0.1 : 0.02;
  const returns: Returns = {
    investorBase: tLongReturn(entry.open, exit, 0.0005, 0.003, tick),
    investorStress: tLongReturn(entry.open, exit, 0.001, 0.003, tick),
    proBase: tLongReturn(entry.open, exit, 0.0005, 0, tick),
    proStress: tLongReturn(entry.open, exit, 0.001, 0, tick),
  };
  return { ...base, status: 'trade', signalReturn, entryTime: entry.time, entry: entry.open,
    exitTime, exit, exitReason, gross: exit / entry.open - 1, returns };
}

export function summarizeTMorningStrengthRisk(decisions: readonly TRiskDecision[]) {
  const trades = decisions.filter((item) => item.status === 'trade');
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const scenario = (key: TCostScenario) => {
    const values = trades.map((item) => item.returns![key]);
    const block = (items: readonly TRiskDecision[]) => {
      const complete = items.filter((item) => item.status === 'trade');
      return { trades: complete.length, winners: complete.filter((item) => item.returns![key] > 0).length,
        mean: complete.length ? sum(complete.map((item) => item.returns![key])) / complete.length : null };
    };
    return { winners: values.filter((value) => value > 0).length,
      winRate: values.length ? values.filter((value) => value > 0).length / values.length : null,
      mean: values.length ? sum(values) / values.length : null,
      aggregate: sum(values),
      withoutBestFive: sum([...values].sort((a, b) => b - a).slice(5)),
      worst: values.length ? Math.min(...values) : null,
      byBlock: { marchJune: block(decisions.filter((item) => item.date <= '2024-06-30')),
        julyDecember: block(decisions.filter((item) => item.date >= '2024-07-01')) } };
  };
  return { dates: decisions.length, excluded: decisions.filter((item) => item.status === 'excluded').length,
    cash: decisions.filter((item) => item.status === 'cash').length,
    cancelledEntry: decisions.filter((item) => item.status === 'cancelled_entry').length,
    unresolvedExit: decisions.filter((item) => item.status === 'unresolved_exit').length,
    trades: trades.length, tradeDates: new Set(trades.map((item) => item.date)).size,
    exitReasons: { stop: trades.filter((item) => item.exitReason === 'stop').length,
      target: trades.filter((item) => item.exitReason === 'target').length,
      time: trades.filter((item) => item.exitReason === 'time').length },
    grossWinners: trades.filter((item) => item.gross! > 0).length,
    meanGross: trades.length ? sum(trades.map((item) => item.gross!)) / trades.length : null,
    scenarios: { investorBase: scenario('investorBase'), investorStress: scenario('investorStress'),
      proBase: scenario('proBase'), proStress: scenario('proStress') } };
}

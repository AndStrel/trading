import type { SiCandle } from './si-first-hour.js';

export type TCostScenario = 'investorBase' | 'investorStress' | 'proBase' | 'proStress';
type Returns = Record<TCostScenario, number>;
export type TMorningDecision = {
  date: string;
  status: 'excluded' | 'cash' | 'cancelled_entry' | 'unresolved_exit' | 'trade';
  reason?: string;
  signalReturn?: number;
  entryTime?: string;
  entry?: number;
  exitTime?: string;
  exit?: number;
  gross?: number;
  unroundedInvestorBase?: number;
  returns?: Returns;
};

function minuteOfDay(time: string): number {
  return Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));
}
function at(date: string, minute: number): string {
  return `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
}

export function tLongReturn(entry: number, exit: number, slippage: number, commission: number, tick: number): number {
  if (![entry, exit].every((value) => Number.isFinite(value) && value > 0) ||
      ![slippage, commission].every((value) => Number.isFinite(value) && value >= 0 && value < 1) ||
      !Number.isFinite(tick) || tick < 0) throw new Error('Invalid T return input');
  const rawBuy = entry * (1 + slippage);
  const rawSell = exit * (1 - slippage);
  const buy = tick ? Math.ceil(rawBuy / tick - 1e-9) * tick : rawBuy;
  const sell = tick ? Math.floor(rawSell / tick + 1e-9) * tick : rawSell;
  return sell * (1 - commission) / (buy * (1 + commission)) - 1;
}

export function evaluateTMorningStrength(date: string, candles: readonly SiCandle[]): TMorningDecision {
  const byTime = new Map(candles.map((candle) => [candle.time, candle]));
  const anchor = byTime.get(`${date} 10:00:00`);
  const signal = byTime.get(`${date} 10:30:00`);
  if (!anchor || !signal) return { date, status: 'excluded', reason: 'anchor_or_signal_missing' };
  const signalReturn = signal.close / anchor.close - 1;
  if (signalReturn < 0.002) return { date, status: 'cash', signalReturn };
  const entry = candles.find((candle) => {
    const minute = minuteOfDay(candle.time);
    return minute >= 631 && minute <= 633;
  });
  if (!entry) return { date, status: 'cancelled_entry', reason: 'no_trade_within_three_minutes', signalReturn };
  const exit = candles.find((candle) => {
    const minute = minuteOfDay(candle.time);
    return minute >= 1015 && minute <= 1020;
  });
  if (!exit) return { date, status: 'unresolved_exit', reason: 'no_exit_print', signalReturn, entryTime: entry.time, entry: entry.open };
  for (let minute = minuteOfDay(entry.time); minute <= minuteOfDay(exit.time); minute += 1) {
    if (!byTime.has(at(date, minute))) return { date, status: 'unresolved_exit', reason: 'holding_minute_missing',
      signalReturn, entryTime: entry.time, entry: entry.open, exitTime: exit.time, exit: exit.open };
  }
  const returns: Returns = {
    investorBase: tLongReturn(entry.open, exit.open, 0.0005, 0.003, 0.02),
    investorStress: tLongReturn(entry.open, exit.open, 0.001, 0.003, 0.02),
    proBase: tLongReturn(entry.open, exit.open, 0.0005, 0, 0.02),
    proStress: tLongReturn(entry.open, exit.open, 0.001, 0, 0.02),
  };
  return { date, status: 'trade', signalReturn, entryTime: entry.time, entry: entry.open,
    exitTime: exit.time, exit: exit.open, gross: exit.open / entry.open - 1,
    unroundedInvestorBase: tLongReturn(entry.open, exit.open, 0.0005, 0.003, 0), returns };
}

export function summarizeTMorningStrength(decisions: readonly TMorningDecision[]) {
  const trades = decisions.filter((item) => item.status === 'trade');
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const scenario = (key: TCostScenario) => {
    const values = trades.map((item) => item.returns![key]);
    const block = (items: readonly TMorningDecision[]) => {
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
      byBlock: { januaryJune: block(decisions.filter((item) => item.date <= '2025-06-30')),
        julyDecember: block(decisions.filter((item) => item.date >= '2025-07-01')) } };
  };
  return { dates: decisions.length, excluded: decisions.filter((item) => item.status === 'excluded').length,
    cash: decisions.filter((item) => item.status === 'cash').length,
    cancelledEntry: decisions.filter((item) => item.status === 'cancelled_entry').length,
    unresolvedExit: decisions.filter((item) => item.status === 'unresolved_exit').length,
    trades: trades.length, tradeDates: new Set(trades.map((item) => item.date)).size,
    grossWinners: trades.filter((item) => item.gross! > 0).length,
    meanGross: trades.length ? sum(trades.map((item) => item.gross!)) / trades.length : null,
    meanUnroundedInvestorBase: trades.length ? sum(trades.map((item) => item.unroundedInvestorBase!)) / trades.length : null,
    scenarios: { investorBase: scenario('investorBase'), investorStress: scenario('investorStress'),
      proBase: scenario('proBase'), proStress: scenario('proStress') } };
}

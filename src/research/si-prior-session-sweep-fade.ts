import {
  SI_BASE_COSTS,
  SI_STRESS_COSTS,
  siTradeReturn,
  validateSiDayCandles,
  type SiCandle,
  type SiSide,
} from './si-first-hour.js';

export type PriorSessionSweepSpec = { date: string; contract: string; prevHigh: number; prevLow: number };
export type PriorSessionSweepDecision = {
  date: string;
  contract: string;
  status: 'warmup' | 'special_session' | 'no_session' | 'missing_reference' | 'missing_signal' | 'no_signal' |
    'ambiguous_signal' | 'cancelled_entry' | 'unresolved_holding' | 'trade';
  side?: SiSide;
  signalTime?: string;
  entry?: number;
  stop?: number;
  target?: number;
  exit?: number;
  exitReason?: 'stop' | 'target' | 'time';
  gross?: number;
  baseNet?: number;
  stressNet?: number;
};

const time = (date: string, minute: number) =>
  `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
const clearing = (minute: number) => minute >= 840 && minute <= 844;

export function evaluateSiPriorSessionSweepFade(
  spec: PriorSessionSweepSpec,
  candles: readonly SiCandle[],
): PriorSessionSweepDecision {
  validateSiDayCandles(candles, spec.date);
  const byTime = new Map(candles.map((candle) => [candle.time, candle]));
  let signal: SiCandle | undefined;
  let side: SiSide | undefined;
  for (let minute = 600; minute <= 930; minute += 1) {
    if (clearing(minute)) continue;
    const candle = byTime.get(time(spec.date, minute));
    if (!candle) return { date: spec.date, contract: spec.contract, status: 'missing_signal' };
    const short = candle.high >= spec.prevHigh + 1 && candle.close < spec.prevHigh;
    const long = candle.low <= spec.prevLow - 1 && candle.close > spec.prevLow;
    if (short && long) return { date: spec.date, contract: spec.contract, status: 'ambiguous_signal', signalTime: candle.time };
    if (short || long) {
      signal = candle;
      side = short ? 'short' : 'long';
      break;
    }
  }
  if (!signal || !side) return { date: spec.date, contract: spec.contract, status: 'no_signal' };

  let entryMinute = Number(signal.time.slice(11, 13)) * 60 + Number(signal.time.slice(14, 16)) + 1;
  if (clearing(entryMinute)) entryMinute = 845;
  const entryCandle = byTime.get(time(spec.date, entryMinute));
  if (!entryCandle) return { date: spec.date, contract: spec.contract, status: 'cancelled_entry', side, signalTime: signal.time };
  const entry = entryCandle.open;
  const stop = side === 'short' ? signal.high + 1 : signal.low - 1;
  if ((side === 'long' && entry <= stop) || (side === 'short' && entry >= stop)) {
    return { date: spec.date, contract: spec.contract, status: 'cancelled_entry', side, signalTime: signal.time, entry, stop };
  }
  const risk = Math.abs(entry - stop);
  const target = side === 'long' ? entry + 2 * risk : entry - 2 * risk;
  let exit: number | undefined;
  let exitReason: PriorSessionSweepDecision['exitReason'];
  for (let minute = entryMinute; minute <= 1014; minute += 1) {
    if (clearing(minute)) continue;
    const candle = byTime.get(time(spec.date, minute));
    if (!candle) return { date: spec.date, contract: spec.contract, status: 'unresolved_holding', side, signalTime: signal.time, entry, stop, target };
    const stopHit = side === 'long' ? candle.low <= stop : candle.high >= stop;
    const targetHit = side === 'long' ? candle.high >= target : candle.low <= target;
    if (stopHit) {
      exit = side === 'long' ? Math.min(stop, candle.open) : Math.max(stop, candle.open);
      exitReason = 'stop';
      break;
    }
    if (targetHit) {
      exit = target;
      exitReason = 'target';
      break;
    }
  }
  if (exit === undefined) {
    const timeExit = byTime.get(time(spec.date, 1015));
    if (!timeExit) return { date: spec.date, contract: spec.contract, status: 'unresolved_holding', side, signalTime: signal.time, entry, stop, target };
    exit = timeExit.open;
    exitReason = 'time';
  }
  if (!exitReason) throw new Error('Completed sweep trade has no exit reason');
  return {
    date: spec.date, contract: spec.contract, status: 'trade', side, signalTime: signal.time,
    entry, stop, target, exit, exitReason,
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
  };
}

export function summarizeSiPriorSessionSweepFade(decisions: readonly PriorSessionSweepDecision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const nets = trades.map((trade) => trade.baseNet!);
  const sum = nets.reduce((total, value) => total + value, 0);
  const gains = nets.filter((value) => value > 0).reduce((total, value) => total + value, 0);
  const losses = -nets.filter((value) => value < 0).reduce((total, value) => total + value, 0);
  const statuses = ['warmup', 'special_session', 'no_session', 'missing_reference', 'missing_signal', 'no_signal',
    'ambiguous_signal', 'cancelled_entry', 'unresolved_holding', 'trade'] as const;
  return {
    dates: decisions.length,
    statuses: Object.fromEntries(statuses.map((status) => [status, decisions.filter((decision) => decision.status === status).length])),
    trades: trades.length,
    winners: nets.filter((value) => value > 0).length,
    winRate: trades.length ? nets.filter((value) => value > 0).length / trades.length : null,
    meanGross: trades.length ? trades.reduce((total, trade) => total + trade.gross!, 0) / trades.length : null,
    meanBaseNet: trades.length ? sum / trades.length : null,
    meanStressNet: trades.length ? trades.reduce((total, trade) => total + trade.stressNet!, 0) / trades.length : null,
    sumBaseNet: sum,
    profitFactor: losses ? gains / losses : null,
    withoutBestTradeSum: nets.length ? sum - Math.max(...nets) : null,
    exits: Object.fromEntries((['stop', 'target', 'time'] as const).map((reason) =>
      [reason, trades.filter((trade) => trade.exitReason === reason).length])),
  };
}

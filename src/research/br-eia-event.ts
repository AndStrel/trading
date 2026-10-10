import {
  SI_BASE_COSTS,
  SI_STRESS_COSTS,
  siTradeReturn,
  validateSiDayCandles,
  type SiCandle,
  type SiSide,
} from './si-first-hour.js';

export type BrEiaEventSpec = { date: string; contract: string; signalStartMinute: number; releaseEastern: string };
export type BrEiaDecision = {
  date: string;
  contract: string;
  releaseEastern: string;
  status: 'missing_signal' | 'no_signal' | 'cancelled_entry' | 'unresolved' | 'trade';
  signalReturn?: number;
  signalTime?: string;
  side?: SiSide;
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

export function evaluateBrEiaEvent(spec: BrEiaEventSpec, candles: readonly SiCandle[]): BrEiaDecision {
  validateSiDayCandles(candles, spec.date);
  const byTime = new Map(candles.map((candle) => [candle.time, candle]));
  const signal = Array.from({ length: 5 }, (_, offset) => byTime.get(time(spec.date, spec.signalStartMinute + offset)));
  if (signal.some((candle) => !candle)) return { ...spec, status: 'missing_signal' };
  const first = signal[0]!;
  const last = signal[4]!;
  const signalReturn = last.close / first.open - 1;
  if (signalReturn === 0) return { ...spec, status: 'no_signal', signalReturn, signalTime: last.time };
  const side: SiSide = signalReturn > 0 ? 'long' : 'short';
  const entryMinute = spec.signalStartMinute + 5;
  const entryCandle = byTime.get(time(spec.date, entryMinute));
  if (!entryCandle) return { ...spec, status: 'cancelled_entry', signalReturn, signalTime: last.time, side };
  const entry = entryCandle.open;
  const stop = side === 'long' ? entry * 0.992 : entry * 1.008;
  const target = side === 'long' ? entry * 1.015 : entry * 0.985;
  let exit: number | undefined;
  let exitReason: BrEiaDecision['exitReason'];
  for (let minute = entryMinute; minute < entryMinute + 60; minute += 1) {
    const candle = byTime.get(time(spec.date, minute));
    if (!candle) return { ...spec, status: 'unresolved', signalReturn, signalTime: last.time, side, entry, stop, target };
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
    const timeExit = byTime.get(time(spec.date, entryMinute + 60));
    if (!timeExit) return { ...spec, status: 'unresolved', signalReturn, signalTime: last.time, side, entry, stop, target };
    exit = timeExit.open;
    exitReason = 'time';
  }
  if (!exitReason) throw new Error('Completed EIA event trade has no exit reason');
  return {
    ...spec, status: 'trade', signalReturn, signalTime: last.time, side, entry, stop, target, exit, exitReason,
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
  };
}

export function summarizeBrEiaEvents(decisions: readonly BrEiaDecision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const base = trades.map((trade) => trade.baseNet!);
  const sum = base.reduce((total, value) => total + value, 0);
  const gains = base.filter((value) => value > 0).reduce((total, value) => total + value, 0);
  const losses = -base.filter((value) => value < 0).reduce((total, value) => total + value, 0);
  const statuses = ['missing_signal', 'no_signal', 'cancelled_entry', 'unresolved', 'trade'] as const;
  return {
    events: decisions.length,
    statuses: Object.fromEntries(statuses.map((status) => [status, decisions.filter((decision) => decision.status === status).length])),
    trades: trades.length,
    tradeDates: new Set(trades.map((trade) => trade.date)).size,
    winners: base.filter((value) => value > 0).length,
    winRate: trades.length ? base.filter((value) => value > 0).length / trades.length : null,
    meanGross: trades.length ? trades.reduce((total, trade) => total + trade.gross!, 0) / trades.length : null,
    meanBaseNet: trades.length ? sum / trades.length : null,
    meanStressNet: trades.length ? trades.reduce((total, trade) => total + trade.stressNet!, 0) / trades.length : null,
    sumBaseNet: sum,
    profitFactor: losses ? gains / losses : null,
    withoutBestTradeSum: base.length ? sum - Math.max(...base) : null,
    exits: Object.fromEntries((['stop', 'target', 'time'] as const).map((reason) =>
      [reason, trades.filter((trade) => trade.exitReason === reason).length])),
  };
}

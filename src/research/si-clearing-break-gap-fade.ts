import { SI_BASE_COSTS, SI_STRESS_COSTS, siTradeReturn, validateSiDayCandles, type SiCandle, type SiSide } from './si-first-hour.js';

export type ClearingGapDaySpec = { date: string; contract: string };

export type ClearingGapDecision = {
  date: string;
  contract: string;
  status: 'special_session' | 'no_session' | 'missing_signal' | 'cash' | 'cancelled_entry' | 'unresolved_holding' | 'trade';
  gapReturn?: number;
  side?: SiSide;
  entry?: number;
  exit?: number;
  exitReason?: 'stop' | 'target' | 'time';
  gross?: number;
  baseNet?: number;
  stressNet?: number;
};

const priceKey = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export function evaluateSiClearingBreakGapFade(spec: ClearingGapDaySpec, candles: readonly SiCandle[]): ClearingGapDecision {
  validateSiDayCandles(candles, spec.date);
  const byTime = new Map(candles.map((candle) => [candle.time.slice(11, 16), candle]));
  const prior = byTime.get('13:59');
  const reopen = byTime.get('14:05');
  if (!prior || !reopen) return { ...spec, status: 'missing_signal' };
  const gapReturn = reopen.open / prior.close - 1;
  const side: SiSide | null = gapReturn > 0 ? 'short' : gapReturn < 0 ? 'long' : null;
  if (!side) return { ...spec, status: 'cash', gapReturn };
  const entryCandle = byTime.get('14:06');
  if (!entryCandle) return { ...spec, status: 'cancelled_entry', gapReturn, side };
  const entry = entryCandle.open;
  const stop = side === 'long' ? entry * 0.995 : entry * 1.005;
  const target = side === 'long' ? entry * 1.015 : entry * 0.985;
  let exit: number | undefined;
  let exitReason: ClearingGapDecision['exitReason'];
  for (let minute = 14 * 60 + 6; minute <= 16 * 60 + 54; minute += 1) {
    const candle = byTime.get(priceKey(minute));
    if (!candle) return { ...spec, status: 'unresolved_holding', gapReturn, side, entry };
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
    const timeExit = byTime.get('16:55');
    if (!timeExit) return { ...spec, status: 'unresolved_holding', gapReturn, side, entry };
    exit = timeExit.open;
    exitReason = 'time';
  }
  if (!exitReason) throw new Error('A completed trade must have an exit reason');
  return { ...spec, status: 'trade', gapReturn, side, entry, exit, exitReason,
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS) };
}

export function summarizeSiClearingGap(decisions: readonly ClearingGapDecision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const nets = trades.map((trade) => trade.baseNet!);
  const gains = nets.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = -nets.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
  const sum = nets.reduce((total, value) => total + value, 0);
  return {
    dates: decisions.length,
    excludedSpecialSessions: decisions.filter((decision) => decision.status === 'special_session').length,
    statuses: Object.fromEntries(['special_session', 'no_session', 'missing_signal', 'cash', 'cancelled_entry', 'unresolved_holding', 'trade']
      .map((status) => [status, decisions.filter((decision) => decision.status === status).length])),
    trades: trades.length,
    winners: nets.filter((value) => value > 0).length,
    winRate: trades.length ? nets.filter((value) => value > 0).length / trades.length : null,
    meanGross: trades.length ? trades.reduce((total, trade) => total + trade.gross!, 0) / trades.length : null,
    meanBaseNet: trades.length ? sum / trades.length : null,
    meanStressNet: trades.length ? trades.reduce((total, trade) => total + trade.stressNet!, 0) / trades.length : null,
    sumBaseNet: sum,
    profitFactor: losses > 0 ? gains / losses : null,
    withoutBestTradeSum: nets.length ? sum - Math.max(...nets) : null,
    exits: Object.fromEntries(['stop', 'target', 'time'].map((reason) =>
      [reason, trades.filter((trade) => trade.exitReason === reason).length])),
  };
}

import {
  SI_BASE_COSTS,
  SI_STRESS_COSTS,
  siTradeReturn,
  validateSiDayCandles,
  type SiCandle,
  type SiSide,
} from './si-first-hour.js';

export type BrOvernightGapDecision = {
  date: string;
  contract: string;
  status: 'no_session' | 'missing_gap_reference' | 'cash' | 'cancelled_entry' | 'unresolved_exit' | 'trade';
  gapReturn?: number;
  side?: SiSide;
  entry?: number;
  exit?: number;
  exitReason?: 'stop' | 'target' | 'time';
  gross?: number;
  baseNet?: number;
  stressNet?: number;
};

function at(candles: ReadonlyMap<string, SiCandle>, date: string, minute: number): SiCandle | undefined {
  return candles.get(`${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`);
}

export function evaluateBrOvernightGap(
  date: string,
  contract: string,
  previousClose16_59: number | undefined,
  candles: readonly SiCandle[],
  direction: 'continuation' | 'fade' = 'continuation',
): BrOvernightGapDecision {
  validateSiDayCandles(candles, date);
  if (!Number.isFinite(previousClose16_59) || previousClose16_59! <= 0) {
    return { date, contract, status: 'missing_gap_reference' };
  }
  const minuteMap = new Map(candles.map((candle) => [candle.time, candle]));
  const first = at(minuteMap, date, 600);
  if (!first) return { date, contract, status: 'missing_gap_reference' };
  const gapReturn = first.open / previousClose16_59! - 1;
  if (Math.abs(gapReturn) < 0.0025) return { date, contract, status: 'cash', gapReturn };

  const followsGap = (gapReturn > 0) === (direction === 'continuation');
  const side: SiSide = followsGap ? 'long' : 'short';
  const entryCandle = at(minuteMap, date, 601);
  if (!entryCandle) return { date, contract, status: 'cancelled_entry', gapReturn, side };
  const entry = entryCandle.open;
  const stop = side === 'long' ? entry * 0.993 : entry * 1.007;
  const target = side === 'long' ? entry * 1.01 : entry * 0.99;

  for (let minute = 601; minute < 1015; minute += 1) {
    if (minute >= 840 && minute <= 844) continue;
    const holding = at(minuteMap, date, minute);
    if (!holding) return { date, contract, status: 'unresolved_exit', gapReturn, side, entry };
    const stopHit = side === 'long' ? holding.low <= stop : holding.high >= stop;
    const targetHit = side === 'long' ? holding.high >= target : holding.low <= target;
    if (!stopHit && !targetHit) continue;
    const exit = stopHit
      ? side === 'long' ? Math.min(stop, holding.open) : Math.max(stop, holding.open)
      : target;
    return {
      date, contract, status: 'trade', gapReturn, side, entry, exit,
      exitReason: stopHit ? 'stop' : 'target',
      gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
      baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
      stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
    };
  }

  const timeExit = at(minuteMap, date, 1015);
  if (!timeExit) return { date, contract, status: 'unresolved_exit', gapReturn, side, entry };
  const exit = timeExit.open;
  return {
    date, contract, status: 'trade', gapReturn, side, entry, exit, exitReason: 'time',
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
  };
}

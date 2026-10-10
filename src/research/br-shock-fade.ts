import {
  SI_BASE_COSTS,
  SI_STRESS_COSTS,
  siTradeReturn,
  validateSiDayCandles,
  type SiCandle,
  type SiSide,
} from './si-first-hour.js';

export type BrShockFadeDecision = {
  date: string;
  contract: string;
  status: 'no_session' | 'no_candles' | 'signal_data_gap' | 'cash' | 'cancelled_entry' | 'unresolved_exit' | 'trade';
  shockReturn?: number;
  signalTime?: string;
  side?: SiSide;
  entry?: number;
  exit?: number;
  exitReason?: 'stop' | 'target' | 'time';
  gross?: number;
  baseNet?: number;
  stressNet?: number;
};

const minuteTime = (date: string, minute: number) =>
  `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;

export function evaluateBrShockFade(
  date: string,
  contract: string,
  candles: readonly SiCandle[],
): BrShockFadeDecision {
  validateSiDayCandles(candles, date);
  if (candles.length === 0) return { date, contract, status: 'no_candles' };

  const byMinute = new Map(candles.map((candle) => [candle.time, candle]));
  // Require full signal discovery coverage from 10:00 through 12:59.
  for (let minute = 600; minute < 780; minute += 1) {
    if (!byMinute.has(minuteTime(date, minute))) return { date, contract, status: 'signal_data_gap' };
  }

  for (let start = 600; start <= 775; start += 5) {
    const first = byMinute.get(minuteTime(date, start))!;
    const impulseEnd = byMinute.get(minuteTime(date, start + 4))!;
    const shockReturn = impulseEnd.close / first.open - 1;
    if (Math.abs(shockReturn) < 0.004) continue;

    const side: SiSide = shockReturn > 0 ? 'short' : 'long';
    const entryMinute = start + 5;
    const entryCandle = byMinute.get(minuteTime(date, entryMinute));
    if (!entryCandle) return { date, contract, status: 'cancelled_entry', shockReturn, side };
    const entry = entryCandle.open;
    const stop = side === 'long' ? entry * 0.997 : entry * 1.003;
    const target = side === 'long' ? entry * 1.006 : entry * 0.994;

    for (let minute = entryMinute; minute < entryMinute + 30; minute += 1) {
      const holding = byMinute.get(minuteTime(date, minute));
      if (!holding) return { date, contract, status: 'unresolved_exit', shockReturn, signalTime: minuteTime(date, start + 4), side, entry };
      const stopHit = side === 'long' ? holding.low <= stop : holding.high >= stop;
      const targetHit = side === 'long' ? holding.high >= target : holding.low <= target;
      if (!stopHit && !targetHit) continue;
      const exit = stopHit
        ? side === 'long' ? Math.min(stop, holding.open) : Math.max(stop, holding.open)
        : target;
      return {
        date, contract, status: 'trade', shockReturn, signalTime: minuteTime(date, start + 4), side,
        entry, exit, exitReason: stopHit ? 'stop' : 'target',
        gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
        baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
        stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
      };
    }

    const timeExit = byMinute.get(minuteTime(date, entryMinute + 30));
    if (!timeExit) return { date, contract, status: 'unresolved_exit', shockReturn, signalTime: minuteTime(date, start + 4), side, entry };
    const exit = timeExit.open;
    return {
      date, contract, status: 'trade', shockReturn, signalTime: minuteTime(date, start + 4), side,
      entry, exit, exitReason: 'time',
      gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
      baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
      stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
    };
  }
  return { date, contract, status: 'cash' };
}

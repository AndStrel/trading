import {
  SI_BASE_COSTS,
  SI_STRESS_COSTS,
  siTradeReturn,
  validateSiDayCandles,
  type SiCandle,
  type SiSide,
} from './si-first-hour.js';

export type OpeningBreakoutDecision = {
  date: string;
  contract: string;
  status: 'no_session' | 'no_candles' | 'missing_opening' | 'cash' | 'ambiguous_signal' | 'cancelled_entry' | 'unresolved_holding' | 'trade';
  range?: number;
  side?: SiSide;
  signalTime?: string;
  entry?: number;
  exit?: number;
  exitReason?: 'stop' | 'target' | 'time';
  baseNet?: number;
  stressNet?: number;
};

function time(date: string, minuteOfDay: number): string {
  return `${date} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}:00`;
}

function byMinute(candles: readonly SiCandle[]): Map<string, SiCandle> {
  return new Map(candles.map((candle) => [candle.time, candle]));
}

export function evaluateSiOpeningBreakout(
  date: string,
  contract: string,
  candles: readonly SiCandle[],
): OpeningBreakoutDecision {
  validateSiDayCandles(candles, date);
  if (candles.length === 0) return { date, contract, status: 'no_candles' };
  const minutes = byMinute(candles);
  const opening: SiCandle[] = [];
  for (let minute = 600; minute < 660; minute += 1) {
    const candle = minutes.get(time(date, minute));
    if (!candle) return { date, contract, status: 'missing_opening' };
    opening.push(candle);
  }
  const openingHigh = Math.max(...opening.map((candle) => candle.high));
  const openingLow = Math.min(...opening.map((candle) => candle.low));
  const range = (openingHigh - openingLow) / opening[0]!.open;
  if (range > 0.006) return { date, contract, status: 'cash', range };
  for (let minute = 660; minute <= 839; minute += 1) {
    const candle = minutes.get(time(date, minute));
    if (!candle) return { date, contract, status: 'unresolved_holding', range };
    const long = candle.close >= openingHigh * 1.0005;
    const short = candle.close <= openingLow * 0.9995;
    if (long && short) return { date, contract, status: 'ambiguous_signal', range };
    if (!long && !short) continue;
    const side: SiSide = long ? 'long' : 'short';
    const signalTime = candle.time;
    const entry = minutes.get(time(date, minute + 1))?.open;
    if (entry === undefined) return { date, contract, status: 'cancelled_entry', range, side, signalTime };
    const stop = side === 'long' ? entry * 0.993 : entry * 1.007;
    const target = side === 'long' ? entry * 1.01 : entry * 0.99;
    for (let holdingMinute = minute + 1; holdingMinute < 1015; holdingMinute += 1) {
      // MOEX futures interim clearing: no trading or candles at 14:00–14:04.
      if (holdingMinute >= 840 && holdingMinute <= 844) continue;
      const holding = minutes.get(time(date, holdingMinute));
      if (!holding) return { date, contract, status: 'unresolved_holding', range, side, signalTime, entry };
      const stopHit = side === 'long' ? holding.low <= stop : holding.high >= stop;
      const targetHit = side === 'long' ? holding.high >= target : holding.low <= target;
      if (stopHit || targetHit) {
        const exit = stopHit
          ? side === 'long' ? Math.min(stop, holding.open) : Math.max(stop, holding.open)
          : target;
        return {
          date, contract, status: 'trade', range, side, signalTime, entry, exit,
          exitReason: stopHit ? 'stop' : 'target',
          baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
          stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
        };
      }
    }
    const exit = minutes.get(time(date, 1015))?.open;
    if (exit === undefined) return { date, contract, status: 'unresolved_holding', range, side, signalTime, entry };
    return {
      date, contract, status: 'trade', range, side, signalTime, entry, exit, exitReason: 'time',
      baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
      stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
    };
  }
  return { date, contract, status: 'cash', range };
}

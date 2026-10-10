import {
  SI_BASE_COSTS,
  SI_STRESS_COSTS,
  siTradeReturn,
  validateSiDayCandles,
  type SiCandle,
  type SiSide,
} from './si-first-hour.js';

export type BrFirstHourDecision = {
  date: string;
  contract: string;
  status: 'special_session' | 'no_candles' | 'missing_opening' | 'cash' | 'cancelled_entry' | 'unresolved_holding' | 'trade';
  firstHourReturn?: number;
  side?: SiSide;
  entry?: number;
  exit?: number;
  exitReason?: 'stop' | 'target' | 'time';
  gross?: number;
  baseNet?: number;
  stressNet?: number;
};

function at(date: string, minute: number): string {
  return `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
}

export function evaluateBrFirstHour(date: string, contract: string, candles: readonly SiCandle[]): BrFirstHourDecision {
  validateSiDayCandles(candles, date);
  if (candles.length === 0) return { date, contract, status: 'no_candles' };
  const minutes = new Map(candles.map((candle) => [candle.time, candle]));
  const opening: SiCandle[] = [];
  for (let minute = 600; minute < 660; minute += 1) {
    const candle = minutes.get(at(date, minute));
    if (!candle) return { date, contract, status: 'missing_opening' };
    opening.push(candle);
  }
  const firstHourReturn = opening[59]!.close / opening[0]!.open - 1;
  if (firstHourReturn === 0) return { date, contract, status: 'cash', firstHourReturn };
  const side: SiSide = firstHourReturn > 0 ? 'long' : 'short';
  const entry = minutes.get(at(date, 661))?.open;
  if (entry === undefined) return { date, contract, status: 'cancelled_entry', firstHourReturn, side };
  const stop = side === 'long' ? entry * 0.992 : entry * 1.008;
  const target = side === 'long' ? entry * 1.015 : entry * 0.985;
  for (let minute = 661; minute < 1015; minute += 1) {
    const candle = minutes.get(at(date, minute));
    if (!candle) return { date, contract, status: 'unresolved_holding', firstHourReturn, side, entry };
    const stopHit = side === 'long' ? candle.low <= stop : candle.high >= stop;
    const targetHit = side === 'long' ? candle.high >= target : candle.low <= target;
    if (stopHit || targetHit) {
      const exit = stopHit
        ? side === 'long' ? Math.min(stop, candle.open) : Math.max(stop, candle.open)
        : target;
      return {
        date, contract, status: 'trade', firstHourReturn, side, entry, exit,
        exitReason: stopHit ? 'stop' : 'target',
        gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
        baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
        stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
      };
    }
  }
  const exit = minutes.get(at(date, 1015))?.open;
  if (exit === undefined) return { date, contract, status: 'unresolved_holding', firstHourReturn, side, entry };
  return {
    date, contract, status: 'trade', firstHourReturn, side, entry, exit, exitReason: 'time',
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
  };
}

import {
  SI_BASE_COSTS,
  SI_STRESS_COSTS,
  siTradeReturn,
  validateSiDayCandles,
  type SiCandle,
  type SiSide,
} from './si-first-hour.js';

export type SiFromBrentDecision = {
  date: string;
  siContract: string;
  brContract: string;
  status: 'special_session' | 'missing_br_history' | 'cash' | 'cancelled_entry' | 'unresolved_holding' | 'trade';
  brFirstHourReturn?: number;
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

export function evaluateSiFromBrentLead(
  date: string,
  siContract: string,
  brContract: string,
  brCandles: readonly SiCandle[],
  siCandles: readonly SiCandle[],
): SiFromBrentDecision {
  validateSiDayCandles(brCandles, date);
  validateSiDayCandles(siCandles, date);
  const brMinutes = new Map(brCandles.map((candle) => [candle.time, candle]));
  const siMinutes = new Map(siCandles.map((candle) => [candle.time, candle]));
  const opening: SiCandle[] = [];
  for (let minute = 600; minute < 660; minute += 1) {
    const candle = brMinutes.get(at(date, minute));
    if (!candle) return { date, siContract, brContract, status: 'missing_br_history' };
    opening.push(candle);
  }
  const brFirstHourReturn = opening[59]!.close / opening[0]!.open - 1;
  if (brFirstHourReturn === 0) return { date, siContract, brContract, status: 'cash', brFirstHourReturn };
  const side: SiSide = brFirstHourReturn > 0 ? 'short' : 'long';
  const entry = siMinutes.get(at(date, 661))?.open;
  if (entry === undefined) return { date, siContract, brContract, status: 'cancelled_entry', brFirstHourReturn, side };
  const stop = side === 'long' ? entry * 0.995 : entry * 1.005;
  const target = side === 'long' ? entry * 1.01 : entry * 0.99;
  for (let minute = 661; minute < 1015; minute += 1) {
    const candle = siMinutes.get(at(date, minute));
    if (!candle) return { date, siContract, brContract, status: 'unresolved_holding', brFirstHourReturn, side, entry };
    const stopHit = side === 'long' ? candle.low <= stop : candle.high >= stop;
    const targetHit = side === 'long' ? candle.high >= target : candle.low <= target;
    if (stopHit || targetHit) {
      const exit = stopHit
        ? side === 'long' ? Math.min(stop, candle.open) : Math.max(stop, candle.open)
        : target;
      return {
        date, siContract, brContract, status: 'trade', brFirstHourReturn, side, entry, exit,
        exitReason: stopHit ? 'stop' : 'target',
        gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
        baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
        stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
      };
    }
  }
  const exit = siMinutes.get(at(date, 1015))?.open;
  if (exit === undefined) return { date, siContract, brContract, status: 'unresolved_holding', brFirstHourReturn, side, entry };
  return {
    date, siContract, brContract, status: 'trade', brFirstHourReturn, side, entry, exit, exitReason: 'time',
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
  };
}

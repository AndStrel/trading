import { SI_BASE_COSTS, SI_STRESS_COSTS, siTradeReturn, validateSiDayCandles,
  type SiCandle, type SiContract, type SiSide } from './si-first-hour.js';

export type SiHalfHourDecision = {
  date: string; contract: SiContract;
  status: 'no_candles' | 'missing_history' | 'cash' | 'cancelled_entry' | 'unresolved_exit' | 'trade';
  side?: SiSide; signalReturn?: number; entry?: number; exit?: number;
  gross?: number; baseNet?: number; stressNet?: number;
};

export function evaluateSiHalfHourDay(date: string, contract: SiContract, candles: readonly SiCandle[]): SiHalfHourDecision {
  validateSiDayCandles(candles, date);
  if (!candles.length) return { date, contract, status: 'no_candles' };
  const firstHalfHour = candles.filter((candle) => candle.time.slice(11, 16) >= '10:00' && candle.time.slice(11, 16) <= '10:29');
  if (firstHalfHour.length !== 30 || firstHalfHour[0]?.time !== `${date} 10:00:00` ||
      firstHalfHour[29]?.time !== `${date} 10:29:00`) return { date, contract, status: 'missing_history' };
  const signalReturn = firstHalfHour[29]!.close / firstHalfHour[0]!.open - 1;
  const side = signalReturn > 0 ? 'long' : signalReturn < 0 ? 'short' : null;
  if (!side) return { date, contract, status: 'cash', signalReturn };
  const entry = candles.find((candle) => candle.time === `${date} 10:31:00`)?.open;
  if (entry === undefined) return { date, contract, status: 'cancelled_entry', signalReturn, side };
  const exit = candles.find((candle) => candle.time === `${date} 17:00:00`)?.open;
  if (exit === undefined) return { date, contract, status: 'unresolved_exit', signalReturn, side, entry };
  return { date, contract, status: 'trade', signalReturn, side, entry, exit,
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS) };
}

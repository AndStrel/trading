import { SI_BASE_COSTS, SI_STRESS_COSTS, siTradeReturn, validateSiDayCandles,
  type SiCandle, type SiSide } from './si-first-hour.js';
import type { DaySpec } from '../research-si-2026-source.js';

export type SiUsSessionDecision = DaySpec & {
  status: 'missing_history' | 'cash' | 'cancelled_entry' | 'unresolved_exit' | 'trade';
  side?: SiSide; signalReturn?: number; entry?: number; exit?: number;
  gross?: number; baseNet?: number; stressNet?: number;
};

export function evaluateSiUsSessionDay(spec: DaySpec,
  daytime: readonly SiCandle[], evening: readonly SiCandle[]): SiUsSessionDecision {
  validateSiDayCandles(daytime, spec.date);
  validateSiDayCandles(evening, spec.date);
  const signal = daytime.filter((candle) => candle.time.slice(11, 16) >= '16:30' && candle.time.slice(11, 16) <= '16:59');
  if (signal.length !== 30 || signal[0]?.time !== `${spec.date} 16:30:00` ||
      signal[29]?.time !== `${spec.date} 16:59:00`) return { ...spec, status: 'missing_history' };
  const signalReturn = signal[29]!.close / signal[0]!.open - 1;
  const side = signalReturn > 0 ? 'long' : signalReturn < 0 ? 'short' : null;
  if (!side) return { ...spec, status: 'cash', signalReturn };
  const entry = evening.find((candle) => candle.time === `${spec.date} 17:01:00`)?.open;
  if (entry === undefined) return { ...spec, status: 'cancelled_entry', signalReturn, side };
  const exit = evening.find((candle) => candle.time === `${spec.date} 22:00:00`)?.open;
  if (exit === undefined) return { ...spec, status: 'unresolved_exit', signalReturn, side, entry };
  return { ...spec, status: 'trade', signalReturn, side, entry, exit,
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS) };
}

export function summarizeSiUsSessionBound(decisions: readonly SiUsSessionDecision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const unresolved = decisions.filter((decision) => decision.status === 'unresolved_exit').length;
  const entered = trades.length + unresolved;
  const baseWins = trades.filter((trade) => trade.baseNet! > 0).length;
  const stressWins = trades.filter((trade) => trade.stressNet! > 0).length;
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return { decisions: decisions.length, entered, completed: trades.length, unresolved,
    missingHistory: decisions.filter((decision) => decision.status === 'missing_history').length,
    cash: decisions.filter((decision) => decision.status === 'cash').length,
    cancelledEntry: decisions.filter((decision) => decision.status === 'cancelled_entry').length,
    requiredWins: Math.ceil(entered * 0.51),
    grossWinsOnCompleted: trades.filter((trade) => trade.gross! > 0).length,
    baseWinsOnCompleted: baseWins, stressWinsOnCompleted: stressWins,
    baseUpperWins: baseWins + unresolved, stressUpperWins: stressWins + unresolved,
    baseUpperWinRate: entered ? (baseWins + unresolved) / entered : null,
    stressUpperWinRate: entered ? (stressWins + unresolved) / entered : null,
    completedOnlyMeanGross: mean(trades.map((trade) => trade.gross!)),
    completedOnlyMeanBaseNet: mean(trades.map((trade) => trade.baseNet!)),
    completedOnlyMeanStressNet: mean(trades.map((trade) => trade.stressNet!)) };
}

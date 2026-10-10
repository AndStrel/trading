import { SI_BASE_COSTS, SI_STRESS_COSTS, siTradeReturn, validateSiDayCandles, type SiCandle, type SiSide } from './si-first-hour.js';
import type { DaySpec } from '../research-si-2026-source.js';

export type OracleCeilingDay = { date: string; contract: DaySpec['contract']; status: 'missing' | 'cash' | 'complete';
  signalReturn?: number; continuation?: { side: SiSide; exit: number; baseNet: number; stressNet: number };
  reversal?: { side: SiSide; exit: number; baseNet: number; stressNet: number } };

export function siEntryOracleCeilingDay(spec: DaySpec, candles: readonly SiCandle[]): OracleCeilingDay {
  validateSiDayCandles(candles, spec.date);
  const byMinute = new Map(candles.map((candle) => [candle.time.slice(11, 16), candle]));
  for (let minute = 10 * 60; minute < 11 * 60; minute += 1) {
    const hhmm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    if (!byMinute.has(hhmm)) return { ...spec, status: 'missing' };
  }
  const signalReturn = byMinute.get('10:59')!.close / byMinute.get('10:00')!.open - 1;
  if (signalReturn === 0) return { ...spec, status: 'cash', signalReturn };
  const entry = byMinute.get('11:01')?.open;
  if (entry === undefined) return { ...spec, status: 'missing', signalReturn };
  const future: SiCandle[] = [];
  for (let minute = 11 * 60 + 2; minute <= 16 * 60 + 55; minute += 1) {
    const hhmm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const candle = byMinute.get(hhmm);
    if (!candle) return { ...spec, status: 'missing', signalReturn };
    future.push(candle);
  }
  const maxHigh = Math.max(...future.map((candle) => candle.high));
  const minLow = Math.min(...future.map((candle) => candle.low));
  const continuationSide: SiSide = signalReturn > 0 ? 'long' : 'short';
  const reversalSide: SiSide = continuationSide === 'long' ? 'short' : 'long';
  const oracle = (side: SiSide) => {
    const exit = side === 'long' ? maxHigh : minLow;
    return { side, exit, baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
      stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS) };
  };
  return { ...spec, status: 'complete', signalReturn,
    continuation: oracle(continuationSide), reversal: oracle(reversalSide) };
}

export function summarizeSiOracleCeiling(days: readonly OracleCeilingDay[], direction: 'continuation' | 'reversal') {
  const complete = days.filter((day) => day.status === 'complete');
  const rows = complete.map((day) => day[direction]!);
  return { dates: days.length, missing: days.filter((day) => day.status === 'missing').length,
    cash: days.filter((day) => day.status === 'cash').length,
    complete: complete.length, baseWins: rows.filter((row) => row.baseNet > 0).length,
    stressWins: rows.filter((row) => row.stressNet > 0).length,
    baseWinRate: rows.length ? rows.filter((row) => row.baseNet > 0).length / rows.length : null,
    meanOracleBase: rows.length ? rows.reduce((sum, row) => sum + row.baseNet, 0) / rows.length : null };
}

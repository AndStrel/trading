import { SI_BASE_COSTS, SI_STRESS_COSTS, siTradeReturn, validateSiDayCandles, type SiCandle, type SiSide } from './si-first-hour.js';
import type { DaySpec } from '../research-si-2026-source.js';

export type ReversalDecision = {
  date: string;
  contract: DaySpec['contract'];
  status: 'missing_signal' | 'cash' | 'cancelled_entry' | 'unresolved_exit' | 'missing_holding' | 'trade';
  signalReturn?: number;
  side?: SiSide;
  entry?: number;
  exit?: number;
  gross?: number;
  baseNet?: number;
  stressNet?: number;
};

export function evaluateSiReversalDay(spec: DaySpec, candles: readonly SiCandle[]): ReversalDecision {
  validateSiDayCandles(candles, spec.date);
  const byTime = new Map(candles.map((candle) => [candle.time.slice(11, 16), candle]));
  for (let minute = 10 * 60; minute < 11 * 60; minute += 1) {
    const key = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    if (!byTime.has(key)) return { ...spec, status: 'missing_signal' };
  }
  const signalReturn = byTime.get('10:59')!.close / byTime.get('10:00')!.open - 1;
  const side: SiSide | null = signalReturn > 0 ? 'short' : signalReturn < 0 ? 'long' : null;
  if (!side) return { ...spec, status: 'cash', signalReturn };
  const entry = byTime.get('11:01')?.open;
  if (entry === undefined) return { ...spec, status: 'cancelled_entry', signalReturn, side };
  const exit = byTime.get('16:55')?.open;
  if (exit === undefined) return { ...spec, status: 'unresolved_exit', signalReturn, side, entry };
  for (let minute = 11 * 60 + 1; minute <= 16 * 60 + 55; minute += 1) {
    const key = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    if (!byTime.has(key)) return { ...spec, status: 'missing_holding', signalReturn, side, entry, exit };
  }
  return { ...spec, status: 'trade', signalReturn, side, entry, exit,
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS) };
}

export function summarizeSiReversal(decisions: readonly ReversalDecision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const nets = trades.map((trade) => trade.baseNet!);
  const gains = nets.filter((net) => net > 0).reduce((sum, net) => sum + net, 0);
  const losses = -nets.filter((net) => net < 0).reduce((sum, net) => sum + net, 0);
  const sum = nets.reduce((total, net) => total + net, 0);
  return { dates: decisions.length,
    statuses: Object.fromEntries(['missing_signal', 'cash', 'cancelled_entry', 'unresolved_exit', 'missing_holding', 'trade']
      .map((status) => [status, decisions.filter((decision) => decision.status === status).length])),
    trades: trades.length, wins: nets.filter((net) => net > 0).length,
    winRate: trades.length ? nets.filter((net) => net > 0).length / trades.length : null,
    meanGross: trades.length ? trades.reduce((total, trade) => total + trade.gross!, 0) / trades.length : null,
    meanBase: trades.length ? sum / trades.length : null,
    meanStress: trades.length ? trades.reduce((total, trade) => total + trade.stressNet!, 0) / trades.length : null,
    sumBase: sum, profitFactor: losses > 0 ? gains / losses : null,
    withoutBestDateSum: nets.length ? sum - Math.max(...nets) : null };
}

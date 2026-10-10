import { SI_BASE_COSTS, SI_STRESS_COSTS, siTradeReturn, validateSiDayCandles, type SiCandle, type SiSide } from './si-first-hour.js';

export type BrReversalDecision = {
  date: string; contract: string;
  status: 'special_session' | 'no_session' | 'missing_opening' | 'cash' | 'cancelled_entry' | 'unresolved_holding' | 'trade';
  signalReturn?: number; side?: SiSide; entry?: number; exit?: number;
  exitReason?: 'stop' | 'time'; gross?: number; baseNet?: number; stressNet?: number;
};

const noSessionDates = new Set(['2024-02-23', '2024-03-08', '2024-05-01', '2024-05-09', '2024-06-12', '2025-05-01', '2025-05-09', '2025-06-12']);
const at = (date: string, minute: number) => `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;

export function evaluateBrFirstHourReversal(date: string, contract: string, candles: readonly SiCandle[]): BrReversalDecision {
  if (date === '2024-04-27') return { date, contract, status: 'special_session' };
  if (noSessionDates.has(date)) return { date, contract, status: 'no_session' };
  validateSiDayCandles(candles, date);
  const byTime = new Map(candles.map((c) => [c.time, c]));
  const opening: SiCandle[] = [];
  for (let minute = 600; minute < 660; minute += 1) {
    const candle = byTime.get(at(date, minute));
    if (!candle) return { date, contract, status: 'missing_opening' };
    opening.push(candle);
  }
  const signalReturn = opening[59]!.close / opening[0]!.open - 1;
  if (signalReturn === 0) return { date, contract, status: 'cash', signalReturn };
  const side: SiSide = signalReturn > 0 ? 'short' : 'long';
  const entry = byTime.get(at(date, 661))?.open;
  if (entry === undefined) return { date, contract, status: 'cancelled_entry', signalReturn, side };
  const stop = side === 'long' ? entry * 0.992 : entry * 1.008;
  for (let minute = 661; minute < 1015; minute += 1) {
    if (minute >= 840 && minute <= 844) continue;
    const candle = byTime.get(at(date, minute));
    if (!candle) return { date, contract, status: 'unresolved_holding', signalReturn, side, entry };
    const hit = side === 'long' ? candle.low <= stop : candle.high >= stop;
    if (hit) {
      const exit = side === 'long' ? Math.min(stop, candle.open) : Math.max(stop, candle.open);
      return { date, contract, status: 'trade', signalReturn, side, entry, exit, exitReason: 'stop',
        gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
        baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS), stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS) };
    }
  }
  const exit = byTime.get(at(date, 1015))?.open;
  if (exit === undefined) return { date, contract, status: 'unresolved_holding', signalReturn, side, entry };
  return { date, contract, status: 'trade', signalReturn, side, entry, exit, exitReason: 'time',
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS), stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS) };
}

export function summarizeBrFirstHourReversal(decisions: readonly BrReversalDecision[]) {
  const trades = decisions.filter((d) => d.status === 'trade');
  const base = trades.map((d) => d.baseNet!);
  const stress = trades.map((d) => d.stressNet!);
  const gains = base.filter((n) => n > 0).reduce((a, n) => a + n, 0);
  const losses = -base.filter((n) => n < 0).reduce((a, n) => a + n, 0);
  const sum = base.reduce((a, n) => a + n, 0);
  return {
    sessions: decisions.length,
    statuses: Object.fromEntries([...new Set(decisions.map((d) => d.status))].sort().map((status) => [status, decisions.filter((d) => d.status === status).length])),
    trades: trades.length, wins: base.filter((n) => n > 0).length,
    winRate: trades.length ? base.filter((n) => n > 0).length / trades.length : null,
    meanBase: trades.length ? sum / trades.length : null,
    meanStress: trades.length ? stress.reduce((a, n) => a + n, 0) / trades.length : null,
    sumBase: sum, profitFactor: losses > 0 ? gains / losses : null,
    withoutBestDateSum: base.length ? sum - Math.max(...base) : null,
    exits: Object.fromEntries(['stop', 'time'].map((reason) => [reason, trades.filter((d) => d.exitReason === reason).length])),
  };
}

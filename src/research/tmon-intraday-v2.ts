import type { SiCandle } from './si-first-hour.js';

export type TmonV2Decision = {
  date: string;
  status: 'inactive' | 'cancelled_entry' | 'unresolved_exit' | 'trade';
  entryTime?: string; exitTime?: string; entry?: number; exit?: number;
  gross?: number; baseNet?: number; stressNet?: number; severeNet?: number;
};
export type TmonV2Summary = {
  trades: number; baseWins: number; stressWins: number; severeWins: number;
  baseWinRate: number | null; stressWinRate: number | null;
  meanGross: number | null; meanBaseNet: number | null; meanStressNet: number | null; meanSevereNet: number | null;
  worstBaseNet: number | null; baseSum: number; stressSum: number;
  baseWithoutBestFiveSum: number | null; stressWithoutBestFiveSum: number | null;
  baseInterTradeMaxDrawdown: number | null;
};

const TICK = 0.000001;
const SLIPPAGE = { gross: 0, base: 0.00005, stress: 0.0001, severe: 0.0003 } as const;

function firstInWindow(candles: readonly SiCandle[], from: string, to: string): SiCandle | undefined {
  return candles.find((candle) => candle.time.slice(11, 16) >= from && candle.time.slice(11, 16) <= to);
}

export function tmonLongReturn(entry: number, exit: number, slippage: number, tick = TICK): number {
  if (![entry, exit, slippage, tick].every(Number.isFinite) || entry <= 0 || exit <= 0 || slippage < 0 || slippage >= 1 || tick <= 0) {
    throw new Error('Invalid TMON price or execution allowance');
  }
  const buyTicks = Math.ceil(entry * (1 + slippage) / tick - 1e-9);
  const sellTicks = Math.floor(exit * (1 - slippage) / tick + 1e-9);
  return sellTicks / buyTicks - 1;
}

export function evaluateTmonV2Day(date: string, candles: readonly SiCandle[]): TmonV2Decision {
  if (!candles.length) return { date, status: 'inactive' };
  const entry = firstInWindow(candles, '10:01', '10:03');
  if (!entry) return { date, status: 'cancelled_entry' };
  const exit = firstInWindow(candles, '16:00', '17:00');
  if (!exit) return { date, status: 'unresolved_exit', entryTime: entry.time, entry: entry.open };
  if (exit.time <= entry.time) throw new Error(`Invalid TMON holding interval ${date}`);
  return { date, status: 'trade', entryTime: entry.time, exitTime: exit.time, entry: entry.open, exit: exit.open,
    gross: tmonLongReturn(entry.open, exit.open, SLIPPAGE.gross),
    baseNet: tmonLongReturn(entry.open, exit.open, SLIPPAGE.base),
    stressNet: tmonLongReturn(entry.open, exit.open, SLIPPAGE.stress),
    severeNet: tmonLongReturn(entry.open, exit.open, SLIPPAGE.severe) };
}

export function summarizeTmonV2(decisions: readonly TmonV2Decision[]): TmonV2Summary {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const base = trades.map((trade) => trade.baseNet!);
  const stress = trades.map((trade) => trade.stressNet!);
  const severe = trades.map((trade) => trade.severeNet!);
  const withoutBestFiveSum = (values: number[]) => values.length < 6 ? null :
    [...values].sort((a, b) => b - a).slice(5).reduce((sum, value) => sum + value, 0);
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of base) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, 1 - equity / peak);
  }
  return { trades: trades.length,
    baseWins: base.filter((value) => value > 0).length,
    stressWins: stress.filter((value) => value > 0).length,
    severeWins: severe.filter((value) => value > 0).length,
    baseWinRate: trades.length ? base.filter((value) => value > 0).length / trades.length : null,
    stressWinRate: trades.length ? stress.filter((value) => value > 0).length / trades.length : null,
    meanGross: mean(trades.map((trade) => trade.gross!)), meanBaseNet: mean(base),
    meanStressNet: mean(stress), meanSevereNet: mean(severe),
    worstBaseNet: base.length ? Math.min(...base) : null,
    baseSum: base.reduce((sum, value) => sum + value, 0),
    stressSum: stress.reduce((sum, value) => sum + value, 0),
    baseWithoutBestFiveSum: withoutBestFiveSum(base),
    stressWithoutBestFiveSum: withoutBestFiveSum(stress),
    baseInterTradeMaxDrawdown: trades.length ? maxDrawdown : null };
}

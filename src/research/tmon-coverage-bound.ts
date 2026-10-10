import type { SiCandle } from './si-first-hour.js';

export type TmonBoundDay = { date: string; candles: readonly SiCandle[] };
export type TmonBound = {
  activeDays: number;
  cancelledEntries: number;
  enteredDays: number;
  completedDays: number;
  unresolvedExits: number;
  requiredWins: number;
  cases: Record<'gross' | 'base' | 'stress' | 'severe', {
    observedWins: number; optimisticWins: number; optimisticWinFraction: number; canReach51Percent: boolean;
  }>;
};

const TICK = 0.000001;
const SLIPPAGE = { gross: 0, base: 0.00005, stress: 0.0001, severe: 0.0003 } as const;

function firstInWindow(candles: readonly SiCandle[], from: string, to: string): SiCandle | undefined {
  return candles.find((candle) => candle.time.slice(11, 16) >= from && candle.time.slice(11, 16) <= to);
}

function netPositive(entry: number, exit: number, slippage: number): boolean {
  const buyTicks = Math.ceil(entry * (1 + slippage) / TICK);
  const sellTicks = Math.floor(exit * (1 - slippage) / TICK);
  return sellTicks > buyTicks;
}

export function tmonCoverageBound(days: readonly TmonBoundDay[]): TmonBound {
  let activeDays = 0;
  let cancelledEntries = 0;
  let enteredDays = 0;
  let completedDays = 0;
  let unresolvedExits = 0;
  const observedWins = { gross: 0, base: 0, stress: 0, severe: 0 };
  for (const { date, candles } of days) {
    if (!/^2025-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date ${date}`);
    if (candles.length === 0) continue;
    activeDays += 1;
    const entry = firstInWindow(candles, '10:01', '10:03');
    if (!entry) { cancelledEntries += 1; continue; }
    enteredDays += 1;
    const exit = firstInWindow(candles, '16:55', '17:00');
    if (!exit) { unresolvedExits += 1; continue; }
    completedDays += 1;
    for (const [name, slippage] of Object.entries(SLIPPAGE) as [keyof typeof SLIPPAGE, number][]) {
      if (netPositive(entry.open, exit.open, slippage)) observedWins[name] += 1;
    }
  }
  if (completedDays + unresolvedExits !== enteredDays || enteredDays + cancelledEntries !== activeDays) {
    throw new Error('TMON coverage partition is inconsistent');
  }
  const requiredWins = Math.ceil(enteredDays * 0.51);
  const cases = {} as TmonBound['cases'];
  for (const name of Object.keys(SLIPPAGE) as (keyof typeof SLIPPAGE)[]) {
    const optimisticWins = observedWins[name] + unresolvedExits;
    cases[name] = { observedWins: observedWins[name], optimisticWins,
      optimisticWinFraction: enteredDays === 0 ? 0 : optimisticWins / enteredDays,
      canReach51Percent: enteredDays > 0 && optimisticWins >= requiredWins };
  }
  return { activeDays, cancelledEntries, enteredDays, completedDays, unresolvedExits, requiredWins, cases };
}

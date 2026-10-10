import type { SiCandle } from './si-first-hour.js';

export type TrurBoundDay = { date: string; candles: readonly SiCandle[] };
export type TrurBound = {
  activeDays: number; cancelledEntries: number; enteredDays: number; completedDays: number;
  unresolvedExits: number; requiredWins: number;
  cases: Record<'gross' | 'base' | 'stress' | 'severe', {
    observedWins: number; lowerWinFraction: number; upperWinFraction: number; upperCanReach51Percent: boolean;
  }>;
};

const SLIPPAGE = { gross: 0, base: 0.0002, stress: 0.0005, severe: 0.001 } as const;

function firstInWindow(candles: readonly SiCandle[], from: string, to: string): SiCandle | undefined {
  return candles.find((candle) => candle.time.slice(11, 16) >= from && candle.time.slice(11, 16) <= to);
}

export function trurMissingExitBound(days: readonly TrurBoundDay[]): TrurBound {
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
      if (exit.open * (1 - slippage) > entry.open * (1 + slippage)) observedWins[name] += 1;
    }
  }
  if (completedDays + unresolvedExits !== enteredDays || enteredDays + cancelledEntries !== activeDays) {
    throw new Error('TRUR coverage partition is inconsistent');
  }
  const requiredWins = Math.ceil(enteredDays * 0.51);
  const cases = {} as TrurBound['cases'];
  for (const name of Object.keys(SLIPPAGE) as (keyof typeof SLIPPAGE)[]) {
    cases[name] = { observedWins: observedWins[name],
      lowerWinFraction: enteredDays ? observedWins[name] / enteredDays : 0,
      upperWinFraction: enteredDays ? (observedWins[name] + unresolvedExits) / enteredDays : 0,
      upperCanReach51Percent: enteredDays > 0 && observedWins[name] + unresolvedExits >= requiredWins };
  }
  return { activeDays, cancelledEntries, enteredDays, completedDays, unresolvedExits, requiredWins, cases };
}

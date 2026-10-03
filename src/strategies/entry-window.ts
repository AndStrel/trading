import { isTradingStrategyId, type TradingStrategyId } from './catalog.js';

const MOSCOW_OFFSET_MS = 3 * 60 * 60_000;
const ADMISSION_CUTOFF_MINUTES = 16 * 60 + 40;

export type StrategyEntryWindow = {
  referenceStartMs: number;
  entryStartMs: number;
  /** Exclusive deadline: confirmation does not extend a signal's entry window. */
  entryEndMs: number;
};

/** Strategy reference window, not exchange trading hours or permission to send orders. */
export function strategyEntryWindow(strategyId: TradingStrategyId, referenceStartMinutes: number, at: Date): StrategyEntryWindow | null {
  if (!isTradingStrategyId(strategyId) || !Number.isFinite(at.getTime()) || !Number.isInteger(referenceStartMinutes)
    || referenceStartMinutes < 0 || referenceStartMinutes >= ADMISSION_CUTOFF_MINUTES || referenceStartMinutes % 5 !== 0) return null;
  const shifted = new Date(at.getTime() + MOSCOW_OFFSET_MS);
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - MOSCOW_OFFSET_MS;
  const referenceStartMs = midnight + referenceStartMinutes * 60_000;
  const cutoff = midnight + ADMISSION_CUTOFF_MINUTES * 60_000;
  return {
    referenceStartMs,
    entryStartMs: strategyId === 'opening-range-breakout-v1' ? referenceStartMs + 30 * 60_000 : referenceStartMs,
    entryEndMs: strategyId === 'opening-range-breakout-v1' ? Math.min(cutoff, referenceStartMs + 150 * 60_000) : cutoff,
  };
}

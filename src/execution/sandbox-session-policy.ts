import { moscowLossDay } from './sandbox-loss-policy.js';
import type { SandboxOrderSnapshot } from './sandbox-order-state.js';
import type { SandboxStopObservation } from './sandbox-stop-state.js';
import type { SandboxTargetProof } from './sandbox-target-policy.js';

// Conservative pilot window, NOT an exchange calendar. Real trading status
// and fresh depth are still mandatory; holidays/auctions never become tradeable
// merely because the weekday or wall clock says so.
export const sandboxSessionWindow = { entryFrom: '10:05', entryUntil: '18:00', closeFrom: '18:30', timezone: 'Europe/Moscow' } as const;
function clock(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid sandbox session clock');
  const shifted = new Date(now.getTime() + 3 * 60 * 60_000);
  return { day: moscowLossDay(now), weekday: shifted.getUTCDay(), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}
export function sandboxSessionEntryAllowed(now: Date) {
  const c = clock(now); return c.weekday >= 1 && c.weekday <= 5 && c.minutes >= 605 && c.minutes < 1080;
}
export function sandboxSessionCloseDue(entryAt: string, now: Date) {
  const entry = new Date(entryAt); if (!Number.isFinite(entry.getTime()) || entry.getTime() > now.getTime()) throw new Error('Invalid sandbox entry session');
  const c = clock(now); return c.day > moscowLossDay(entry) || c.minutes >= 1110;
}
export type SandboxSessionExitIntent = {
  scenarioId: number; accountId: string; entryRequestId: string; instrumentId: string; lots: number;
  stopId: string; requestId: string; phase: 'cancel-claimed' | 'submitted' | 'restore-claimed' | 'restored'; createdAt: string;
  submitClaimedAt: string | null; limitNano: string | null; brokerOrderId: string | null;
  generation?: number; purpose?: 'session' | 'technical-acceptance' | 'target';
  targetProof?: SandboxTargetProof; targetConsumed?: boolean; restoreGeneration?: number;
  sellSnapshot?: SandboxOrderSnapshot; sellObservedAt?: string;
};
export type SandboxCloseKey = { scenarioId: number; requestId: string; generation: number };
export function sandboxCloseKey(intent: SandboxSessionExitIntent): SandboxCloseKey {
  const generation = intent.generation ?? 0;
  if (!Number.isSafeInteger(generation) || generation < 0 || generation > 1_000_000) throw new Error('Invalid close generation');
  return { scenarioId: intent.scenarioId, requestId: intent.requestId, generation };
}
export type SandboxProtectionRestoreProof = {
  accountId: string; instrumentId: string; lots: number; lotSize: number; positionUnits: string; checkedAt: string;
  noActiveOrders: true; noOtherActiveStops: true; stop: SandboxStopObservation;
};

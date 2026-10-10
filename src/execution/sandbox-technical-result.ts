import { formatNanoRub } from './sandbox-round-trip.js';

type Result = { complete: boolean; netPnlNano: string | null; cashProven?: boolean;
  cashReconciliation?: { status?: unknown } };

/** Safe CLI projection. Fills/flat alone must never make cash acceptance green. */
export function technicalCashAcceptanceReport(value: Result | undefined) {
  const status = value?.cashReconciliation?.status;
  const cashStatus = status === 'reconciled' || status === 'mismatch' || status === 'incomplete' ? status : null;
  const cashProven = value?.complete === true && value.cashProven === true && cashStatus === 'reconciled';
  let executionBasedNetRub: string | null = null;
  try { if (value?.netPnlNano !== null && value?.netPnlNano !== undefined) executionBasedNetRub = formatNanoRub(value.netPnlNano); }
  catch { /* Invalid display data is not reflected, and is not an admission gate. */ }
  return { result: cashProven ? 'sandbox-cash-confirmed' : 'sandbox-cash-incomplete',
    flatConfirmed: value?.complete === true, cashProven, cashStatus, executionBasedNetRub, realOrders: false };
}

/** Best-effort safety persistence must not replace the original safe failure. */
export function technicalAcceptanceFailure(stage: string, kill?: () => boolean) {
  const stages = new Set(['authorization', 'preflight-read-only', 'instrument', 'arm-read-only', 'price',
    'entry', 'stop', 'reconcile-read-only', 'close']);
  let localJournalKillConfirmed = false;
  try { localJournalKillConfirmed = kill?.() === true; } catch {}
  return { result: 'sandbox-test-unconfirmed', stage: stages.has(stage) ? stage : 'unknown',
    retryEntry: false, localJournalKillConfirmed, realOrders: false };
}

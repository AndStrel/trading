import type { JournalScenarioRecord } from '../journal/scenario-journal.js';
import { assertSandboxCashBaseline, type SandboxCashBaseline } from './sandbox-cash-reconciliation.js';
import { readPreparedSandbox } from './sandbox-prepared-account.js';
import { assertTechnicalScope } from './sandbox-technical-scope.js';

export const technicalCashAcceptanceVersion = '1' as const;

/** Explicit opt-in only. Legacy technical scenarios retain their old policy. */
export function isTechnicalCashAcceptance(scenario: JournalScenarioRecord, lots: number): boolean {
  try {
    assertTechnicalScope(scenario, lots);
    const snapshot = scenario.snapshot as { technicalCashAcceptance?: unknown } | null;
    const policy = snapshot?.technicalCashAcceptance;
    return policy !== null && typeof policy === 'object' && !Array.isArray(policy)
      && Object.keys(policy).length === 1
      && (policy as { version?: unknown }).version === technicalCashAcceptanceVersion;
  } catch { return false; }
}

/** A new protective write must belong to the original immutable BUY baseline. */
export function hasTechnicalCashRestorationBaseline(scenario: JournalScenarioRecord, lots: number,
  baseline: SandboxCashBaseline | null, expected: { accountId: string; entryRequestId: string }): boolean {
  try {
    if (!isTechnicalCashAcceptance(scenario, lots) || !baseline) return false;
    assertSandboxCashBaseline(baseline);
    const prepared = readPreparedSandbox(baseline.preparedRaw, baseline.accountId);
    return baseline.accountId === expected.accountId && prepared.accountId === expected.accountId
      && baseline.entryRequestId === expected.entryRequestId;
  } catch { return false; }
}

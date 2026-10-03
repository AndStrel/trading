import {
  assertSandboxCashOperationsWindow, assessSandboxCashOperations, sandboxCashTimestampNano,
  type SandboxCashOperationsOwnership, type SandboxCashOperationsWindow,
} from './sandbox-cash-operations.js';

/** Exact sandbox cash evidence only. This module never reads or writes an account.
 * Current ledger freshness, prepared identity and claim ownership are checked by
 * the journal/caller. The pre-BUY and final ledger revisions need not be equal.
 */
export type SandboxCashBaseline = {
  version: 1;
  accountId: string;
  entryRequestId: string;
  cashNano: string;
  observedFrom: string;
  observedAt: string;
  ledgerRevision: string;
  killGeneration: string;
  preparedRaw: string;
  selection?: { key: string; raw: string };
};

// This is the current observation epoch, not the original BUY epoch. Legitimate
// kills or selection changes after entry must not silently rewrite the baseline.
export type SandboxCashObservationEpoch = {
  killGeneration: string;
  preparedRaw: string;
  selection: { key: string; raw: string | null };
};

export type SandboxCashObservation = {
  version: 1;
  accountId: string;
  entryRequestId: string;
  cashNano: string;
  observedFrom: string;
  observedAt: string;
  ledgerRevision: string;
  epoch: SandboxCashObservationEpoch;
  flowEvidence?: SandboxCashOperationsWindow;
};

export type SandboxCashReconciliation = {
  cashProven: boolean;
  status: 'incomplete' | 'mismatch' | 'reconciled';
  reasons: string[];
  /** Actual account cash difference, not the residual against modeled cash. */
  deltaNano: string | null;
  /** Actual round-trip net after all archived attempt fees, supplied by caller. */
  expectedDeltaNano: string | null;
};

const invalidEvidence = 'Sandbox cash evidence is invalid';
const maxReadSpanMs = 30_000;
const unsignedNano = /^(0|[1-9]\d{0,39})$/;
const signedNano = /^(0|-?[1-9]\d{0,39})$/;
const baselineKeys = [
  'version', 'accountId', 'entryRequestId', 'cashNano', 'observedFrom', 'observedAt',
  'ledgerRevision', 'killGeneration', 'preparedRaw',
] as const;
const observationKeys = [
  'version', 'accountId', 'entryRequestId', 'cashNano', 'observedFrom', 'observedAt', 'ledgerRevision', 'epoch',
] as const;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(invalidEvidence);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  if (Object.getOwnPropertySymbols(value).length !== 0
    || required.some(key => !Object.hasOwn(value, key))
    || Object.getOwnPropertyNames(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new Error(invalidEvidence);
  }
}

function text(value: unknown, maxLength = 256): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(invalidEvidence);
}

function raw(value: unknown): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 16_384 || value.includes('\0')) {
    throw new Error(invalidEvidence);
  }
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error(invalidEvidence);
  }
  const at = Date.parse(value);
  if (!Number.isFinite(at) || new Date(at).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) {
    throw new Error(invalidEvidence);
  }
  return at;
}

function common(value: Record<string, unknown>): void {
  if (value.version !== 1 || typeof value.cashNano !== 'string' || !unsignedNano.test(value.cashNano)
    || typeof value.ledgerRevision !== 'string' || !unsignedNano.test(value.ledgerRevision)) throw new Error(invalidEvidence);
  text(value.accountId);
  text(value.entryRequestId);
  const from = timestamp(value.observedFrom), at = timestamp(value.observedAt);
  if (at < from || at - from > maxReadSpanMs) throw new Error(invalidEvidence);
}

export function assertSandboxCashBaseline(value: unknown): asserts value is SandboxCashBaseline {
  try {
    const item = object(value);
    keys(item, baselineKeys, ['selection']);
    common(item);
    text(item.killGeneration);
    raw(item.preparedRaw);
    if (item.selection !== undefined) {
      const selection = object(item.selection);
      keys(selection, ['key', 'raw']);
      text(selection.key);
      raw(selection.raw);
    }
  } catch { throw new Error(invalidEvidence); }
}

export function assertSandboxCashObservation(value: unknown): asserts value is SandboxCashObservation {
  try {
    const item = object(value);
    keys(item, observationKeys, ['flowEvidence']);
    common(item);
    const epoch = object(item.epoch);
    keys(epoch, ['killGeneration', 'preparedRaw', 'selection']);
    text(epoch.killGeneration);
    raw(epoch.preparedRaw);
    const selection = object(epoch.selection);
    keys(selection, ['key', 'raw']);
    text(selection.key);
    if (selection.raw !== null) raw(selection.raw);
    if (item.flowEvidence !== undefined) {
      assertSandboxCashOperationsWindow(item.flowEvidence);
    }
  } catch { throw new Error(invalidEvidence); }
}

export function analyzeSandboxCashReconciliation(input: {
  baseline: SandboxCashBaseline | null;
  observation: SandboxCashObservation | null;
  expectedNetNano: string | null;
  closedAt: string | null;
  flatConfirmedAt: string | null;
  ownership?: SandboxCashOperationsOwnership;
}): SandboxCashReconciliation {
  const reasons: string[] = [];
  let baseline: SandboxCashBaseline | null = null, observation: SandboxCashObservation | null = null;
  if (input.baseline === null) reasons.push('cash-baseline-missing');
  else {
    try { assertSandboxCashBaseline(input.baseline); baseline = input.baseline; }
    catch { reasons.push('cash-baseline-invalid'); }
  }
  if (input.observation === null) reasons.push('cash-observation-missing');
  else {
    try { assertSandboxCashObservation(input.observation); observation = input.observation; }
    catch { reasons.push('cash-observation-invalid'); }
  }
  const expectedDeltaNano = typeof input.expectedNetNano === 'string' && signedNano.test(input.expectedNetNano)
    ? input.expectedNetNano : null;
  if (expectedDeltaNano === null) reasons.push('cash-net-unconfirmed');
  let closedAt: bigint | null = null, flatAt: number | null = null;
  try {
    if (typeof input.closedAt !== 'string') throw new Error(invalidEvidence);
    closedAt = sandboxCashTimestampNano(input.closedAt);
  } catch { reasons.push('cash-close-unconfirmed'); }
  try { flatAt = timestamp(input.flatConfirmedAt); } catch { reasons.push('cash-flat-unconfirmed'); }
  let deltaNano: string | null = null;
  if (baseline && observation) {
    if (baseline.accountId !== observation.accountId || baseline.entryRequestId !== observation.entryRequestId) {
      reasons.push('cash-identity-mismatch');
    } else {
      deltaNano = String(BigInt(observation.cashNano) - BigInt(baseline.cashNano));
      if (closedAt !== null && flatAt !== null && (sandboxCashTimestampNano(baseline.observedAt) > closedAt
        || sandboxCashTimestampNano(observation.observedFrom) < closedAt || BigInt(flatAt) * 1_000_000n < closedAt
        || flatAt > timestamp(observation.observedAt))) {
        reasons.push('cash-timestamps-unconfirmed');
      }
      if (closedAt !== null && input.ownership) {
        try {
          const entryTimes = input.ownership.entry.stages.map(stage => sandboxCashTimestampNano(stage.executedAt));
          const exitTimes = input.ownership.exit.stages.map(stage => sandboxCashTimestampNano(stage.executedAt));
          if (entryTimes.length === 0 || exitTimes.length === 0
            || entryTimes.some(at => at < sandboxCashTimestampNano(baseline.observedAt))
            || exitTimes.some(at => at > sandboxCashTimestampNano(input.closedAt!))) throw new Error(invalidEvidence);
        } catch {
          if (!reasons.includes('cash-timestamps-unconfirmed')) reasons.push('cash-timestamps-unconfirmed');
        }
      }
    }
  }
  const canCompare = reasons.length === 0;
  const operations = baseline && observation?.flowEvidence && input.ownership
    ? assessSandboxCashOperations(observation.flowEvidence, {
      ...input.ownership, accountId: baseline.accountId, from: baseline.observedFrom, to: observation.observedAt,
    }) : null;
  if (!operations?.complete) {
    reasons.push('cash-flow-coverage-unconfirmed', ...(operations?.reasons ?? []));
  }
  const deltaMismatch = canCompare && deltaNano !== expectedDeltaNano;
  const operationsMismatch = canCompare && operations?.complete && operations.paymentNano !== expectedDeltaNano;
  if (deltaMismatch || operationsMismatch) {
    if (deltaMismatch) reasons.push('cash-delta-mismatch');
    if (operationsMismatch) reasons.push('cash-operations-payment-mismatch');
    return { cashProven: false, status: 'mismatch', reasons, deltaNano, expectedDeltaNano };
  }
  if (canCompare && operations?.complete) {
    return { cashProven: true, status: 'reconciled', reasons, deltaNano, expectedDeltaNano };
  }
  return { cashProven: false, status: 'incomplete', reasons, deltaNano, expectedDeltaNano };
}

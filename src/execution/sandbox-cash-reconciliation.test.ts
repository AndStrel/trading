import { describe, expect, it } from 'vitest';
import {
  analyzeSandboxCashReconciliation, assertSandboxCashBaseline, assertSandboxCashObservation,
  type SandboxCashBaseline, type SandboxCashObservation,
} from './sandbox-cash-reconciliation.js';

const baseline: SandboxCashBaseline = {
  version: 1, accountId: 'synthetic-account', entryRequestId: 'synthetic-entry', cashNano: '1000000000000',
  observedFrom: '2026-10-01T10:00:00.000Z', observedAt: '2026-10-01T10:00:01.000Z',
  ledgerRevision: '1', killGeneration: 'synthetic-generation', preparedRaw: '{"fixture":"synthetic"}',
};
const observation: SandboxCashObservation = {
  version: 1, accountId: baseline.accountId, entryRequestId: baseline.entryRequestId, cashNano: '999877700000',
  observedFrom: '2026-10-01T10:02:00.000Z', observedAt: '2026-10-01T10:02:01.000Z', ledgerRevision: '8',
  epoch: { killGeneration: 'synthetic-current-generation', preparedRaw: '{"fixture":"synthetic-current"}',
    selection: { key: 'synthetic-current-selection', raw: null } },
};
const input = () => ({ baseline: structuredClone(baseline), observation: structuredClone(observation),
  expectedNetNano: '-122300000', closedAt: '2026-10-01T10:01:00.000Z', flatConfirmedAt: observation.observedAt });
const invalid = 'Sandbox cash evidence is invalid';

describe('Exact cash arithmetic is not complete foreign-flow proof', () => {
  it('keeps an exactly matching known net incomplete without operation coverage', () => {
    expect(analyzeSandboxCashReconciliation(input())).toEqual({ cashProven: false, status: 'incomplete',
      reasons: ['cash-flow-coverage-unconfirmed'], deltaNano: '-122300000', expectedDeltaNano: '-122300000' });
  });
  it('also keeps a forged unsupported marker incomplete', () => {
    const value = input(); value.observation.flowEvidence = { version: 1, kind: 'unsupported' } as never;
    expect(analyzeSandboxCashReconciliation(value)).toMatchObject({ cashProven: false, status: 'incomplete',
      reasons: ['cash-observation-invalid', 'cash-flow-coverage-unconfirmed'] });
  });
  it.each(['1', '-1', '1000', '-1000'])('rejects an unexplained %s nano deposit or withdrawal without epsilon', (change) => {
    const value = input(); value.observation.cashNano = String(BigInt(value.observation.cashNano) + BigInt(change));
    const result = analyzeSandboxCashReconciliation(value);
    expect(result).toMatchObject({ cashProven: false, status: 'mismatch',
      deltaNano: String(BigInt(value.expectedNetNano) + BigInt(change)), expectedDeltaNano: value.expectedNetNano });
    expect(result.reasons).toContain('cash-delta-mismatch');
  });
  it('keeps missing fees incomplete rather than inferring them from cash', () => {
    const value = input(); value.observation.cashNano = String(BigInt(value.observation.cashNano) + 1000n);
    const result = analyzeSandboxCashReconciliation({ ...value, expectedNetNano: null });
    expect(result).toMatchObject({ cashProven: false, status: 'incomplete', expectedDeltaNano: null });
    expect(result.reasons).toContain('cash-net-unconfirmed');
  });
  it('does not hide late actual or archived fees behind the old matching cash difference', () => {
    const value = input(); value.expectedNetNano = String(BigInt(value.expectedNetNano) - 1n);
    expect(analyzeSandboxCashReconciliation(value)).toMatchObject({ cashProven: false, status: 'mismatch',
      deltaNano: '-122300000', expectedDeltaNano: '-122300001' });
  });
  it('does not compute a cash difference across another account or entry UUID', () => {
    for (const key of ['accountId', 'entryRequestId'] as const) {
      const value = input(); value.observation[key] = 'different-synthetic-identity';
      const result = analyzeSandboxCashReconciliation(value);
      expect(result).toMatchObject({ cashProven: false, status: 'incomplete', deltaNano: null });
      expect(result.reasons).toContain('cash-identity-mismatch');
    }
  });
  it.each(['baseline', 'observation', 'closedAt', 'flatConfirmedAt'] as const)('keeps missing %s incomplete', (key) => {
    const result = analyzeSandboxCashReconciliation({ ...input(), [key]: null });
    expect(result.cashProven).toBe(false); expect(result.status).toBe('incomplete');
  });
  it('uses only supplied actual net, never modeled fees, slippage or initial configuration', () => {
    const value = input(); value.observation.cashNano = '1000000000001'; value.expectedNetNano = '1';
    expect(analyzeSandboxCashReconciliation(value)).toMatchObject({ deltaNano: '1', expectedDeltaNano: '1',
      status: 'incomplete', cashProven: false });
  });
  it('retains nanoruble precision above the safe Number integer limit', () => {
    const value = input(); value.baseline.cashNano = '900719925474099300000';
    value.observation.cashNano = String(BigInt(value.baseline.cashNano) + 1n); value.expectedNetNano = '1';
    expect(analyzeSandboxCashReconciliation(value)).toMatchObject({ deltaNano: '1', expectedDeltaNano: '1' });
  });
  it('supports exact zero differences without claiming external movements could not cancel out', () => {
    const value = input(); value.observation.cashNano = value.baseline.cashNano; value.expectedNetNano = '0';
    expect(analyzeSandboxCashReconciliation(value)).toMatchObject({ deltaNano: '0', expectedDeltaNano: '0',
      status: 'incomplete', cashProven: false });
  });
});

describe('Cash evidence journal boundary validators', () => {
  it('accepts canonical JSON evidence and optional selection without requiring equal ledger revisions', () => {
    const value = { ...baseline, selection: { key: 'synthetic-selection', raw: '{"tickers":["TEST"]}' } };
    expect(() => assertSandboxCashBaseline(JSON.parse(JSON.stringify(value)))).not.toThrow();
    expect(() => assertSandboxCashObservation(observation)).not.toThrow();
  });
  it('requires the current epoch, but never equates it with the historical BUY generation or selection', () => {
    const value = input(); value.baseline.selection = { key: 'synthetic-old-selection', raw: '{"fixture":"old"}' };
    expect(() => assertSandboxCashObservation(value.observation)).not.toThrow();
    expect(analyzeSandboxCashReconciliation(value).reasons).toEqual(['cash-flow-coverage-unconfirmed']);
    delete (value.observation as Partial<SandboxCashObservation>).epoch;
    expect(() => assertSandboxCashObservation(value.observation)).toThrow(invalid);
  });
  it.each([
    null, {}, { killGeneration: '', preparedRaw: '{}', selection: { key: 'synthetic', raw: null } },
    { killGeneration: 'synthetic', preparedRaw: '', selection: { key: 'synthetic', raw: null } },
    { killGeneration: 'synthetic', preparedRaw: '{}', selection: null },
    { killGeneration: 'synthetic', preparedRaw: '{}', selection: { key: 'synthetic' } },
    { killGeneration: 'synthetic', preparedRaw: '{}', selection: { key: '', raw: null } },
    { killGeneration: 'synthetic', preparedRaw: '{}', selection: { key: 'synthetic', raw: '' } },
    { killGeneration: 'synthetic', preparedRaw: '{}', selection: { key: 'synthetic', raw: false } },
    { killGeneration: 'synthetic', preparedRaw: '{}', selection: { key: 'synthetic', raw: null, complete: true } },
    { killGeneration: 'synthetic', preparedRaw: '{}', selection: { key: 'synthetic', raw: null }, complete: true },
  ])('rejects missing or malformed observation epoch %# using a fixed private-safe message', (epoch) => {
    expect(() => assertSandboxCashObservation({ ...observation, epoch })).toThrow(invalid);
  });
  it('accepts explicitly absent selection state and the exact opaque selection value without interpreting it as proof', () => {
    for (const raw of [null, '{"fixture":"current-selection"}']) {
      expect(() => assertSandboxCashObservation({ ...observation, epoch: { ...observation.epoch,
        selection: { key: 'synthetic-current-selection', raw } } })).not.toThrow();
    }
  });
  it.each([null, undefined, [], 'sensitive-invalid-value', 1, {}])('rejects malformed shapes using a fixed message', (value) => {
    expect(() => assertSandboxCashBaseline(value)).toThrow(invalid);
    expect(() => assertSandboxCashObservation(value)).toThrow(invalid);
  });
  it.each(['-1', '-0', '+1', '01', '0.1', '1e3', '', '9'.repeat(41), 1])('rejects noncanonical cash %s', (cashNano) => {
    expect(() => assertSandboxCashBaseline({ ...baseline, cashNano })).toThrow(invalid);
    expect(() => assertSandboxCashObservation({ ...observation, cashNano })).toThrow(invalid);
  });
  it.each(['-1', '-0', '+1', '01', '0.1', '', '9'.repeat(41), 1])('rejects noncanonical ledger revisions %s', (ledgerRevision) => {
    expect(() => assertSandboxCashBaseline({ ...baseline, ledgerRevision })).toThrow(invalid);
    expect(() => assertSandboxCashObservation({ ...observation, ledgerRevision })).toThrow(invalid);
  });
  it.each(['-0', '+1', '01', '-01', '1.0', '1e3', '9'.repeat(41), 'sensitive-invalid-value'])('does not use malformed expected net %s', (expectedNetNano) => {
    const result = analyzeSandboxCashReconciliation({ ...input(), expectedNetNano });
    expect(result).toMatchObject({ cashProven: false, status: 'incomplete', expectedDeltaNano: null });
    expect(result.reasons.join(' ')).not.toContain(expectedNetNano);
  });
  it('rejects missing or extra own keys, inherited evidence and symbol properties', () => {
    for (const key of Object.keys(baseline)) {
      const value = { ...baseline } as Record<string, unknown>; delete value[key];
      expect(() => assertSandboxCashBaseline(value)).toThrow(invalid);
    }
    expect(() => assertSandboxCashBaseline({ ...baseline, extra: 'sensitive-extra' })).toThrow(invalid);
    expect(() => assertSandboxCashObservation({ ...observation, extra: true })).toThrow(invalid);
    expect(() => assertSandboxCashBaseline(Object.create(baseline))).toThrow(invalid);
    expect(() => assertSandboxCashObservation({ ...observation, [Symbol('unexpected')]: true })).toThrow(invalid);
  });
  it.each([
    { accountId: '' }, { accountId: ' synthetic-account' }, { entryRequestId: 'secret\nidentity' },
    { killGeneration: '' }, { preparedRaw: '' }, { preparedRaw: 'x'.repeat(16_385) },
    { version: 2 }, { selection: null }, { selection: { key: 'synthetic', raw: '', complete: true } },
  ])('rejects malformed baseline metadata %#', (patch) => {
    expect(() => assertSandboxCashBaseline({ ...baseline, ...patch })).toThrow(invalid);
  });
  it.each([
    { complete: true }, { version: 1, kind: 'complete' }, { version: 1, kind: 'unsupported', complete: true }, true,
  ])('does not accept invented successful flow evidence %#', (flowEvidence) => {
    const forged = { ...observation, flowEvidence };
    expect(() => assertSandboxCashObservation(forged)).toThrow(invalid);
    expect(analyzeSandboxCashReconciliation({ ...input(), observation: forged as unknown as SandboxCashObservation }))
      .toMatchObject({ status: 'incomplete', cashProven: false, deltaNano: null });
  });
});

describe('Cash observation chronology', () => {
  it('accepts the exact nine-digit close timestamp while read spans remain strict local milliseconds', () => {
    const value = input(); value.closedAt = '2026-10-01T10:01:00.123456789Z';
    const result = analyzeSandboxCashReconciliation(value);
    expect(result.reasons).toEqual(['cash-flow-coverage-unconfirmed']);
    expect(result.status).toBe('incomplete');
  });
  it('does not treat a millisecond flat flag just before a nanosecond close as post-close proof', () => {
    const value = input(); value.closedAt = '2026-10-01T10:01:00.123456789Z';
    value.flatConfirmedAt = '2026-10-01T10:01:00.123Z';
    expect(analyzeSandboxCashReconciliation(value).reasons).toContain('cash-timestamps-unconfirmed');
  });
  it('accepts UTC spelling without milliseconds and inclusive 30-second read span', () => {
    expect(() => assertSandboxCashBaseline({ ...baseline, observedFrom: '2026-10-01T10:00:00Z',
      observedAt: '2026-10-01T10:00:30Z' })).not.toThrow();
  });
  it.each([
    { observedFrom: '2026-10-01T10:00:02.000Z' },
    { observedAt: '2026-10-01T10:00:30.001Z' },
    { observedAt: '2026-02-30T10:00:01.000Z' },
    { observedAt: '2026-10-01T10:00:01+00:00' },
    { observedAt: '2026-10-01T10:00:01.0001Z' },
  ])('rejects reversed, slow or noncanonical baseline read %#', (patch) => {
    expect(() => assertSandboxCashBaseline({ ...baseline, ...patch })).toThrow(invalid);
  });
  it.each([
    { observedFrom: '2026-10-01T10:02:02.000Z' },
    { observedAt: '2026-10-01T10:02:30.001Z' },
    { observedAt: 'sensitive-invalid-timestamp' },
  ])('rejects invalid final observation %#', (patch) => {
    const value = { ...input(), observation: { ...observation, ...patch } };
    expect(() => assertSandboxCashObservation(value.observation)).toThrow(invalid);
    expect(analyzeSandboxCashReconciliation(value)).toMatchObject({ status: 'incomplete', cashProven: false });
  });
  it.each(['baseline-after-close', 'read-before-close', 'flat-before-close', 'flat-after-read'])('keeps %s incomplete', (condition) => {
    const value = input();
    if (condition === 'baseline-after-close') value.closedAt = baseline.observedFrom;
    if (condition === 'read-before-close') value.closedAt = observation.observedAt;
    if (condition === 'flat-before-close') value.flatConfirmedAt = baseline.observedAt;
    if (condition === 'flat-after-read') value.flatConfirmedAt = '2026-10-01T10:02:01.001Z';
    const result = analyzeSandboxCashReconciliation(value);
    expect(result).toMatchObject({ status: 'incomplete', cashProven: false });
    expect(result.reasons).toContain('cash-timestamps-unconfirmed');
  });
  it('allows the earlier journal flat flag only with a later valid final cash/flat read supplied by caller', () => {
    const value = input(); value.flatConfirmedAt = value.closedAt;
    expect(analyzeSandboxCashReconciliation(value).reasons).not.toContain('cash-timestamps-unconfirmed');
  });
});

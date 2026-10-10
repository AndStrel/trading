import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadOnlyReplaySource } from './history/read-only-replay-source.js';

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./history/read-only-replay-source.js', () => ({ loadReadOnlyReplaySource: load }));
import { parseCatalogReplayArgs, runCatalogReplayCli } from './backtest-catalog-parity.js';

function source(): ReadOnlyReplaySource {
  return {
    candles: Array.from({ length: 5 }, (_, index) => ({ instrumentId: 'public-sber-uid',
      time: new Date(Date.parse('2026-01-05T06:10:00.000Z') + index * 60_000).toISOString(),
      open: 275, high: 275.01, low: 274.99, close: 275, volume: 1000 })),
    archives: [{ instrumentId: 'public-sber-uid', ticker: 'SBER', year: 2026,
      archiveSha256: 'a'.repeat(64), storedCandleCount: 5, rawRowCount: 5,
      invalidRowCount: 0, duplicateRowCount: 0, lotSize: 1, priceStep: 0.01,
      source: 'tinvest', importedAt: '2026-10-03T10:00:00.123Z' }],
    contentSha256: 'b'.repeat(64), readOnly: true, provenanceEvidence: 'archive-linked', warnings: ['model-only'],
    coverage: { candleCount: 5, firstCandleAt: '2026-01-05T06:10:00.000Z',
      lastCandleAt: '2026-01-05T06:14:00.000Z', dates: [], missingMinutesWithinSpan: 0 },
  };
}

describe('catalog CLI integration without environment or clients', () => {
  beforeEach(() => { load.mockReset(); load.mockReturnValue(source()); });
  it('reads one frozen source, runs all declared comparisons and always forbids admission', () => {
    const report = runCatalogReplayCli(parseCatalogReplayArgs(['--database=/tmp/finalized.sqlite', '--cost=all']));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({ databasePath: '/tmp/finalized.sqlite', ticker: 'SBER',
      from: '2025-08-01T00:00:00.000Z', to: '2026-09-27T00:00:00.000Z' });
    expect(report.scenarios).toHaveLength(6);
    expect(report.scenarios.filter(value => value.productionCompatible)).toHaveLength(2);
    expect(report.scenarios.every(value => value.admission.allowed === false && !value.modelScreen.passes)).toBe(true);
    expect(report.scenarios.every(value => !value.stress.cashAndRiskPathProven)).toBe(true);
    expect(report.ordersSubmitted).toBe(false);
    expect(report.admission).toEqual({ allowed: false, executableEvidence: false });
    expect(JSON.stringify(report)).not.toContain('/tmp/finalized.sqlite');
  });
  it.each([10, null])('refuses unverified lot metadata %s rather than reinterpret it', lotSize => {
    const fixture = source(); fixture.archives[0]!.lotSize = lotSize; load.mockReturnValue(fixture);
    expect(() => runCatalogReplayCli(parseCatalogReplayArgs(['--database=/tmp/finalized.sqlite']))).toThrow('metadata');
  });
  it('refuses off-tick candles', () => {
    const fixture = source(); fixture.candles[0]!.open = 275.001; load.mockReturnValue(fixture);
    expect(() => runCatalogReplayCli(parseCatalogReplayArgs(['--database=/tmp/finalized.sqlite']))).toThrow('tick');
  });
  it('preserves loader refusal without fallback, copying, migration or output pretending to succeed', () => {
    load.mockImplementation(() => { throw new Error('Read-only replay source: source-not-safe'); });
    expect(() => runCatalogReplayCli(parseCatalogReplayArgs(['--database=/tmp/finalized.sqlite']))).toThrow('source-not-safe');
    expect(load).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadOnlyReplaySource } from './history/read-only-replay-source.js';

const { load, replay } = vi.hoisted(() => ({ load: vi.fn(), replay: vi.fn() }));
vi.mock('./history/read-only-replay-source.js', () => ({ loadReadOnlyReplaySource: load }));
vi.mock('./backtest/catalog-parity-replay.js', async importOriginal => ({
  ...await importOriginal<typeof import('./backtest/catalog-parity-replay.js')>(), replayCatalogStrategy: replay,
}));
import { parseCatalogReplayArgs, runCatalogReplayCli } from './backtest-catalog-parity.js';
import { repriceCatalogTrades, type CatalogModeledTrade, type CatalogParityReplayInput } from './backtest/catalog-parity-replay.js';

// Synthetic completed attempt; the real repricer, account totals and path validator remain unmocked.
function attempt(entry = '290000000000', stop = '275000000000', target = '327500000000'): CatalogModeledTrade {
  return { id: 'synthetic-one', strategyId: 'trend-momentum-v1', ticker: 'SBER', instrumentId: 'public-sber-uid',
    sessionDate: '2025-08-04', entryAt: '2025-08-04T07:10:00.000Z', exitAt: '2025-08-04T07:11:00.000Z',
    unresolvedAt: null, status: 'closed', lots: 1, units: 1, lotSize: 1,
    entryNano: entry, stopNano: stop, targetNano: target, entryGrossNano: entry,
    entryCommissionNano: '0', entrySlippageNano: '0', exitNano: target, exitGrossNano: target,
    exitCommissionNano: '0', exitSlippageNano: '0', netNano: String(BigInt(target) - BigInt(entry)),
    reservedRiskNano: '1', exitReason: 'target-touch', ambiguousStopFirst: false, executableEvidence: false };
}

function source(): ReadOnlyReplaySource {
  return { candles: [{ instrumentId: 'public-sber-uid', time: '2025-08-04T07:10:00.000Z',
    open: 290, high: 290, low: 290, close: 290, volume: 1 }],
    archives: [{ instrumentId: 'public-sber-uid', ticker: 'SBER', year: 2025, archiveSha256: 'a'.repeat(64),
      storedCandleCount: 1, rawRowCount: 1, invalidRowCount: 0, duplicateRowCount: 0, lotSize: 1,
      priceStep: 0.01, source: 'moex', importedAt: '2026-10-03T10:00:00.123Z' }],
    contentSha256: 'b'.repeat(64), readOnly: true, provenanceEvidence: 'archive-linked', warnings: ['synthetic-only'],
    coverage: { candleCount: 1, firstCandleAt: '2025-08-04T07:10:00.000Z',
      lastCandleAt: '2025-08-04T07:10:00.000Z', dates: [], missingMinutesWithinSpan: 0 } };
}

describe('CLI uses actual same-cohort cash/risk gates, not cost-only placeholders', () => {
  let original: CatalogModeledTrade[];
  beforeEach(() => {
    original = [attempt()]; load.mockReset(); load.mockReturnValue(source()); replay.mockReset();
    replay.mockImplementation((input: CatalogParityReplayInput) => {
      const priced = repriceCatalogTrades(original, input.policy);
      return { ...input, productionCompatible: priced.productionCompatible, researchStatus: 'development-only',
        decisions: [], modeledTrades: priced.modeledTrades, metrics: priced.metrics,
        coverage: { inputMinuteCount: 1, validMinuteCount: 1, completeFiveMinuteCount: 0, incompleteFiveMinuteCount: 1,
          sessionDateCount: 1, from: original[0]!.entryAt, to: original[0]!.exitAt,
          missingEntryMinuteCount: 0, unresolvedTradeCount: 0 }, admission: priced.admission };
    });
  });
  const report = (cost = 'investor', capital = '500') => runCatalogReplayCli(parseCatalogReplayArgs([
    '--database=/tmp/finalized.sqlite', `--cost=${cost}`, `--capital=${capital}`,
  ])).scenarios[0]!;

  it('proves a feasible base/stressed path but does not convert a tiny fixture into admission', () => {
    const result = report();
    expect(result.cashAndRiskPath.pathProven).toBe(true);
    expect(result.cashAndRiskPath.endingCashNano).toBe('535320000000');
    expect(result.stress.cashAndRiskPathProven).toBe(true);
    expect(result.stress.cashAndRiskPath.endingCashNano).toBe('535020000000');
    expect(result.modelScreen.checks).toMatchObject({ baseCashAndRiskPathProven: true,
      stressCashAndRiskPathProven: true, accountCashPathIncludesServiceFees: true,
      minimum100ClosedTrades: false, minimum50EntryDates: false });
    expect(result.modelScreen.passes).toBe(false);
    expect(result.admission.allowed).toBe(false);
    expect(replay).toHaveBeenCalledTimes(1); // No stress re-selection or re-sizing.
  });
  it('refuses a profitable stress cohort when500.25 entry cash cannot fit500', () => {
    original = [attempt('498250000000', '485000000000', '550000000000')];
    const result = report();
    expect(result.cashAndRiskPath.pathProven).toBe(true);
    expect(BigInt(result.stress.account.accountNetNano) > 0n).toBe(true);
    expect(result.stress.cashAndRiskPathProven).toBe(false);
    expect(result.modelScreen.checks.stressCashAndRiskPathProven).toBe(false);
    expect(result.stress.cashAndRiskPath.blockers.map(value => value.code)).toContain('cash-insufficient');
    expect(result.stress.cashAndRiskPath.modeledEntryCount).toBe(0);
    expect(result.stress.cashAndRiskPath.modeledExitCount).toBe(0);
    expect(replay).toHaveBeenCalledTimes(1);
  });
  it('fails the stress gate when new round-trip risk exceeds20 despite positive nominal net', () => {
    original = [attempt('290000000000', '272000000000', '340000000000')];
    const result = report();
    expect(result.cashAndRiskPath.pathProven).toBe(true);
    expect(result.stress.cashAndRiskPath.accountLedger[0]!.tradeRiskNano).toBe('20260000000');
    expect(result.stress.cashAndRiskPath.blockers.map(value => value.code)).toContain('trade-risk-limit');
    expect(result.modelScreen.checks.stressCashAndRiskPathProven).toBe(false);
  });
  it('includes390 before entry and reports a failed paid500RUB path without invented fills', () => {
    const result = report('public-trader');
    expect(result.cashAndRiskPath.accountLedger[0]).toMatchObject({ kind: 'monthly-fee',
      cashAfterNano: '110000000000', accepted: true });
    expect(result.cashAndRiskPath.accountLedger[1]).toMatchObject({ kind: 'entry', accepted: false });
    expect(result.cashAndRiskPath.pathProven).toBe(false);
    expect(result.modelScreen.checks.accountCashPathIncludesServiceFees).toBe(false);
    expect(result.cashAndRiskPath.modeledEntryCount).toBe(0);
    expect(result.productionCompatible).toBe(false);
  });
  it('proves paid1000RUB model cash conservation without claiming confirmed billing/production', () => {
    const result = report('public-trader', '1000');
    expect(result.cashAndRiskPath.pathProven).toBe(true);
    expect(result.cashAndRiskPath.endingCashNano).toBe(String(1_000_000_000_000n + BigInt(result.account.accountNetNano)));
    expect(result.cashAndRiskPath.monthlyFeesNano).toBe(result.account.serviceFeeNano);
    expect(result.modelScreen.checks.accountCashPathIncludesServiceFees).toBe(true);
    expect(result.cashAndRiskPath.productionCompatible).toBe(false);
    expect(result.cashAndRiskPath.admission.allowed).toBe(false);
    expect(result.modelScreen.warning).toContain('actual billing');
  });
  it('runs lower-cost sensitivities on identical attempts with their own pre-entry billing proof', () => {
    const result = report();
    expect(result.frozenInvestorCostSensitivities).toHaveLength(2);
    for (const value of result.frozenInvestorCostSensitivities) {
      expect(value.cashFeasibilityProven).toBe(false);
      expect(value.riskLimitsProven).toBe(false);
      expect(value.cashAndRiskPath.blockers.map(blocker => blocker.code)).toContain('cash-insufficient');
      expect(value.cashAndRiskPath.monthlyFeesNano).toBe('390000000000');
      expect(value.productionCompatible).toBe(false);
      expect(value.admission.allowed).toBe(false);
    }
    expect(replay).toHaveBeenCalledTimes(1);
  });
});

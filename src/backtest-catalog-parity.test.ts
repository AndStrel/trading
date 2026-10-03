import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCatalogReplayArgs, runCatalogReplayCli, type CatalogReplayCliOptions } from './backtest-catalog-parity.js';
import * as sourceLoader from './history/read-only-replay-source.js';
import * as replay from './backtest/catalog-parity-replay.js';
import { TRADING_STRATEGY_IDS } from './strategies/catalog.js';

afterEach(() => vi.restoreAllMocks());

function syntheticSource(): sourceLoader.ReadOnlyReplaySource {
  const time = '2025-08-01T07:05:00.000Z';
  return {
    candles: [{ instrumentId: 'synthetic-public-sber', time, open: 300, high: 300, low: 300, close: 300, volume: 1 }],
    archives: [{ instrumentId: 'synthetic-public-sber', ticker: 'SBER', year: 2025, lotSize: 1, priceStep: 0.01,
      archiveSha256: 'a'.repeat(64), source: 'moex' as const, storedCandleCount: 1, rawRowCount: 1,
      invalidRowCount: 0, duplicateRowCount: 0, importedAt: '2026-10-03T12:00:00.000Z' }],
    contentSha256: 'b'.repeat(64), readOnly: true as const, provenanceEvidence: 'archive-linked' as const, warnings: [],
    coverage: { candleCount: 1, firstCandleAt: time, lastCandleAt: time, missingMinutesWithinSpan: 0,
      dates: [{ date: '2025-08-01', candleCount: 1, firstCandleAt: time, lastCandleAt: time, missingMinutesWithinSpan: 0 }] },
  };
}

describe('frozen offline catalog replay CLI', () => {
  it('defaults to both approved capitals and Investor costs without an environment', () => {
    expect(parseCatalogReplayArgs(['--database', '/tmp/history.sqlite'])).toEqual({
      databasePath: '/tmp/history.sqlite', capitals: [500, 1000], costs: ['investor'],
      strategies: ['trend-momentum-v1'], help: false,
    });
  });
  it('supports only the declared scenario alternatives', () => {
    expect(parseCatalogReplayArgs(['--database=/tmp/history.sqlite', '--capital=500', '--cost', 'all']).costs)
      .toEqual(['investor', 'public-trader', 'conditional-003']);
  });
  it('help does not require or read a database', () => {
    expect(parseCatalogReplayArgs(['--help'])).toEqual({ databasePath: null,
      capitals: [500, 1000], costs: ['investor'], strategies: ['trend-momentum-v1'], help: true });
  });
  it.each([
    ['--token', 'secret'], ['--strategy', 'unknown-v1'], ['--ticker', 'VTBR'],
    ['--database', 'relative.sqlite'], ['--database'], ['--database=/tmp/a', '--database=/tmp/b'],
    ['--capital', '1001'], ['--capital', '0'], ['--cost', 'zero'], ['--cost', '__proto__'],
    ['--help=yes'], ['--database='],
    ['--strategy'], ['--strategy='], ['--strategy', '__proto__'],
    ['--strategy', 'all', '--strategy', 'trend-momentum-v1'],
    ['--strategy', 'vwap-reclaim-v1,vwap-reclaim-v1'],
  ])('rejects unregistered, unsafe or repeated options %j', (...args) => {
    expect(() => parseCatalogReplayArgs(args)).toThrow();
  });
  it('does not invent a default database or load config', () => {
    expect(() => runCatalogReplayCli(parseCatalogReplayArgs([]))).toThrow('explicit --database');
  });

  it.each(TRADING_STRATEGY_IDS)('accepts existing catalog strategy %s only by its exact ID', strategyId => {
    expect(parseCatalogReplayArgs(['--strategy', strategyId]).strategies).toEqual([strategyId]);
  });

  it('expands all in deterministic catalog order', () => {
    expect(parseCatalogReplayArgs(['--strategy=all']).strategies).toEqual([...TRADING_STRATEGY_IDS]);
  });

  it.each([
    { strategies: [] }, { strategies: null }, { strategies: 'all' }, { strategies: 0 },
    { strategies: ['unknown-v1'] }, { strategies: ['trend-momentum-v1', 'trend-momentum-v1'] },
    { strategies: new Array(1) }, { strategies: [...TRADING_STRATEGY_IDS, 'trend-momentum-v1'] },
  ])(
    'rejects invalid injected strategies $strategies before source I/O', ({ strategies }) => {
      const loader = vi.spyOn(sourceLoader, 'loadReadOnlyReplaySource');
      const options = { ...parseCatalogReplayArgs(['--database', '/synthetic/history.sqlite']), strategies };
      expect(() => runCatalogReplayCli(options as unknown as CatalogReplayCliOptions)).toThrow('Invalid frozen replay strategies');
      expect(loader).not.toHaveBeenCalled();
    },
  );

  it('preserves the original omitted-strategy programmatic default and protocol', () => {
    const loader = vi.spyOn(sourceLoader, 'loadReadOnlyReplaySource').mockReturnValue(syntheticSource());
    const options = parseCatalogReplayArgs(['--database', '/synthetic/history.sqlite']);
    delete options.strategies;
    const result = runCatalogReplayCli(options);
    expect(result).toMatchObject({ protocol: 'catalog-parity-replay-v1', hypothesis: 'SBER/trend-momentum-v1',
      researchStatus: 'development-only', ordersSubmitted: false,
      admission: { allowed: false, executableEvidence: false } });
    expect(result).not.toHaveProperty('researchProtocol');
    expect(result.scenarios.map(scenario => [scenario.strategyId, scenario.strategyVersion, scenario.capitalRub, scenario.costScenario]))
      .toEqual([['trend-momentum-v1', '1', 500, 'investor'], ['trend-momentum-v1', '1', 1000, 'investor']]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('runs every strategy, capital and cost independently through the real shared replay on synthetic data', () => {
    const source = syntheticSource();
    const unchanged = JSON.stringify(source);
    const loader = vi.spyOn(sourceLoader, 'loadReadOnlyReplaySource').mockReturnValue(source);
    const kernel = vi.spyOn(replay, 'replayCatalogStrategy');
    const result = runCatalogReplayCli(parseCatalogReplayArgs(['--database', '/synthetic/history.sqlite',
      '--strategy', 'all', '--cost', 'all']));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith({ databasePath: '/synthetic/history.sqlite', ticker: 'SBER',
      from: '2025-08-01T00:00:00.000Z', to: '2026-09-27T00:00:00.000Z' });
    expect(kernel).toHaveBeenCalledTimes(18);
    expect(result.scenarios).toHaveLength(18);
    expect(new Set(result.scenarios.map(s => `${s.strategyId}/${s.capitalRub}/${s.costScenario}`)).size).toBe(18);
    expect(result).toMatchObject({ researchProtocol: 'catalog-all-existing-v1', researchStatus: 'development-only',
      study: { strategyIds: [...TRADING_STRATEGY_IDS], comparison: 'independent-scenarios-not-portfolio',
        previouslyInspectedPeriod: true, newOutOfSampleEvidence: false, winnerRanking: false },
      admission: { allowed: false, executableEvidence: false }, ordersSubmitted: false });
    for (const [index, call] of kernel.mock.calls.entries()) {
      const input = call[0];
      const scenario = result.scenarios[index]!;
      expect(scenario).toMatchObject({ strategyId: input.strategyId, strategyVersion: '1',
        admission: { allowed: false, executableEvidence: false } });
      expect(input.policy).toEqual({ ...replay.DEFAULT_CATALOG_REPLAY_POLICY, capitalRub: scenario.capitalRub,
        commissionRate: { investor: 0.003, 'public-trader': 0.0005, 'conditional-003': 0.0003 }[scenario.costScenario] });
      expect(input.minuteCandles).toBe(source.candles);
      expect(input.instrument).toEqual({ instrumentId: 'synthetic-public-sber', ticker: 'SBER', lotSize: 1, priceStep: 0.01 });
      expect(scenario.modeledTrades).toEqual([]);
      expect(scenario.modelScreen.passes).toBe(false);
    }
    expect(JSON.stringify(source)).toBe(unchanged);
  });

  it('labels a single explicit nontrend strategy without adding other strategies', () => {
    vi.spyOn(sourceLoader, 'loadReadOnlyReplaySource').mockReturnValue(syntheticSource());
    const result = runCatalogReplayCli(parseCatalogReplayArgs(['--database', '/synthetic/history.sqlite',
      '--strategy', 'vwap-reclaim-v1', '--capital', '500']));
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0]).toMatchObject({ strategyId: 'vwap-reclaim-v1', strategyVersion: '1' });
    expect(result.researchProtocol).toBe('catalog-all-existing-v1');
    expect(result.study?.strategyIds).toEqual(['vwap-reclaim-v1']);
  });

  it('canonicalizes an injected multi-strategy selection without ranking results', () => {
    vi.spyOn(sourceLoader, 'loadReadOnlyReplaySource').mockReturnValue(syntheticSource());
    const result = runCatalogReplayCli({ ...parseCatalogReplayArgs(['--database', '/synthetic/history.sqlite']),
      strategies: ['vwap-reclaim-v1', 'trend-momentum-v1', 'opening-range-breakout-v1'] });
    expect([...new Set(result.scenarios.map(s => s.strategyId))]).toEqual([...TRADING_STRATEGY_IDS]);
    expect(result.study?.winnerRanking).toBe(false);
  });
});

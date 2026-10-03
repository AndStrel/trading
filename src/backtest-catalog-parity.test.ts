import { describe, expect, it } from 'vitest';
import { parseCatalogReplayArgs, runCatalogReplayCli } from './backtest-catalog-parity.js';

describe('frozen offline catalog replay CLI', () => {
  it('defaults to both approved capitals and Investor costs without an environment', () => {
    expect(parseCatalogReplayArgs(['--database', '/tmp/history.sqlite'])).toEqual({
      databasePath: '/tmp/history.sqlite', capitals: [500, 1000], costs: ['investor'], help: false,
    });
  });
  it('supports only the declared scenario alternatives', () => {
    expect(parseCatalogReplayArgs(['--database=/tmp/history.sqlite', '--capital=500', '--cost', 'all']).costs)
      .toEqual(['investor', 'public-trader', 'conditional-003']);
  });
  it('help does not require or read a database', () => {
    expect(parseCatalogReplayArgs(['--help'])).toEqual({ databasePath: null,
      capitals: [500, 1000], costs: ['investor'], help: true });
  });
  it.each([
    ['--token', 'secret'], ['--strategy', 'vwap-reclaim-v1'], ['--ticker', 'VTBR'],
    ['--database', 'relative.sqlite'], ['--database'], ['--database=/tmp/a', '--database=/tmp/b'],
    ['--capital', '1001'], ['--capital', '0'], ['--cost', 'zero'], ['--cost', '__proto__'],
    ['--help=yes'], ['--database='],
  ])('rejects unregistered, unsafe or repeated options %j', (...args) => {
    expect(() => parseCatalogReplayArgs(args)).toThrow();
  });
  it('does not invent a default database or load config', () => {
    expect(() => runCatalogReplayCli(parseCatalogReplayArgs([]))).toThrow('explicit --database');
  });
});

import { describe, expect, it } from 'vitest';

import { parseHistoryImportArgs, resolveHistorySourceForTicker } from './history-import.js';

describe('parseHistoryImportArgs', () => {
  it('accepts repeatable years and an optional ticker subset', () => {
    expect(
      parseHistoryImportArgs(['--year', '2025', '--year=2026', '--ticker', 'sber, gazp, SBER']),
    ).toEqual({
      years: [2025, 2026],
      tickers: ['SBER', 'GAZP'],
      source: 'auto',
      help: false,
    });
  });

  it('requires an explicit archive year', () => {
    expect(parseHistoryImportArgs([])).toEqual({ years: [], tickers: [], source: 'auto', help: false });
  });

  it('refuses unexpected arguments and malformed tickers', () => {
    expect(() => parseHistoryImportArgs(['--unknown'])).toThrow('Unknown argument');
    expect(() => parseHistoryImportArgs(['--ticker', 'SBER;GAZP'])).toThrow('--ticker');
    expect(() => parseHistoryImportArgs(['--source', 'other'])).toThrow('--source');
  });

  it('supports an explicit source for deterministic CI fallback', () => {
    expect(parseHistoryImportArgs(['--year', '2025', '--source=moex'])).toMatchObject({ source: 'moex' });
  });
});

describe('resolveHistorySourceForTicker', () => {
  it('uses MOEX only for auto fallback or an explicit MOEX request', () => {
    expect(resolveHistorySourceForTicker('auto', 'SBER', false)).toBe('moex');
    expect(resolveHistorySourceForTicker('moex', 'SBER', false)).toBe('moex');
    expect(resolveHistorySourceForTicker('auto', 'SBER', true)).toBe('tinvest');
  });

  it('rejects a missing T-Invest instrument in strict T-Invest mode', () => {
    expect(() => resolveHistorySourceForTicker('tinvest', 'GAZP', false)).toThrow(
      'T-Invest universe did not resolve requested ticker: GAZP',
    );
  });
});

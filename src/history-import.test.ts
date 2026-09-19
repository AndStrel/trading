import { describe, expect, it } from 'vitest';

import { parseHistoryImportArgs } from './history-import.js';

describe('parseHistoryImportArgs', () => {
  it('accepts repeatable years and an optional ticker subset', () => {
    expect(
      parseHistoryImportArgs(['--year', '2025', '--year=2026', '--ticker', 'sber, gazp, SBER']),
    ).toEqual({
      years: [2025, 2026],
      tickers: ['SBER', 'GAZP'],
      help: false,
    });
  });

  it('requires an explicit archive year', () => {
    expect(parseHistoryImportArgs([])).toEqual({ years: [], tickers: [], help: false });
  });

  it('refuses unexpected arguments and malformed tickers', () => {
    expect(() => parseHistoryImportArgs(['--unknown'])).toThrow('Unknown argument');
    expect(() => parseHistoryImportArgs(['--ticker', 'SBER;GAZP'])).toThrow('--ticker');
  });
});

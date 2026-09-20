import { describe, expect, it } from 'vitest';

import { DEFAULT_REPLAY_TICKERS, parseReplayArgs } from './backtest-replay.js';
import { parseReplaySweepArgs } from './backtest-replay-sweep.js';

describe('parseReplayArgs', () => {
  it('requires one explicit year and normalizes an optional ticker subset', () => {
    expect(parseReplayArgs(['--year', '2025', '--ticker', 'sber, GAZP, SBER'])).toEqual({
      year: 2025,
      tickers: ['SBER', 'GAZP'],
      help: false,
    });
    expect(DEFAULT_REPLAY_TICKERS).toHaveLength(20);
  });

  it('does not accept accidental parameter searches through repeatable years', () => {
    expect(() => parseReplayArgs(['--year', '2014'])).toThrow('from 2015');
    expect(() => parseReplayArgs(['--year', '2025', '--year', '2024'])).toThrow('--year may be provided only once');
    expect(() => parseReplayArgs(['--ticker', 'SBER;GAZP'])).toThrow('--ticker');
    expect(() => parseReplayArgs(['--year', String(new Date().getUTCFullYear())])).toThrow('--year');
    expect(() =>
      parseReplayArgs([
        '--ticker',
        'A1,A2,A3,A4,A5,A6,A7,A8,A9,A10,A11,A12,A13,A14,A15,A16,A17,A18,A19,A20,A21',
      ]),
    ).toThrow('at most 20');
  });

  it('parses a bounded target-multiple sweep without changing replay selection rules', () => {
    const options = parseReplaySweepArgs([
      '--year',
      '2025',
      '--ticker',
      'SBER,GAZP',
      '--target-risk-multiple',
      '0.75,1,1.5,2',
    ]);

    expect(options.replay).toEqual({ year: 2025, tickers: ['SBER', 'GAZP'], help: false });
    expect(options.targetRiskMultiples).toEqual([0.75, 1, 1.5, 2]);
  });

  it('rejects duplicate target multiples in a sweep', () => {
    expect(() =>
      parseReplaySweepArgs(['--year', '2025', '--target-risk-multiple', '1,1']),
    ).toThrow('must be unique');
  });

  it('rejects malformed target multiples instead of silently dropping them', () => {
    expect(() =>
      parseReplaySweepArgs(['--year', '2025', '--target-risk-multiple', '1,not-a-number']),
    ).toThrow('positive comma-separated numbers');
  });
});

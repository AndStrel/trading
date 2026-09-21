import { describe, expect, it } from 'vitest';

import { parseOrbRvolArgs } from './backtest-orb-rvol.js';

describe('parseOrbRvolArgs', () => {
  it('keeps the legacy mode as the default', () => {
    expect(parseOrbRvolArgs(['--year', '2025', '--session-start', '10:00', '--session-end', '18:40'])).toEqual({
      replay: { year: 2025, tickers: [], help: false },
      sessionStartMinuteMoscow: 600,
      sessionEndMinuteMoscow: 1120,
      mode: 'legacy',
    });
  });

  it('parses the explicit retest-breadth research mode', () => {
    expect(
      parseOrbRvolArgs([
        '--mode=retest-breadth',
        '--year',
        '2025',
        '--ticker',
        'SBER,GAZP',
        '--session-start',
        '10:00',
        '--session-end',
        '18:40',
      ]),
    ).toEqual({
      replay: { year: 2025, tickers: ['SBER', 'GAZP'], help: false },
      sessionStartMinuteMoscow: 600,
      sessionEndMinuteMoscow: 1120,
      mode: 'retest-breadth',
    });
  });

  it('rejects an unknown or duplicate mode', () => {
    expect(() => parseOrbRvolArgs(['--mode', 'unknown'])).toThrow('legacy or retest-breadth');
    expect(() => parseOrbRvolArgs(['--mode', 'retest-breadth', '--mode', 'legacy'])).toThrow('only once');
  });
});

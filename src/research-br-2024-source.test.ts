import { describe, expect, it } from 'vitest';

import { br2024DaySpecs } from './research-br-2024-source.js';

describe('BR 2024 continuous-session source calendar', () => {
  it('fixes the source period, monthly contracts, and the official working Saturday', () => {
    const specs = br2024DaySpecs();
    expect(specs[0]).toEqual({ date: '2024-01-03', contract: 'BRG4' });
    expect(specs.at(-1)).toEqual({ date: '2024-09-25', contract: 'BRV4' });
    expect(specs.find((spec) => spec.date === '2024-04-27')).toEqual({ date: '2024-04-27', contract: 'BRK4' });
    for (const [date, contract] of [
      ['2024-02-01', 'BRH4'], ['2024-03-01', 'BRJ4'], ['2024-04-01', 'BRK4'],
      ['2024-05-02', 'BRM4'], ['2024-06-03', 'BRN4'],
      ['2024-07-01', 'BRQ4'], ['2024-08-01', 'BRU4'], ['2024-09-02', 'BRV4'],
    ]) expect(specs.find((spec) => spec.date === date)?.contract).toBe(contract);
  });
});

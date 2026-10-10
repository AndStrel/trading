import { describe, expect, it } from 'vitest';

import { br2026DaySpecs } from './research-br-2026-source.js';

describe('BR 2026 continuous-session source calendar', () => {
  it('fixes the nearest monthly contract by date before strategy outcomes', () => {
    const specs = br2026DaySpecs();
    expect(specs).toHaveLength(135);
    expect(specs[0]).toEqual({ date: '2026-03-23', contract: 'BRJ6' });
    expect(specs.at(-1)).toEqual({ date: '2026-09-25', contract: 'BRV6' });
    for (const [date, contract] of [
      ['2026-04-01', 'BRK6'], ['2026-05-04', 'BRM6'], ['2026-06-01', 'BRN6'],
      ['2026-07-01', 'BRQ6'], ['2026-08-03', 'BRU6'], ['2026-09-01', 'BRV6'],
    ]) expect(specs.find((spec) => spec.date === date)?.contract).toBe(contract);
  });
});

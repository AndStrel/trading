import { describe, expect, it } from 'vitest';

import { br2025DaySpecs } from './research-br-2025-source.js';

describe('BR 2025 continuous-session source calendar', () => {
  it('fixes the period and nearest monthly contract by date before strategy outcomes', () => {
    const specs = br2025DaySpecs();
    expect(specs).toHaveLength(134);
    expect(specs[0]).toEqual({ date: '2025-03-24', contract: 'BRJ5' });
    expect(specs.at(-1)).toEqual({ date: '2025-09-25', contract: 'BRV5' });
    for (const [date, contract] of [
      ['2025-04-01', 'BRK5'], ['2025-05-02', 'BRM5'], ['2025-06-02', 'BRN5'],
      ['2025-07-01', 'BRQ5'], ['2025-08-01', 'BRU5'], ['2025-09-01', 'BRV5'],
    ]) expect(specs.find((spec) => spec.date === date)?.contract).toBe(contract);
  });
});

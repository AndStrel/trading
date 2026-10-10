import { describe, expect, it } from 'vitest';
import { tgld2026DaySpecs } from './research-tgld-2026-feasibility.js';

describe('TGLD feasibility source dates', () => {
  it('uses the historical MOEX board switch and excludes special sessions', () => {
    const specs = tgld2026DaySpecs();
    expect(specs).toHaveLength(133);
    expect(specs.find((spec) => spec.date === '2026-06-19')?.board).toBe('TQTF');
    expect(specs.find((spec) => spec.date === '2026-06-22')?.board).toBe('TQBR');
    expect(specs.find((spec) => spec.date === '2026-05-01')).toBeUndefined();
  });
});

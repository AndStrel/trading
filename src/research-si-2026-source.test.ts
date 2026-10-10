import { describe, expect, it } from 'vitest';

import { si2026DaySpecs } from './research-si-2026-source.js';

describe('Si 2026 continuous-session source calendar', () => {
  it('fixes the weekday period and contract changes before outcomes', () => {
    const specs = si2026DaySpecs();
    expect(specs).toHaveLength(135);
    expect(specs[0]).toEqual({ date: '2026-03-23', contract: 'SiM6' });
    expect(specs.at(-1)).toEqual({ date: '2026-09-25', contract: 'SiZ6' });
    expect(specs.find((spec) => spec.date === '2026-06-10')?.contract).toBe('SiM6');
    expect(specs.find((spec) => spec.date === '2026-06-11')?.contract).toBe('SiU6');
    expect(specs.find((spec) => spec.date === '2026-09-10')?.contract).toBe('SiU6');
    expect(specs.find((spec) => spec.date === '2026-09-11')?.contract).toBe('SiZ6');
  });
});

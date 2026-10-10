import { describe, expect, it } from 'vitest';
import { weekendTickReturn } from './tmon-spbru-weekend.js';

describe('TMON@ weekend execution proxy', () => {
  it('charges one adverse kopeck on each side', () => {
    expect(weekendTickReturn(165.06, 165.06, 1)).toBeCloseTo(165.05 / 165.07 - 1);
    expect(weekendTickReturn(165.06, 165.09, 1)).toBeGreaterThan(0);
    expect(weekendTickReturn(165.06, 165.07, 1)).toBeLessThan(0);
  });
  it('rejects off-grid prices and invalid allowances', () => {
    expect(() => weekendTickReturn(165.061, 165.07, 1)).toThrow();
    expect(() => weekendTickReturn(165.06, 165.07, -1)).toThrow();
  });
});

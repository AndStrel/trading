import { describe, expect, it } from 'vitest';
import { oracleLongNetFromDailyRange } from './lqdt-fee-ceiling.js';

describe('daily-range long oracle', () => {
  it('charges fees on both sides multiplicatively', () => {
    expect(oracleLongNetFromDailyRange(100, 100.6, 0.003)).toBeLessThan(0);
    expect(oracleLongNetFromDailyRange(100, 100.7, 0.003)).toBeGreaterThan(0);
  });
  it('rejects invalid values', () => {
    expect(() => oracleLongNetFromDailyRange(100, 99, 0.003)).toThrow();
    expect(() => oracleLongNetFromDailyRange(100, 101, -0.1)).toThrow();
  });
});

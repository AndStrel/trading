import { describe, expect, it } from 'vitest';
import { analoguePrediction, netReturnPct, type Observation } from './similarity-experiment.js';

const target: Observation = { ticker: 'TEST', day: '2024-01-01', observedAt: '2024-01-01T07:29:00Z',
  availableAt: '2024-01-01T07:30:00Z', vector: [1], terminalAt: null, forwardReturnPct: null };
const history = () => Array.from({ length: 20 }, (_, i) => [{ ...target, day: `2023-12-${String(i + 1).padStart(2, '0')}`,
  availableAt: '2023-12-01T07:30:00Z', terminalAt: '2023-12-31T09:00:00Z', forwardReturnPct: 0.5 }]);
describe('predeclared similarity baseline', () => {
  it('requires independent prior days and never consumes current/future outcomes', () => {
    expect(analoguePrediction(target, history())).toBe(0.5);
    expect(analoguePrediction(target, history().slice(0, 19))).toBeNull();
    expect(analoguePrediction(target, [...history(), [{ ...target, forwardReturnPct: 100, terminalAt: '2024-01-01T09:00:00Z' }]])).toBe(0.5);
    const h = history(); h[0]![0]!.terminalAt = '2024-01-02T00:00:00Z';
    expect(analoguePrediction(target, h)).toBeNull();
  });
  it('counts at most one nearest observation from each day', () => {
    const h = history(); h[0]!.push({ ...h[0]![0]!, vector: [2], forwardReturnPct: 100 });
    expect(analoguePrediction(target, h)).toBe(0.5);
  });
  it('charges entry and exit costs even for unchanged prices', () => {
    expect(netReturnPct(100, 100, 0.0005)).toBeCloseTo(-0.19980015, 6);
    expect(netReturnPct(100, 100, 0.001)).toBeLessThan(netReturnPct(100, 100, 0.0005));
  });
});

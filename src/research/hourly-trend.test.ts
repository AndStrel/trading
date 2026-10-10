import { describe, expect, it } from 'vitest';
import { hourlySamples, fitTrend, predictTrend, evaluateHourly, primaryGate, type HourlySample } from './hourly-trend.js';

const start = Date.parse('2023-06-01T07:00:00.000Z'); // 10:00 MSK
const candles = () => Array.from({ length: 181 }, (_, i) => ({ instrumentId: 'TEST',
  time: new Date(start + i * 60_000).toISOString(), open: 100 + i / 100,
  close: 100 + i / 100 + 0.005, high: 100 + i / 100 + 0.01, low: 100 + i / 100, volume: 10 }));
const training = (): HourlySample[] => Array.from({ length: 240 }, (_, i) => ({ ticker: 'TEST', day: '2023-06-01',
  decisionAt: new Date(start + i * 3600_000).toISOString(), terminalAt: new Date(start + (i + 1) * 3600_000).toISOString(),
  features: [i % 2 ? 1 : -1, 0, 0, 0, 0, 0], outcome: { entry: 100, exit: i % 2 ? 101 : 99 } }));
const cutoff = '2024-01-01T00:00:00.000Z';

describe('hourly trend causal data and models', () => {
  it('uses only closed past minutes; execution starts one minute later and lasts 60 minutes', () => {
    const data = candles(), sample = hourlySamples('TEST', data).samples[0]!;
    expect(sample.decisionAt).toBe('2023-06-01T09:00:00.000Z');
    expect(sample.terminalAt).toBe('2023-06-01T10:01:00.000Z');
    expect(sample.outcome).toEqual({ entry: data[121]!.open, exit: data[180]!.close });
    expect(sample.features[0]).toBeCloseTo(data[119]!.close / data[60]!.open - 1, 12);
    const changed = data.map((c, i) => i < 120 ? c : { ...c, open: 1000, close: 1000, high: 1000, low: 1000 });
    expect(hourlySamples('TEST', changed).samples[0]!.features).toEqual(sample.features);
  });
  it('keeps signals with missing future data and fails their gate instead of hiding them', () => {
    const sample = hourlySamples('TEST', candles().slice(0, 150)).samples[0]!;
    expect(sample.outcome).toBeNull();
    const evaluation = evaluateHourly([sample], () => 0.8, 0.55);
    expect(evaluation.predictions[0]!.signal).toBe(true);
    expect(evaluation.incomplete).toHaveLength(1);
    expect(primaryGate([evaluation]).reasons).toContain('incomplete-signals');
  });
  it('rejects missing history and duplicate minutes', () => {
    const data = candles(); data.splice(40, 1);
    const result = hourlySamples('TEST', data);
    expect(result.samples.some((s) => s.decisionAt === '2023-06-01T09:00:00.000Z')).toBe(false);
    // The next decision has a different lookback and must remain eligible.
    expect(result.samples[0]!.decisionAt).toBe('2023-06-01T10:00:00.000Z');
    expect(() => hourlySamples('TEST', [...candles(), candles()[0]!])).toThrow('duplicate');
  });
  for (const kind of ['logistic', 'mlp'] as const) {
    it(`${kind}: fits a known relation, reproducibly, with train-only scaling and labels`, () => {
      const train = training(), model = fitTrend(kind, train, cutoff);
      expect(predictTrend(model, [1, 0, 0, 0, 0, 0])).toBeGreaterThan(0.8);
      expect(predictTrend(model, [-1, 0, 0, 0, 0, 0])).toBeLessThan(0.2);
      const future = { ...train[0]!, decisionAt: cutoff, terminalAt: '2024-01-02T00:00:00.000Z',
        features: [99999, 99999, 0, 0, 0, 0], outcome: { entry: 100, exit: 200 } };
      const pending = { ...future, decisionAt: '2023-12-31T23:00:00.000Z' };
      expect(fitTrend(kind, [...train, future, pending], cutoff)).toEqual(model);
      expect(model.mean).toEqual([0, 0, 0, 0, 0, 0]);
      expect(model.scale).toEqual([1, 1, 1, 1, 1, 1]);
    });
  }
  it('requires sufficient training data, both classes, and valid feature dimensions', () => {
    expect(() => fitTrend('logistic', training().slice(0, 20), cutoff)).toThrow('Insufficient');
    expect(() => fitTrend('mlp', training().map((s) => ({ ...s, outcome: { entry: 1, exit: 2 } })), cutoff)).toThrow('Both');
    expect(() => fitTrend('mlp', training().map((s) => ({ ...s, features: [1] })), cutoff)).toThrow('features');
  });
  it('charges both sides and applies a strict, unchanged threshold', () => {
    const sample = { ...training()[0]!, outcome: { entry: 100, exit: 100 } };
    expect(evaluateHourly([sample], () => 0.55, 0.55).trades).toHaveLength(0);
    const e = evaluateHourly([sample], () => 0.56, 0.55);
    expect(e.trades[0]!.netPct).toBeCloseTo(-0.19980015, 6);
    expect(e.trades[0]!.stressPct).toBeLessThan(e.trades[0]!.netPct);
    expect(primaryGate([e]).status).toBe('rejected-at-primary-gate');
  });
  it('accepts a sufficient robust all-winning fixture, but rejects one losing year or concentration', () => {
    const samples = Array.from({ length: 60 }, (_, i) => ['SBER', 'GAZP'].map((ticker) => ({
      ...training()[0]!, ticker, day: new Date(start + i * 86400_000).toISOString().slice(0, 10),
      outcome: { entry: 100, exit: 102 },
    }))).flat();
    const winning = evaluateHourly(samples, () => 1, 0.55);
    expect(winning.base.profitFactor).toBeNull(); // No division by zero / JSON Infinity.
    expect(primaryGate([winning]).status).toBe('eligible-for-portfolio-test');
    const losing = evaluateHourly(samples.map((s) => ({ ...s, outcome: { entry: 100, exit: 99 } })), () => 1, 0.55);
    expect(primaryGate([winning, losing]).reasons).toContain('nonpositive-or-fragile-year');
    const oneTicker = evaluateHourly(samples.map((s) => ({ ...s, ticker: 'SBER' })), () => 1, 0.55);
    expect(primaryGate([oneTicker]).reasons).toContain('nonpositive-or-fragile-year');
  });
});

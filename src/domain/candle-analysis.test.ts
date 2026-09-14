import { describe, expect, it } from 'vitest';

import { analyzeCandles } from './candle-analysis.js';

function quotation(value: number) {
  return { units: Math.trunc(value), nano: Math.round((value % 1) * 1_000_000_000) };
}

function candle(index: number, options: { close?: number; volume?: number; isComplete?: boolean } = {}) {
  const close = options.close ?? 100 + index;
  return {
    open: quotation(close - 1),
    high: quotation(close + 2),
    low: quotation(close - 2),
    close: quotation(close),
    volume: String(options.volume ?? 100),
    time: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    ...(options.isComplete === undefined ? {} : { isComplete: options.isComplete }),
  };
}

describe('analyzeCandles', () => {
  it('calculates trend, volatility and relative volume from complete valid candles', () => {
    const candles = Array.from({ length: 60 }, (_, index) => candle(index));
    candles.push(candle(60, { close: 10_000, volume: 10_000, isComplete: false }));
    const last = candles[59];
    if (!last) throw new Error('Fixture is incomplete');
    last.volume = '200';

    const analysis = analyzeCandles({ candles });

    expect(analysis.status).toBe('ok');
    expect(analysis.analyzedCandleCount).toBe(60);
    expect(analysis.incompleteCandleCount).toBe(1);
    expect(analysis.latestClose).toBe(159);
    expect(analysis.sma20).toBe(149.5);
    expect(analysis.sma50).toBe(134.5);
    expect(analysis.trend).toBe('up');
    expect(analysis.averageTrueRange14).toBe(4);
    expect(analysis.volatilityPct).toBe(2.52);
    expect(analysis.averageVolume20).toBe(100);
    expect(analysis.relativeVolume).toBe(2);
    expect(analysis.warnings).toContain('Incomplete candles were excluded from the analysis');
  });

  it('reports insufficient history without inventing unavailable metrics', () => {
    const analysis = analyzeCandles({ candles: Array.from({ length: 14 }, (_, index) => candle(index)) });

    expect(analysis.status).toBe('insufficient_data');
    expect(analysis.trend).toBe('insufficient_data');
    expect(analysis.averageTrueRange14).toBeNull();
    expect(analysis.relativeVolume).toBeNull();
    expect(analysis.warnings).toContain(
      'Fewer than 50 complete valid candles: long trend is unavailable',
    );
  });

  it('rejects malformed API responses', () => {
    expect(() => analyzeCandles({})).toThrow('T-Invest candle response does not contain a candles array');
  });
});

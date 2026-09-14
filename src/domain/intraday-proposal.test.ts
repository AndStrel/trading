import { describe, expect, it } from 'vitest';

import type { CandleAnalysis } from './candle-analysis.js';
import { proposeIntradayLong } from './intraday-proposal.js';

const upwardAnalysis: CandleAnalysis = {
  status: 'ok',
  rawCandleCount: 72,
  analyzedCandleCount: 72,
  incompleteCandleCount: 0,
  invalidCandleCount: 0,
  latestClose: 100,
  latestCandleTime: '2026-09-14T12:55:00.000Z',
  sma20: 99,
  sma50: 98,
  trend: 'up',
  averageTrueRange14: 1.5,
  volatilityPct: 1.5,
  latestVolume: 200,
  averageVolume20: 100,
  relativeVolume: 2,
  warnings: [],
};

describe('proposeIntradayLong', () => {
  it('derives a whole-price-step long scenario from an uptrend and active volume', () => {
    const proposal = proposeIntradayLong({
      candleAnalysis: upwardAnalysis,
      orderBookPayload: { asks: [{ price: { units: '100', nano: 0 } }] },
      priceStep: 0.01,
    });

    expect(proposal).toMatchObject({
      entryPrice: 100,
      stopPrice: 97.75,
      targetPrice: 105.63,
    });
  });

  it('does not create a scenario from flat or low-volume candles', () => {
    expect(
      proposeIntradayLong({
        candleAnalysis: { ...upwardAnalysis, trend: 'flat' },
        orderBookPayload: { asks: [{ price: { units: '100', nano: 0 } }] },
        priceStep: 0.01,
      }),
    ).toBeNull();
    expect(
      proposeIntradayLong({
        candleAnalysis: { ...upwardAnalysis, relativeVolume: 0.99 },
        orderBookPayload: { asks: [{ price: { units: '100', nano: 0 } }] },
        priceStep: 0.01,
      }),
    ).toBeNull();
  });
});

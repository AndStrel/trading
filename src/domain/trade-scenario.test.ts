import { describe, expect, it } from 'vitest';

import { type CandleAnalysis } from './candle-analysis.js';
import { assessTradeScenario } from './trade-scenario.js';
import { calculateTradePlan } from './trade-plan.js';

function quotation(value: number) {
  return { units: String(Math.trunc(value)), nano: Math.round((value % 1) * 1_000_000_000) };
}

const plan = calculateTradePlan({
  side: 'long',
  entryPrice: 300,
  stopPrice: 295,
  targetPrice: 315,
  lotSize: 10,
  maxRiskRub: 500,
  maxPositionRub: 50_000,
  commissionRate: 0.0005,
  slippageRate: 0.0005,
});

const upwardCandles: CandleAnalysis = {
  status: 'ok',
  rawCandleCount: 60,
  analyzedCandleCount: 60,
  incompleteCandleCount: 0,
  invalidCandleCount: 0,
  latestClose: 300,
  latestCandleTime: '2026-09-14T10:00:00.000Z',
  sma20: 295,
  sma50: 290,
  trend: 'up',
  averageTrueRange14: 3,
  volatilityPct: 1,
  latestVolume: 120,
  averageVolume20: 100,
  relativeVolume: 1.2,
  warnings: [],
};

function completeInput() {
  return {
    side: 'long' as const,
    entryPrice: 300,
    maxSpreadPct: 0.3,
    maxEntryDeviationPct: 0.5,
    allowShort: false,
    tradePlan: plan,
    candleAnalysis: upwardCandles,
    lastPricesPayload: { lastPrices: [{ price: quotation(300) }] },
    orderBookPayload: {
      isConsistent: true,
      bids: [{ price: quotation(299.9), quantity: '100' }],
      asks: [{ price: quotation(300), quantity: '120' }],
    },
    tradingStatusPayload: {
      tradingStatus: 'SECURITY_TRADING_STATUS_NORMAL_TRADING',
      apiTradeAvailable: true,
      limitOrderAvailable: true,
      marketOrderAvailable: true,
    },
  };
}

describe('assessTradeScenario', () => {
  it('marks a liquid, allowed and trend-aligned setup as a candidate', () => {
    const assessment = assessTradeScenario(completeInput());

    expect(assessment.decision).toBe('candidate');
    expect(assessment.blockers).toEqual([]);
    expect(assessment.warnings).toEqual([]);
    expect(assessment.market.spreadRub).toBe(0.1);
    expect(assessment.market.spreadPct).toBeCloseTo(0.0333, 3);
  });

  it('requires review when the candle trend opposes the setup', () => {
    const input = completeInput();
    input.candleAnalysis = { ...upwardCandles, trend: 'down' };

    const assessment = assessTradeScenario(input);

    expect(assessment.decision).toBe('review');
    expect(assessment.warnings).toContain('Candle trend opposes the planned trade direction');
  });

  it('blocks unavailable API trading and a wide or inconsistent order book', () => {
    const input = completeInput();
    input.orderBookPayload = {
      isConsistent: false,
      bids: [{ price: quotation(297), quantity: '100' }],
      asks: [{ price: quotation(300), quantity: '120' }],
    };
    input.tradingStatusPayload = {
      tradingStatus: 'SECURITY_TRADING_STATUS_NORMAL_TRADING',
      apiTradeAvailable: false,
      limitOrderAvailable: false,
    };

    const assessment = assessTradeScenario(input);

    expect(assessment.decision).toBe('blocked');
    expect(assessment.blockers).toContain('API trading availability is not confirmed');
    expect(assessment.blockers).toContain('Limit order availability is not confirmed');
    expect(assessment.blockers).toContain('Order book consistency is not confirmed');
    expect(assessment.blockers).toContain(
      'Bid/ask spread 1.005% exceeds the 0.3% strategy limit',
    );
  });

  it('blocks short scenarios until they are explicitly enabled', () => {
    const input = { ...completeInput(), side: 'short' as const };

    const assessment = assessTradeScenario(input);

    expect(assessment.decision).toBe('blocked');
    expect(assessment.blockers).toContain('Short scenarios are disabled by configuration');
  });
});

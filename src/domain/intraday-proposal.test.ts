import { describe, expect, it } from 'vitest';

import type { CandleAnalysis } from './candle-analysis.js';
import { proposeIntradayLong } from './intraday-proposal.js';
import { decimalPriceNano } from '../execution/sandbox-stop-state.js';
import { calculateTradePlan } from './trade-plan.js';
import { assessLivePilotRisk, pilotPositionBudget } from '../execution/live-pilot-risk.js';

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
      commissionRate: 0.0005,
      slippageRate: 0.0005,
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
        commissionRate: 0.0005,
        slippageRate: 0.0005,
      }),
    ).toBeNull();
    expect(
      proposeIntradayLong({
        candleAnalysis: { ...upwardAnalysis, relativeVolume: 0.99 },
        orderBookPayload: { asks: [{ price: { units: '100', nano: 0 } }] },
        priceStep: 0.01,
        commissionRate: 0.0005,
        slippageRate: 0.0005,
      }),
    ).toBeNull();
  });

  it('treats the model target as an estimate, not a guarantee of exact risk admission', () => {
    const commissionRate = 0.003;
    const slippageRate = 0.0005;
    const proposal = proposeIntradayLong({
      candleAnalysis: upwardAnalysis,
      orderBookPayload: { asks: [{ price: { units: '100', nano: 0 } }] },
      priceStep: 0.01,
      commissionRate,
      slippageRate,
    });

    expect(proposal).toMatchObject({ entryPrice: 100, stopPrice: 97.75, targetPrice: 106.6 });
    expect(proposal!.reasons).toContain(
      'Target is a model estimate; whole-lot sizing and exact rounded-expense checks are required',
    );
    expect(proposal!.reasons).not.toContain(
      'Target preserves net reward-to-risk of at least 2.0 after modelled costs',
    );

    const plan = calculateTradePlan({
      side: 'long',
      ...proposal!,
      lotSize: 1,
      maxRiskRub: 20,
      maxPositionRub: pilotPositionBudget(500, commissionRate, slippageRate),
      commissionRate,
      slippageRate,
    });
    // A displayed two-decimal ratio is not proof of exact admission.
    expect(plan).toMatchObject({ lots: 4, rewardToRisk: 2, allowed: false });
    expect(plan.reasons).toContain('Net reward-to-risk is below 2.0');

    const exact = assessLivePilotRisk(
      { prepare: true, capitalRub: 500, maxTradeRiskRub: 20, maxDailyRiskRub: 60, maxDailyLossRub: 60 },
      {
        side: 'long',
        ...proposal!,
        lots: plan.lots,
        lotSize: 1,
        commissionRate,
        slippageRate,
        availableCashRub: 500,
        reservedDailyRiskRub: 0,
        realizedDailyLossRub: 0,
        markedOpenLossRub: 0,
      },
    );
    expect(exact).toMatchObject({ allowed: false, totalRiskRub: 11.78, netRewardRub: 23.5 });
    expect(exact.blockers).toEqual(['Net reward-to-risk is below 2.0']);
  });

  it('keeps all legacy trend prices executable for realistic asks and unchanged net-risk geometry', () => {
    for (let ticks = 10051; ticks <= 10149; ticks++) {
      const ask = ticks / 100;
      const proposal = proposeIntradayLong({
        candleAnalysis: upwardAnalysis,
        orderBookPayload: { asks: [{ price: { units: String(Math.floor(ticks / 100)), nano: ticks % 100 * 10_000_000 } }] },
        priceStep: 0.01, commissionRate: 0.0005, slippageRate: 0.0005,
      });
      expect(proposal).not.toBeNull();
      expect(proposal!.entryPrice).toBe(ask);
      for (const price of [proposal!.entryPrice, proposal!.stopPrice, proposal!.targetPrice]) {
        expect(BigInt(decimalPriceNano(price)) % 10_000_000n).toBe(0n);
      }
      const cost = proposal!.entryPrice * 2 * (0.0005 + 0.0005);
      expect((proposal!.targetPrice - proposal!.entryPrice - cost)
        / (proposal!.entryPrice - proposal!.stopPrice + cost)).toBeGreaterThanOrEqual(2);
      expect(proposal!.entryPrice - proposal!.stopPrice).toBeGreaterThanOrEqual(1.5 * upwardAnalysis.averageTrueRange14!);
      expect(proposal!.targetPrice - proposal!.entryPrice).toBeLessThanOrEqual(5 * upwardAnalysis.averageTrueRange14!);
    }
  });

  it('accepts one-nanoruble ticks and rejects smaller or inexact steps', () => {
    const parameters = { candleAnalysis: upwardAnalysis,
      orderBookPayload: { asks: [{ price: { units: '101', nano: 1 } }] },
      commissionRate: 0.0005, slippageRate: 0.0005 };
    const proposal = proposeIntradayLong({ ...parameters, priceStep: 0.000000001 });
    expect(decimalPriceNano(proposal!.entryPrice)).toBe('101000000001');
    for (const price of [proposal!.entryPrice, proposal!.stopPrice, proposal!.targetPrice]) {
      expect(decimalPriceNano(price)).toMatch(/^\d+$/);
    }
    for (const priceStep of [0.0000000001, 0.010000000000000002]) {
      expect(() => proposeIntradayLong({ ...parameters, priceStep })).toThrow();
    }
  });
});


describe('cost-aware target guardrail', () => {
  it('rejects a quiet setup when costs require an implausibly distant target', () => {
    expect(
      proposeIntradayLong({
        candleAnalysis: { ...upwardAnalysis, averageTrueRange14: 0.17, latestClose: 285.67 },
        orderBookPayload: { asks: [{ price: { units: '285', nano: 680000000 } }] },
        priceStep: 0.01,
        commissionRate: 0.0005,
        slippageRate: 0.0005,
      }),
    ).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { calculateTradePlan } from './trade-plan.js';

describe('calculateTradePlan', () => {
  it('sizes by the stricter risk limit and includes round-trip costs', () => {
    const plan = calculateTradePlan({
      entryPrice: 300,
      stopPrice: 295,
      targetPrice: 315,
      lotSize: 10,
      maxRiskRub: 500,
      maxPositionRub: 50_000,
      commissionRate: 0.0005,
      slippageRate: 0.0005,
    });

    expect(plan.lots).toBe(8);
    expect(plan.units).toBe(80);
    expect(plan.positionRub).toBe(24_000);
    expect(plan.estimatedCommissionRub).toBe(24);
    expect(plan.estimatedSlippageRub).toBe(24);
    expect(plan.totalRiskRub).toBe(448);
    expect(plan.netRewardRub).toBe(1_152);
    expect(plan.rewardToRisk).toBe(2.57);
    expect(plan.allowed).toBe(true);
  });

  it('rejects a plan with insufficient net reward-to-risk', () => {
    const plan = calculateTradePlan({
      entryPrice: 300,
      stopPrice: 295,
      targetPrice: 307,
      lotSize: 10,
      maxRiskRub: 500,
      maxPositionRub: 50_000,
      commissionRate: 0.0005,
      slippageRate: 0.0005,
    });

    expect(plan.allowed).toBe(false);
    expect(plan.reasons).toContain('Net reward-to-risk is below 2.0');
  });

  it('does not allow a partial lot', () => {
    const plan = calculateTradePlan({
      entryPrice: 10_000,
      stopPrice: 9_000,
      targetPrice: 12_500,
      lotSize: 10,
      maxRiskRub: 500,
      maxPositionRub: 50_000,
      commissionRate: 0.0005,
      slippageRate: 0.0005,
    });

    expect(plan.lots).toBe(0);
    expect(plan.allowed).toBe(false);
  });
});

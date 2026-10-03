import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { assessLivePilotRisk, pilotEntryCashRequiredNano, type LivePilotRiskInput } from './live-pilot-risk.js';

const policy = loadConfig({}).livePilot;
const valid: LivePilotRiskInput = {
  side: 'long', entryPrice: 100, stopPrice: 99, targetPrice: 105, lots: 5, lotSize: 1,
  commissionRate: 0.003, slippageRate: 0.0005, availableCashRub: 1_000,
  reservedDailyRiskRub: 0, realizedDailyLossRub: 0, markedOpenLossRub: 0,
};

describe('approved daily pilot risk gate', () => {
  it('shares the exact whole-kopeck entry cash calculation with the nonpilot executor', () => {
    expect(pilotEntryCashRequiredNano(valid)).toBe('501750000000');
    expect(pilotEntryCashRequiredNano({ ...valid, entryPrice: 0.1, lots: 1, slippageRate: 1e-9 })).toBe('120000000');
    expect(assessLivePilotRisk(policy, valid).cashRequiredRub).toBe(Number(BigInt(pilotEntryCashRequiredNano(valid))) / 1e9);
  });
  it.each([{ commissionRate: 0.0005 }, { lots: 1.5 }, { lotSize: 0 }, { entryPrice: 0 }, { slippageRate: 0.021 }])
    ('never weakens entry costs for %j', change => expect(() => pilotEntryCashRequiredNano({ ...valid, ...change })).toThrow());
  it('includes both sides of expenses and rounds each expense conservatively', () => {
    expect(assessLivePilotRisk(policy, valid)).toEqual({ allowed: true, positionRub: 500, cashRequiredRub: 501.75, totalRiskRub: 8.49, netRewardRub: 21.4, blockers: [] });
  });
  it.each([
    [{ lots: 10 }, 'Cash including entry costs'],
    [{ lotSize: 10 }, 'Cash including entry costs'],
    [{ stopPrice: 95 }, 'Trade risk including'],
    [{ availableCashRub: 501.74 }, 'Cash including entry costs'],
    [{ reservedDailyRiskRub: 52 }, 'Daily reserved risk'],
    [{ realizedDailyLossRub: 52 }, 'Daily loss allowance'],
    [{ realizedDailyLossRub: 50, markedOpenLossRub: 2 }, 'Daily loss allowance'],
    [{ realizedDailyLossRub: 60 }, 'Daily loss allowance'],
    [{ targetPrice: 102.5 }, 'Net reward-to-risk'],
    [{ side: 'short' }, 'Short and margin'],
  ] as const)('blocks %j', (change, blocker) => {
    const result = assessLivePilotRisk(policy, { ...valid, ...change });
    expect(result.allowed).toBe(false);
    expect(result.blockers.join(';')).toContain(blocker);
  });
  it.each([
    { lots: 0 }, { lots: 1.5 }, { lotSize: 0 }, { entryPrice: Number.NaN },
    { commissionRate: 0.0005 }, { availableCashRub: -1 }, { realizedDailyLossRub: -10 },
  ])('fails closed on invalid inputs %j', change => {
    expect(() => assessLivePilotRisk(policy, { ...valid, ...change })).toThrow();
  });
  it('does not trust an oversized policy supplied directly by a future caller', () => {
    expect(() => assessLivePilotRisk({ ...policy, maxTradeRiskRub: 21 }, valid)).toThrow('approved limits');
  });
  it('handles decimal/scientific monetary inputs without float boundary drift', () => {
    const input = { ...valid, entryPrice: 0.1, stopPrice: 0.09, targetPrice: 0.2, slippageRate: 1e-9, lots: 1 };
    const result = assessLivePilotRisk(policy, input);
    expect(result.totalRiskRub).toBe(0.05);
    expect(result.cashRequiredRub).toBe(0.12);
  });
});

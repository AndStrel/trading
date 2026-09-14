import { describe, expect, it } from 'vitest';

import { calculatePaperEntry, calculatePaperExit } from './paper-trade.js';

describe('paper trade calculations', () => {
  it('models a long trade with adverse fills and commission on both sides', () => {
    const entry = calculatePaperEntry({
      side: 'long',
      units: 10,
      marketPrice: 100,
      commissionRate: 0.0005,
      slippageRate: 0.001,
    });
    const exit = calculatePaperExit({
      side: 'long',
      units: 10,
      entryFillPrice: entry.entryFillPrice,
      entryCommissionRub: entry.entryCommissionRub,
      entrySlippageRub: entry.entrySlippageRub,
      marketPrice: 110,
      commissionRate: 0.0005,
      slippageRate: 0.001,
    });

    expect(entry).toEqual({
      entryMarketPrice: 100,
      entryFillPrice: 100.1,
      entryCommissionRub: 0.5,
      entrySlippageRub: 1,
    });
    expect(exit).toMatchObject({
      exitMarketPrice: 110,
      exitFillPrice: 109.89,
      grossPnlRub: 97.9,
      totalCommissionRub: 1.05,
      totalSlippageRub: 2.1,
      netPnlRub: 96.85,
    });
  });

  it('models a short trade with adverse fills and no double counting of slippage', () => {
    const entry = calculatePaperEntry({
      side: 'short',
      units: 10,
      marketPrice: 100,
      commissionRate: 0.0005,
      slippageRate: 0.001,
    });
    const exit = calculatePaperExit({
      side: 'short',
      units: 10,
      entryFillPrice: entry.entryFillPrice,
      entryCommissionRub: entry.entryCommissionRub,
      entrySlippageRub: entry.entrySlippageRub,
      marketPrice: 90,
      commissionRate: 0.0005,
      slippageRate: 0.001,
    });

    expect(entry.entryFillPrice).toBe(99.9);
    expect(exit.exitFillPrice).toBe(90.09);
    expect(exit.grossPnlRub).toBe(98.1);
    expect(exit.netPnlRub).toBe(97.15);
  });
});

import { describe, expect, it } from 'vitest';

import { summarizePaperTrades } from './paper-report.js';

describe('summarizePaperTrades', () => {
  it('separates simulated costs from gross and net PnL', () => {
    const report = summarizePaperTrades([
      {
        status: 'closed',
        grossPnlRub: 120,
        totalCommissionRub: 10,
        totalSlippageRub: 20,
        netPnlRub: 110,
      },
      {
        status: 'closed',
        grossPnlRub: -45,
        totalCommissionRub: 5,
        totalSlippageRub: 10,
        netPnlRub: -50,
      },
      {
        status: 'closed',
        grossPnlRub: 0,
        totalCommissionRub: 0,
        totalSlippageRub: 0,
        netPnlRub: 0,
      },
    ]);

    expect(report).toMatchObject({
      closedTrades: 3,
      profitableTrades: 1,
      losingTrades: 1,
      breakevenTrades: 1,
      winRatePct: 33.33,
      grossPnlRub: 75,
      totalCommissionRub: 15,
      totalSlippageRub: 30,
      netPnlRub: 60,
      averageNetPnlRub: 20,
      profitFactor: 2.2,
    });
    expect(report.warnings).toContain(
      'Fewer than 20 closed paper trades: the sample is too small for a strategy conclusion',
    );
  });

  it('returns null ratios for an empty period', () => {
    const report = summarizePaperTrades([]);

    expect(report).toMatchObject({
      closedTrades: 0,
      winRatePct: null,
      averageNetPnlRub: null,
      profitFactor: null,
    });
    expect(report.warnings).toContain('No closed paper trades in the selected period');
  });
});

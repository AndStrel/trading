import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import type { JournalScenarioRecord } from '../journal/scenario-journal.js';
import { buildCandidateCardSvg } from './candidate-card.js';

describe('buildCandidateCardSvg', () => {
  it('preserves fractional trading prices and ATR while rounding monetary risks and costs to kopecks', () => {
    const scenario: JournalScenarioRecord = {
      id: 18, recordedAt: '2026-10-03T07:00:00Z', observedAt: '2026-10-03T07:00:00Z', strategy: 'intraday', instrumentId: 'irao',
      input: { side: 'long', entryPrice: 4.1235, stopPrice: 4.10, targetPrice: 4.2345, lotSize: 100, slippageRate: 0.0005 },
      decision: 'candidate', blockers: [], warnings: [],
      snapshot: {
        instrument: { ticker: 'IRAO' },
        tradePlan: { lots: 1, units: 100, positionRub: 412.3512345, totalRiskRub: 2.1235,
          estimatedCommissionRub: 0.123456789, estimatedSlippageRub: 0.234567891, netRewardRub: 7.1235, rewardToRisk: 3.355 },
        market: { bestBid: 4.123, bestAsk: 4.1235, spreadPct: 0.012345 },
        candleAnalysis: { trend: 'up', relativeVolume: 1.23456, averageTrueRange14: 0.012345678 },
      },
    };
    const svg = buildCandidateCardSvg(scenario, loadConfig({}));
    for (const price of ['4,1235 ₽', '4,10 ₽', '4,2345 ₽']) expect(svg).toContain(price);
    expect(svg).toContain('bid 4,123 ₽ · ask 4,1235 ₽');
    expect(svg).toContain('ATR 0,012345678 ₽');
    for (const money of ['412,35 ₽', '2,12 ₽', '7,12 ₽', '0,12 ₽ + 0,23 ₽']) expect(svg).toContain(money);
    expect(svg).not.toContain('2,1235 ₽');
    expect(svg).not.toContain('0,123456789 ₽');
  });

  it('renders calculated values and escapes an instrument label', () => {
    const config = loadConfig({
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"sber","label":"SBER <main>","lotSize":1,"priceStep":0.01}]',
    });
    const scenario: JournalScenarioRecord = {
      id: 17,
      recordedAt: '2026-09-14T13:00:00.000Z',
      observedAt: '2026-09-14T13:00:00.000Z',
      strategy: 'intraday',
      instrumentId: 'sber',
      input: {
        side: 'long',
        entryPrice: 100,
        stopPrice: 99,
        targetPrice: 102.5,
        lotSize: 1,
        slippageRate: 0.0005,
      },
      decision: 'candidate',
      blockers: [],
      warnings: [],
      snapshot: {
        tradePlan: {
          lots: 5,
          units: 5,
          positionRub: 500,
          totalRiskRub: 7,
          estimatedCommissionRub: 0.5,
          estimatedSlippageRub: 0.5,
          netRewardRub: 11.5,
          rewardToRisk: 1.64,
        },
        market: { bestBid: 99.99, bestAsk: 100, spreadPct: 0.01 },
        candleAnalysis: { trend: 'up', relativeVolume: 1.2, averageTrueRange14: 0.3 },
      },
    };

    const svg = buildCandidateCardSvg(scenario, config);

    expect(svg).toContain('SBER &lt;main&gt;');
    expect(svg).toContain('МАКС. РИСК С ЗАТРАТАМИ');
    expect(svg).toContain('КОМИССИЯ + ПРОСКАЛЬЗЫВАНИЕ');
    expect(svg).toContain('РУЧНАЯ ПРОВЕРКА');
  });
});

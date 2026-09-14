import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import type { JournalScenarioRecord } from '../journal/scenario-journal.js';
import { buildCandidateCardSvg } from './candidate-card.js';

describe('buildCandidateCardSvg', () => {
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

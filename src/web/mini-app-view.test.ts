import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { buildMiniAppView } from './mini-app-view.js';
import type { IntradayScanner } from '../scanner/intraday-scanner.js';

describe('Mini App safe view', () => {
  it.each([
    ['trend-momentum-v1', '2026-10-03T13:39:00Z', '2026-10-03T13:40:00Z'],
    ['opening-range-breakout-v1', '2026-10-03T08:39:00Z', '2026-10-03T08:40:00Z'],
  ] as const)('does not present an expired %s entry as an actionable signal', (strategyId, observedAt, nowAt) => {
    const directory = mkdtempSync(join(tmpdir(), 'trading-mini-window-'));
    try {
      const config = loadConfig({});
      const journal = new ScenarioJournal(join(directory, 'journal.sqlite'));
      const selection = { strategyId, revision: 1, tickers: ['SBER'] };
      journal.record({ observedAt, strategy: 'intraday', instrumentId: 'internal-uid',
        input: { side: 'long', entryPrice: 100, stopPrice: 99, targetPrice: 104, lotSize: 1, slippageRate: 0.0005 },
        decision: 'candidate', warnings: [], blockers: [], snapshot: { source: 'intraday-scanner', instrument: { ticker: 'SBER' },
          tradingSelection: selection, tradingStrategy: { id: strategyId, version: '1', referenceStartMinutes: 550 } } });
      const report = { observedAt, scanned: 1, errors: 0, strategyId, selectionRevision: 1,
        recommendations: [{ ticker: 'SBER', status: 'signal', reasons: [], score: 100,
          entryPrice: 100, stopPrice: 99, targetPrice: 104, totalRiskRub: 2, netRewardRub: 3 }] } as unknown as NonNullable<ReturnType<IntradayScanner['getLatestReport']>>;
      const view = buildMiniAppView(config, { isPaused: () => false, getLatestReport: () => report,
        getTradingSelection: () => selection, getAvailableTickers: () => ['SBER'] },
      { mode: () => 'disabled', isKilled: () => true }, journal, new Date(nowAt));
      expect(view.scanner.fresh).toBe(true);
      expect(view.candidates).toEqual([]);
      expect(view.recommendations?.[0]).toMatchObject({ status: 'blocked', entryPrice: null, stopPrice: null,
        targetPrice: null, totalRiskRub: null, netRewardRub: null });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('does not expose raw snapshots, stale/future candidates, IDs or credentials', () => {
    const directory = mkdtempSync(join(tmpdir(), 'trading-mini-view-'));
    try {
      const config = loadConfig({ T_INVEST_TOKEN: 'read-secret', TELEGRAM_BOT_TOKEN: 'bot-secret' });
      const journal = new ScenarioJournal(join(directory, 'journal.sqlite'));
      const now = new Date('2026-09-30T19:00:00Z');
      for (const at of ['2026-09-30T18:55:00Z', '2026-09-30T18:00:00Z', '2026-09-30T19:01:00Z']) journal.record({ observedAt: at,
        strategy: 'intraday', instrumentId: 'internal-uid', input: { side: 'long', entryPrice: 100, stopPrice: 99, targetPrice: 104, lotSize: 1, slippageRate: 0.0005 },
        decision: 'candidate', warnings: [], blockers: [], snapshot: { instrument: { ticker: 'SBER' }, token: 'raw-secret', accountId: 'private-account' } });
      const view = buildMiniAppView(config, { isPaused: () => false, getLatestReport: () => null }, { mode: () => 'disabled', isKilled: () => true }, journal, now);
      expect(view.candidates).toHaveLength(1); expect(view.candidates[0]?.ticker).toBe('SBER');
      expect(view.scanner.fresh).toBe(false); expect(view.execution.actualPnlRub).toBeNull();
      expect(JSON.stringify(view)).not.toMatch(/secret|private-account|internal-uid/);
      expect(view.execution.liveSubmissionAllowed).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('projects recommendations without IDs and only shows candidates from the current full selection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'trading-mini-selection-'));
    try {
      const config = loadConfig({ T_INVEST_TOKEN: 'read-secret' });
      const journal = new ScenarioJournal(join(directory, 'journal.sqlite'));
      const now = new Date('2026-10-03T10:00:00Z');
      const selection = { strategyId: 'vwap-reclaim-v1' as const, revision: 4, tickers: ['SBER', 'VTBR'] };
      for (const [ticker, selected] of [
        ['SBER', selection], ['SBER', { ...selection, revision: 3 }],
        ['SBER', { ...selection, strategyId: 'trend-momentum-v1' }], ['GAZP', selection], ['SBER', undefined],
      ] as const) journal.record({ observedAt: '2026-10-03T09:59:00Z', strategy: 'intraday', instrumentId: 'internal-uid',
        input: { side: 'long', entryPrice: 100, stopPrice: 99, targetPrice: 104, lotSize: 1, slippageRate: 0.0005 },
        decision: 'candidate', warnings: [], blockers: [], snapshot: { instrument: { ticker }, tradingSelection: selected } });
      const report = { observedAt: '2026-10-03T09:59:00Z', scanned: 2, errors: 0,
        strategyId: selection.strategyId, selectionRevision: selection.revision, recommendations: [
          { ticker: 'SBER', instrumentId: 'private-uid', status: 'signal', reasons: ['Plan for private-uid'], score: 82,
            lotCostRub: 100, roundTripCostsRub: 0.7, totalRiskRub: 3, netRewardRub: 6,
            entryPrice: 100, stopPrice: 99, targetPrice: 104, accountId: 'private-account' },
          { ticker: 'VTBR', instrumentId: 'error-uid', status: 'error', reasons: ['private-error-details'], score: 0 },
          { ticker: 'GAZP', instrumentId: 'other-uid', status: 'signal', reasons: [], score: 99 },
        ] } as unknown as NonNullable<ReturnType<IntradayScanner['getLatestReport']>>;
      const view = buildMiniAppView(config, { isPaused: () => false, getLatestReport: () => report,
        getTradingSelection: () => selection, getAvailableTickers: () => ['SBER', 'VTBR', 'GAZP'] },
      { mode: () => 'disabled', isKilled: () => true }, journal, now);
      expect(view.candidates).toHaveLength(1);
      expect(view.tradingSelection).toEqual(selection);
      expect(view.strategies?.every(strategy => strategy.evidence === 'unvalidated')).toBe(true);
      expect(view.recommendations?.map(item => item.ticker)).toEqual(['SBER', 'VTBR']);
      expect(view.recommendations?.[0]).toMatchObject({ score: 82, netRewardRub: 6, reasons: ['Plan for инструмент'] });
      expect(JSON.stringify(view)).not.toMatch(/private-uid|error-uid|other-uid|private-account|private-error-details|instrumentId/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('replaces stale selection recommendations with waiting indicators for every selected asset', () => {
    const directory = mkdtempSync(join(tmpdir(), 'trading-mini-stale-selection-'));
    try {
      const config = loadConfig({ T_INVEST_TOKEN: 'read-secret' });
      const journal = new ScenarioJournal(join(directory, 'journal.sqlite'));
      const now = new Date('2026-10-03T10:00:00Z');
      const selection = { strategyId: 'opening-range-breakout-v1' as const, revision: 2, tickers: ['VTBR', 'SBER'] };
      const report = { observedAt: '2026-10-03T09:59:00Z', scanned: 2, errors: 0,
        strategyId: 'trend-momentum-v1', selectionRevision: 1,
        recommendations: [{ ticker: 'VTBR', status: 'signal', score: 100, netRewardRub: 999 }] } as unknown as NonNullable<ReturnType<IntradayScanner['getLatestReport']>>;
      const view = buildMiniAppView(config, { isPaused: () => false, getLatestReport: () => report,
        getTradingSelection: () => selection, getAvailableTickers: () => ['VTBR', 'SBER'] },
      { mode: () => 'disabled', isKilled: () => true }, journal, now);
      expect(view.scanner.fresh).toBe(false);
      expect(view.recommendations?.map(item => [item.ticker, item.status, item.netRewardRub])).toEqual([
        ['VTBR', 'wait', null], ['SBER', 'wait', null],
      ]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

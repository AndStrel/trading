import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { buildMiniAppView } from './mini-app-view.js';

describe('Mini App safe view', () => {
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
});

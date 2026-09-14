import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { ScenarioJournal } from './scenario-journal.js';

const temporaryDirectories: string[] = [];

function createJournal() {
  const directory = mkdtempSync(join(tmpdir(), 'andstrel-journal-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'private', 'journal.sqlite');
  return { journal: new ScenarioJournal(path), path };
}

function scenario(strategy: 'intraday' | 'swing', note?: string) {
  return {
    observedAt: '2026-09-14T10:00:00.000Z',
    strategy,
    instrumentId: 'BBG004730N88',
    input: {
      side: 'long' as const,
      entryPrice: 300,
      stopPrice: 295,
      targetPrice: 315,
      lotSize: 10,
      slippageRate: 0.0005,
    },
    decision: 'candidate' as const,
    blockers: [],
    warnings: ['Entry price differs from the last price'],
    snapshot: {
      input: { slippageRate: 0.0005 },
      tradePlan: { allowed: true },
      market: { spreadPct: 0.03 },
    },
    ...(note ? { note } : {}),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ScenarioJournal', () => {
  it('records and filters local scenario snapshots without any broker token', () => {
    const { journal } = createJournal();

    const intraday = journal.record(scenario('intraday', 'Morning setup'));
    const swing = journal.record(scenario('swing'));

    expect(intraday.id).toBe(1);
    expect(intraday.recordedAt).toMatch(/Z$/);
    expect(journal.list(10).map((record) => record.id)).toEqual([swing.id, intraday.id]);
    expect(journal.list(10, 'intraday')).toHaveLength(1);
    expect(journal.list(10, 'intraday')[0]).toMatchObject({
      strategy: 'intraday',
      note: 'Morning setup',
      input: { slippageRate: 0.0005 },
    });
  });


  it('persists a paper trade lifecycle and prevents duplicate scenario entries', () => {
    const { journal } = createJournal();
    const recorded = journal.record(scenario('intraday'));

    const opened = journal.openPaperTrade({
      scenarioId: recorded.id,
      strategy: recorded.strategy,
      instrumentId: recorded.instrumentId,
      side: 'long',
      lots: 1,
      units: 10,
      entryMarketPrice: 100,
      entryFillPrice: 100.1,
      entryCommissionRub: 0.5,
      entrySlippageRub: 1,
      commissionRate: 0.0005,
      slippageRate: 0.001,
    });

    expect(journal.listPaperTrades(10, 'open')).toHaveLength(1);
    expect(() => journal.openPaperTrade({ ...opened, scenarioId: recorded.id })).toThrow(
      'A paper trade already exists for this scenario',
    );

    const closed = journal.closePaperTrade({
      id: opened.id,
      exitMarketPrice: 110,
      exitFillPrice: 109.89,
      exitCommissionRub: 0.55,
      exitSlippageRub: 1.1,
      grossPnlRub: 97.9,
      totalCommissionRub: 1.05,
      totalSlippageRub: 2.1,
      netPnlRub: 96.85,
      closeNote: 'Target reached',
    });

    expect(closed).toMatchObject({
      status: 'closed',
      grossPnlRub: 97.9,
      netPnlRub: 96.85,
      closeNote: 'Target reached',
    });
    expect(journal.listPaperTrades(10, 'open')).toEqual([]);
  });


  it('filters closed paper trades by an ISO time window', () => {
    const { journal } = createJournal();
    const recorded = journal.record(scenario('swing'));
    const opened = journal.openPaperTrade({
      scenarioId: recorded.id,
      strategy: recorded.strategy,
      instrumentId: recorded.instrumentId,
      side: 'long',
      lots: 1,
      units: 10,
      entryMarketPrice: 100,
      entryFillPrice: 100.1,
      entryCommissionRub: 0.5,
      entrySlippageRub: 1,
      commissionRate: 0.0005,
      slippageRate: 0.001,
    });
    journal.closePaperTrade({
      id: opened.id,
      exitMarketPrice: 110,
      exitFillPrice: 109.89,
      exitCommissionRub: 0.55,
      exitSlippageRub: 1.1,
      grossPnlRub: 97.9,
      totalCommissionRub: 1.05,
      totalSlippageRub: 2.1,
      netPnlRub: 96.85,
    });

    expect(
      journal.listClosedPaperTrades(
        new Date(Date.now() - 60_000).toISOString(),
        new Date(Date.now() + 60_000).toISOString(),
        'swing',
      ),
    ).toHaveLength(1);
    expect(
      journal.listClosedPaperTrades(
        new Date(Date.now() - 60_000).toISOString(),
        new Date(Date.now() + 60_000).toISOString(),
        'intraday',
      ),
    ).toEqual([]);
  });

  it('persists scanner pause and Telegram update state', () => {
    const { journal } = createJournal();

    expect(journal.isScannerPaused('intraday')).toBe(false);
    journal.setScannerPaused('intraday', true);
    journal.setTelegramUpdateOffset(42);

    expect(journal.isScannerPaused('intraday')).toBe(true);
    expect(journal.getTelegramUpdateOffset()).toBe(42);
    expect(() => journal.setTelegramUpdateOffset(-1)).toThrow('Telegram update offset');
  });

  it('restricts the database and its directory to the current user', () => {
    const { journal, path } = createJournal();

    journal.record(scenario('intraday'));

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  });
});

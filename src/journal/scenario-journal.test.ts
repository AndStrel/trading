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

  it('restricts the database and its directory to the current user', () => {
    const { journal, path } = createJournal();

    journal.record(scenario('intraday'));

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  });
});

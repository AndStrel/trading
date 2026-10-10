import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MarketDataStore } from './history/market-data-store.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'trading-catalog-gate-'));
  directories.push(directory);
  const path = join(directory, 'data.sqlite');
  const store = new MarketDataStore(path);
  store.importMinuteArchive({
    instrumentId: 'test', ticker: 'SBER', year: 2025, archiveSha256: 'a'.repeat(64), lotSize: 1, priceStep: 0.01,
    source: 'moex', rawRowCount: 1, invalidRowCount: 0,
    candles: [{ instrumentId: 'test', time: '2025-01-03T07:00:00.000Z', open: 1, close: 1, high: 1, low: 1, volume: 1 }],
  });
  return { path, store };
}

function run(path: string, tickers: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/research-catalog.ts', '--year', '2025', '--ticker', tickers], {
    encoding: 'utf8', timeout: 10_000,
    env: { PATH: process.env.PATH, T_INVEST_MARKET_DATA_PATH: path },
  });
}

describe('catalog acceptance gate CLI', () => {
  it('fails instead of reporting complete when one requested ticker is absent', () => {
    const { path } = fixture();
    const result = run(path, 'SBER,GAZP');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GAZP/2025');
    expect(result.stdout).not.toContain('"status":"complete"');
  });
  it('fails instead of cataloging a partial year', () => {
    const { path, store } = fixture();
    const result = run(path, 'SBER');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('missing-months');
    expect(result.stdout).not.toContain('"status":"complete"');
    expect(store.countResearchSituations({ datasetVersion: 'situation-v2' })).toBe(0);
  });
});

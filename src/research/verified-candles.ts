import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { HistoricalMinuteCandle } from '../history/market-data-store.js';

export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Coverage = { ticker: string; year: number; candles: number; sourceSha256: string; candleContentSha256: string };
// The prior, reproducibly verified report pins both provenance and actual candle content.
export function loadVerifiedCandles() {
  const prior = readFileSync('.trading/hourly-trend-v1.json');
  if (digest(prior) !== '2b374f0fff96438ded678ead3b62befb0482ad8c5718f4c2d1f12dd8479e41d3') throw new Error('Reviewed source snapshot changed');
  const coverage = (JSON.parse(prior.toString()) as { coverage: Coverage[] }).coverage;
  if (coverage.length !== 6 || new Set(coverage.map((a) => `${a.ticker}:${a.year}`)).size !== 6) throw new Error('Invalid source snapshot');
  const db = new DatabaseSync('.trading/market-data.sqlite', { readOnly: true });
  try {
    db.exec('BEGIN');
    return coverage.map((a) => {
      const imports = db.prepare(`SELECT instrument_id id, archive_sha256 sha, invalid_row_count invalid,
        duplicate_row_count duplicates FROM historical_archive_imports WHERE ticker=? AND source_year=?`)
        .all(a.ticker, a.year) as { id: string; sha: string; invalid: number; duplicates: number }[];
      if (imports.length !== 1 || imports[0]!.sha !== a.sourceSha256 || imports[0]!.invalid || imports[0]!.duplicates) throw new Error('Source provenance changed');
      const candles = db.prepare(`SELECT instrument_id instrumentId, candle_time time, open, high, low, close, volume
        FROM historical_minute_candles WHERE instrument_id=? AND source_year=? ORDER BY candle_time`)
        .all(imports[0]!.id, a.year) as unknown as HistoricalMinuteCandle[];
      if (candles.length !== a.candles || digest(JSON.stringify(candles)) !== a.candleContentSha256) throw new Error('Source candle content changed');
      return { ...a, data: candles };
    });
  } finally { db.close(); }
}

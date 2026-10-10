import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { HistoricalMinuteCandle } from './history/market-data-store.js';
import { hourlySamples, fitTrend, predictTrend, evaluateHourly, primaryGate, type HourlySample } from './research/hourly-trend.js';

const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const protocolSha256 = hash(readFileSync('docs/HOURLY_TREND_V1.md'));
if (protocolSha256 !== '0d1f4419dc46c0ae0e74164433dd33f38f5736f905fb1202c44dcd0d3e886efc') {
  throw new Error('Frozen hourly-v1 protocol changed; use a separately reviewed experiment');
}
// Reviewed input snapshots. A changed source requires explicit re-verification, not a silent rerun.
const expected: Record<string, string> = {
  'GAZP:2023': 'd59a94bee5ed4fccf19a3bf435ea95852bb9a9fd02a28d8116fcf2bb54bf3eeb',
  'SBER:2023': '34fabbc21a04b94d300277713cb2097ebc794c6a21f03d6787c3229ff76f922c',
  'GAZP:2024': 'a7e3a484f09b164e3552eb284e8892a59c023e6950ad33745525b4aec6f5f836',
  'SBER:2024': '7b01881fc93e7c635a6e5250edeeffbcbc8c64805b655e58c8f01688ebb476e1',
  'GAZP:2025': 'd82a9cc4df28dced468e4205f97071949fd3a5decd1bbd2be131529e459de4fb',
  'SBER:2025': '30a96134305860a244aa71952fbfe3fe56f0341b10c56f4114ec980c84322d2f',
};
const manifest = JSON.parse(readFileSync('.trading/reconciliation-manifest.json', 'utf8')) as {
  normalizedArchiveSha256: string; rawMoexDaySha256: string; referenceSha256: string };
if (manifest.normalizedArchiveSha256 !== expected['GAZP:2025'] ||
  hash(readFileSync('.trading/gazp-oct27-moex-raw.json')) !== manifest.rawMoexDaySha256 ||
  hash(readFileSync('.trading/gazp-oct27-tinvest.json')) !== manifest.referenceSha256) throw new Error('Reconciliation evidence mismatch');

const samples: HourlySample[] = [];
const coverage: unknown[] = [];
const db = new DatabaseSync('.trading/market-data.sqlite', { readOnly: true });
try {
  db.exec('BEGIN'); // Consistent read-only snapshot across all six sources.
  for (const ticker of ['SBER', 'GAZP']) for (const year of [2023, 2024, 2025]) {
    const archives = db.prepare(`SELECT instrument_id id, archive_sha256 sha, stored_candle_count count,
      raw_row_count raw, invalid_row_count invalid, duplicate_row_count duplicates
      FROM historical_archive_imports WHERE ticker=? AND source_year=?`).all(ticker, year) as unknown as
      { id: string; sha: string; count: number; raw: number; invalid: number; duplicates: number }[];
    if (archives.length !== 1) throw new Error(`Missing/ambiguous archive ${ticker}:${year}`);
    const a = archives[0]!;
    if (a.sha !== expected[`${ticker}:${year}`] || a.invalid || a.duplicates || a.raw !== a.count) throw new Error('Unaccepted source archive');
    const candles = db.prepare(`SELECT instrument_id instrumentId, candle_time time, open, high, low, close, volume
      FROM historical_minute_candles WHERE instrument_id=? AND source_year=? AND source_archive_sha256=?
      ORDER BY candle_time`).all(a.id, year, a.sha) as unknown as HistoricalMinuteCandle[];
    if (candles.length !== a.count || candles.some((c) => !c.time.startsWith(String(year)))) throw new Error('Source row count/year mismatch');
    const data = hourlySamples(ticker, candles);
    samples.push(...data.samples);
    coverage.push({ ticker, year, sourceSha256: a.sha, candleContentSha256: hash(JSON.stringify(candles)),
      candles: candles.length, observedDays: data.observedDays, missingHistory: data.missingHistory,
      decisions: data.samples.length, missingOutcome: data.samples.filter((s) => !s.outcome).length });
  }
} finally { db.close(); }
samples.sort((a, b) => a.decisionAt.localeCompare(b.decisionAt) || a.ticker.localeCompare(b.ticker));
const models = ['always-long', 'momentum', 'logistic', 'mlp'] as const;
const comparisons = models.map((kind) => {
  const years = [2024, 2025].map((year) => {
    const cutoff = `${year}-01-01T00:00:00.000Z`;
    const train = samples.filter((s) => s.terminalAt < cutoff && s.outcome !== null);
    const test = samples.filter((s) => s.day.startsWith(String(year)));
    const model = kind === 'logistic' || kind === 'mlp' ? fitTrend(kind, train, cutoff) : null;
    const predict = (features: number[]) => model ? predictTrend(model, features) :
      kind === 'always-long' ? 1 : Number(features[0]! > 0 && features[1]! > 0);
    const result = evaluateHourly(test, predict, 0.55);
    return { year, trainCount: train.length, trainingEnd: train.at(-1)?.terminalAt, model, ...result };
  });
  return { kind, ...primaryGate(years), years };
});
const report = {
  experiment: 'hourly-trend-v1', interpretation: 'Research event returns, NOT portfolio returns or independent holdout.',
  protocolSha256,
  codeSha256: hash(Buffer.concat(['src/research-hourly-trend.ts', 'src/research/hourly-trend.ts',
    'src/research/similarity-experiment.ts'].map((p) => readFileSync(p)))),
  coverage, comparisons,
};
writeFileSync('.trading/hourly-trend-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ...report, comparisons: comparisons.map((c) => ({ ...c,
  years: c.years.map(({ predictions, trades, model, ...summary }) => ({ ...summary,
    predicted: predictions.length, executed: trades.length, modelKind: model?.kind ?? null })) })) }, null, 2));

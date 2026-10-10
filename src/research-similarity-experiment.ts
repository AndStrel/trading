import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { MarketDataStore } from './history/market-data-store.js';
import { analoguePrediction, netReturnPct, summarizeSignals, type Observation, type SignalResult } from './research/similarity-experiment.js';

// Deliberately fixed: see docs/SIMILARITY_EXPERIMENT_V1.md. No optimizer or orders.
const store = new MarketDataStore('.trading/market-data.sqlite');
const manifest = JSON.parse(readFileSync('.trading/reconciliation-manifest.json', 'utf8')) as {
  normalizedArchiveSha256: string; rawMoexDaySha256: string; referenceSha256: string };
for (const [path, hash] of [['.trading/gazp-oct27-moex-raw.json', manifest.rawMoexDaySha256],
  ['.trading/gazp-oct27-tinvest.json', manifest.referenceSha256]]) {
  if (createHash('sha256').update(readFileSync(path!)).digest('hex') !== hash) throw new Error('Reconciliation evidence changed');
}
const archives = [2023, 2024, 2025].flatMap((year) => store.listArchiveImports(year).filter((a) => ['SBER', 'GAZP'].includes(a.ticker ?? '')));
if (archives.length !== 6 || archives.some((a) => a.invalidRowCount || a.duplicateRowCount)) throw new Error('Unaccepted/missing source archives');
if (archives.find((a) => a.ticker === 'GAZP' && a.year === 2025)?.archiveSha256 !== manifest.normalizedArchiveSha256) {
  throw new Error('Reconciled source was replaced; repeat independent verification');
}
const db = new DatabaseSync('.trading/market-data.sqlite', { readOnly: true });
const trades: SignalResult[] = [];
const incomplete: { ticker: string; day: string; entryAt: string }[] = [];
let evaluated = 0, insufficientHistory = 0, signaled = 0;
for (const ticker of ['SBER', 'GAZP']) {
  const rows = db.prepare(`SELECT s.session_date day, s.observed_at observedAt, s.feature_available_at availableAt,
    s.feature_vector_json vector, o.terminal_at terminalAt, o.forward_return_pct forwardReturnPct
    FROM research_situations s LEFT JOIN research_outcomes o ON o.situation_id=s.situation_id AND o.horizon_minutes=60
    WHERE s.dataset_version='situation-v2' AND s.ticker=? AND s.source_year IN (2023,2024,2025)
    ORDER BY s.observed_at`).all(ticker) as unknown as Array<Omit<Observation, 'ticker' | 'vector'> & { vector: string }>;
  const observations: Observation[] = rows.map((r) => ({ ...r, ticker, vector: JSON.parse(r.vector) as number[] }));
  const byDay = new Map<string, Observation[]>();
  for (const r of observations) { const day = byDay.get(r.day) ?? []; day.push(r); byDay.set(r.day, day); }
  const dates = [...byDay.keys()].sort();
  const signaledDays = new Set<string>();
  for (const year of [2024, 2025]) {
    const archive = archives.find((a) => a.ticker === ticker && a.year === year)!;
    const candles = new Map(store.listMinuteCandles({ instrumentId: archive.instrumentId,
      from: `${year}-01-01T00:00:00.000Z`, to: `${year + 1}-01-01T00:00:00.000Z` }).map((c) => [c.time, c]));
    for (const day of dates.filter((d) => d.startsWith(String(year)))) {
      const prior = dates.filter((d) => d < day).slice(-60).map((d) => byDay.get(d)!);
      for (const target of byDay.get(day)!) {
        const at = new Date(Date.parse(target.availableAt) + 3 * 3600_000);
        if (at.getUTCMinutes() !== 30 || at.getUTCHours() < 10 || at.getUTCHours() > 16 || signaledDays.has(day)) continue;
        evaluated++;
        const prediction = analoguePrediction(target, prior);
        if (prediction === null) { insufficientHistory++; continue; }
        if (prediction <= 0.30) continue;
        signaled++; signaledDays.add(day);
        const entryAt = target.availableAt;
        const window = Array.from({ length: 60 }, (_, i) => candles.get(new Date(Date.parse(entryAt) + i * 60_000).toISOString()));
        if (window.some((c) => !c)) { incomplete.push({ ticker, day, entryAt }); continue; }
        const entry = window[0]!.open, exit = window[59]!.close;
        trades.push({ ticker, day, entryAt, predictedPct: prediction, entry, exit,
          grossPct: (exit / entry - 1) * 100, netPct: netReturnPct(entry, exit, 0.0005),
          stressPct: netReturnPct(entry, exit, 0.001), extremePct: netReturnPct(entry, exit, 0.0015) });
      }
    }
  }
}
db.close();
const summaries = [2024, 2025].map((year) => {
  const selected = trades.filter((t) => t.day.startsWith(String(year)));
  return { year, base: summarizeSignals(selected, 'netPct'), stress: summarizeSignals(selected, 'stressPct'), extreme: summarizeSignals(selected, 'extremePct') };
});
const combined = summarizeSignals(trades, 'netPct');
const rejected = incomplete.length > 0 || combined.trades < 100 || combined.days < 50 || summaries.some((s) =>
  [s.base, s.stress].some((m) => m.averageNetPct === null || m.averageNetPct <= 0 || m.profitFactor === null || m.profitFactor <= 1 ||
    m.withoutBestDaySumPct <= 0 || m.withoutBestTickerSumPct <= 0));
const report = { strategy: 'similarity-baseline-v1', status: rejected ? 'rejected-at-primary-gate' : 'eligible-for-portfolio-test',
  interpretation: 'Research event returns, NOT portfolio returns or an independent holdout. Incomplete signals invalidate full-performance claims.',
  protocolSha256: createHash('sha256').update(readFileSync('docs/SIMILARITY_EXPERIMENT_V1.md')).digest('hex'),
  archives: archives.map((a) => ({ ticker: a.ticker, year: a.year, sha256: a.archiveSha256 })),
  evaluated, insufficientHistory, signaled, incomplete, combined, summaries, trades };
writeFileSync('.trading/similarity-baseline-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ...report, trades: undefined }, null, 2));

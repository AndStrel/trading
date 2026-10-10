import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { MarketDataStore } from './history/market-data-store.js';
import { reconcileMoexDay } from './research/reconcile-candles.js';

// Narrow, evidence-backed repair. Never infer volume units for unrelated dates.
const apply = process.argv.slice(2).includes('--apply');
if (process.argv.slice(2).some((arg) => arg !== '--apply')) throw new Error('Only --apply is supported; default is dry run');
const store = new MarketDataStore('.trading/market-data.sqlite');
const archive = store.listArchiveImports(2025).find((a) => a.ticker === 'GAZP');
if (!archive || archive.source !== 'moex' || archive.lotSize !== 10 || archive.priceStep === null) throw new Error('Unexpected archive metadata');
const rawPath = '.trading/gazp-oct27-moex-raw.json', refPath = '.trading/gazp-oct27-tinvest.json';
const raw = JSON.parse(readFileSync(rawPath, 'utf8')) as { columns: string[]; rows: unknown[][] };
const reference = JSON.parse(readFileSync(refPath, 'utf8')) as { candles: Parameters<typeof reconcileMoexDay>[0]['reference'] };
const result = reconcileMoexDay({ instrumentId: archive.instrumentId, lotSize: 10, ...raw, reference: reference.candles });
if (result.candles.some((c) => !c.time.startsWith('2025-10-27')) || result.candles.length !== 996 || result.corrections.length !== 64) {
  throw new Error('Independent evidence differs from the reviewed day');
}
const old = store.listMinuteCandles({ instrumentId: archive.instrumentId, from: '2025-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' });
const candles = old.filter((c) => !c.time.startsWith('2025-10-27')).concat(result.candles).sort((a, b) => a.time.localeCompare(b.time));
if (candles.length !== archive.rawRowCount) throw new Error('Restored coverage differs from source row count');
const digest = createHash('sha256').update('moex-iss:TQBR:GAZP:2025\n');
for (const c of candles) digest.update(`${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume}\n`);
const normalizedArchiveSha256 = digest.digest('hex');
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
if (normalizedArchiveSha256 === archive.archiveSha256) {
  console.log(JSON.stringify({ status: 'already-reconciled', normalizedArchiveSha256 }));
} else {
  if (archive.archiveSha256 !== 'c9439b9e9d94560bb9235d07cba85fdd97b180fdb166c38b9d5de15ef65215bf') throw new Error('Unexpected original source hash');
  const manifest = { ticker: 'GAZP', year: 2025, originalArchiveSha256: archive.archiveSha256,
    normalizedArchiveSha256, rawMoexDaySha256: sha(rawPath), referenceSha256: sha(refPath), corrections: result.corrections };
  if (apply) {
    if (!existsSync('.trading/before-reconciliation.sqlite')) {
      const db = new DatabaseSync('.trading/market-data.sqlite');
      db.exec("VACUUM INTO '.trading/before-reconciliation.sqlite'"); db.close();
    }
    writeFileSync('.trading/reconciliation-manifest.json', JSON.stringify(manifest, null, 2), { mode: 0o600 });
    store.importMinuteArchive({ ...archive, ticker: 'GAZP', lotSize: 10, priceStep: archive.priceStep,
      archiveSha256: normalizedArchiveSha256, candles, invalidRowCount: 0, duplicateRowCount: 0 });
  }
  console.log(JSON.stringify({ status: apply ? 'reconciled' : 'dry-run', ...manifest }));
}

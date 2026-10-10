import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { parseSiCandlePage, validateSiDayCandles, type SiCandle } from './research/si-first-hour.js';
import { evaluateSiClearingBreakGapFade, summarizeSiClearingGap, type ClearingGapDecision, type ClearingGapDaySpec } from './research/si-clearing-break-gap-fade.js';

type RawPage = { sha256: string; body: string };
type CachedDay = { version: 1; date: string; contract: string; pages: RawPage[] };
type DaySource = ClearingGapDaySpec & { rawFileSha256: string; pageHashes: string[]; candleCount: number };

const sourceDir = join(process.cwd(), '.trading', 'si-opening-breakout-v1');
const protocolPath = join(process.cwd(), 'docs', 'SI_CLEARING_BREAK_GAP_FADE_2023_2024_V1.md');
const outputPath = join(process.cwd(), '.trading', 'si-clearing-break-gap-fade-2023-2024-v1.json');
const protocolHash = 'e398534fc0b6c1ce06410c22cdb04084aba2f2e1a133f95831abd943efde77ac';
const inventoryHash = 'bcffb767570bf75bd61c922494dd80d15739563773cb600dd0cd5532498ca5a3';
const verifiedNoSession = new Set(['2024-11-04']);
const specialHolidaySession = new Set(['2023-11-06']);

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function buildSpecs(): ClearingGapDaySpec[] {
  const ranges = [
    { first: '2023-07-03', last: '2023-12-08', change: '2023-09-11', before: 'SiU3', after: 'SiZ3' },
    { first: '2024-07-01', last: '2024-12-10', change: '2024-09-11', before: 'SiU4', after: 'SiZ4' },
  ];
  const days: ClearingGapDaySpec[] = [];
  for (const range of ranges) {
    for (let ms = Date.parse(`${range.first}T00:00:00Z`); ms <= Date.parse(`${range.last}T00:00:00Z`); ms += 86_400_000) {
      const date = new Date(ms);
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
      const isoDate = date.toISOString().slice(0, 10);
      days.push({ date: isoDate, contract: isoDate < range.change ? range.before : range.after });
    }
  }
  return days;
}

function assertArchiveInventory(files: string[]): void {
  const names = files.filter((file) => file.endsWith('.json.gz')).sort();
  const digest = createHash('sha256');
  for (const name of names) {
    const body = readFileSync(join(sourceDir, name));
    digest.update(`${name}\0${sha256(body)}\n`);
  }
  if (names.length !== 232 || digest.digest('hex') !== inventoryHash) {
    throw new Error('Frozen 2023–2024 Si archive inventory is missing or changed');
  }
}

function loadDay(spec: ClearingGapDaySpec): { candles: SiCandle[]; source: DaySource } {
  const filename = `${spec.date}.json.gz`;
  const compressed = readFileSync(join(sourceDir, filename));
  const cached = JSON.parse(gunzipSync(compressed).toString('utf8')) as CachedDay;
  if (cached.version !== 1 || cached.date !== spec.date || cached.contract !== spec.contract ||
      !Array.isArray(cached.pages) || cached.pages.length === 0) {
    throw new Error(`Invalid locked source snapshot for ${spec.date}`);
  }
  const candles: SiCandle[] = [];
  for (const page of cached.pages) {
    if (typeof page.body !== 'string' || page.sha256 !== sha256(page.body)) {
      throw new Error(`Raw page hash mismatch for ${spec.date}`);
    }
    candles.push(...parseSiCandlePage(JSON.parse(page.body) as unknown, spec.date));
  }
  validateSiDayCandles(candles, spec.date);
  if (candles.length > 421) throw new Error(`Unexpected source candle count for ${spec.date}: ${candles.length}`);
  return { candles, source: { ...spec, rawFileSha256: sha256(compressed), pageHashes: cached.pages.map((page) => page.sha256), candleCount: candles.length } };
}

function main(): void {
  if (process.argv.length !== 2) throw new Error('Offline replay takes no flags');
  if (!existsSync(protocolPath) || sha256(readFileSync(protocolPath)) !== protocolHash) {
    throw new Error('Frozen historical clearing-gap protocol is missing or changed');
  }
  const files = readdirSync(sourceDir);
  assertArchiveInventory(files);
  const sources: DaySource[] = [];
  const decisions: ClearingGapDecision[] = [];
  for (const spec of buildSpecs()) {
    const { candles, source } = loadDay(spec);
    sources.push(source);
    if (verifiedNoSession.has(spec.date)) {
      if (candles.length !== 0) throw new Error(`Verified no-session date has unexpected candles: ${spec.date}`);
      decisions.push({ ...spec, status: 'no_session' });
    } else if (specialHolidaySession.has(spec.date)) {
      if (candles.length === 0) throw new Error(`Scheduled special session has no source candles: ${spec.date}`);
      decisions.push({ ...spec, status: 'special_session' });
    } else {
      decisions.push(evaluateSiClearingBreakGapFade(spec, candles));
    }
  }
  const combined = summarizeSiClearingGap(decisions);
  const byYear = Object.fromEntries(['2023', '2024'].map((year) =>
    [year, summarizeSiClearingGap(decisions.filter((decision) => decision.date.startsWith(year)))]));
  const byContract = Object.fromEntries(['SiU3', 'SiZ3', 'SiU4', 'SiZ4'].map((contract) =>
    [contract, summarizeSiClearingGap(decisions.filter((decision) => decision.contract === contract))]));
  const passingGroups = [...Object.values(byYear), ...Object.values(byContract)];
  const completedTradeDates = new Set(decisions.filter((decision) => decision.status === 'trade').map((decision) => decision.date)).size;
  const status = combined.trades >= 100 && completedTradeDates >= 50 &&
    combined.statuses.unresolved_holding === 0 && combined.statuses.cancelled_entry === 0 &&
    combined.winRate !== null && combined.winRate >= 0.51 &&
    combined.meanBaseNet !== null && combined.meanBaseNet > 0 &&
    combined.meanStressNet !== null && combined.meanStressNet > 0 &&
    combined.profitFactor !== null && combined.profitFactor > 1 &&
    combined.withoutBestTradeSum !== null && combined.withoutBestTradeSum > 0 &&
    passingGroups.every((group) => group.trades > 0 && group.meanBaseNet !== null && group.meanBaseNet > 0)
      ? 'candidate-for-independent-check-only'
      : 'failed-or-insufficient-development-gate';
  const report = { status, protocolSha256: protocolHash, archiveInventorySha256: inventoryHash, completedTradeDates,
    sources, combined, byYear, byContract, decisions };
  const temporary = `${outputPath}.part`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, outputPath);
  console.log(JSON.stringify({ status, combined, byYear, byContract, outputPath }));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  try { main(); } catch (error) {
    console.error(`Historical Si clearing-gap research failed: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  }
}

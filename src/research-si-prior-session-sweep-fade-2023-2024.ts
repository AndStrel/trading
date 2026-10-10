import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { parseSiCandlePage, validateSiDayCandles, type SiCandle } from './research/si-first-hour.js';
import {
  evaluateSiPriorSessionSweepFade,
  summarizeSiPriorSessionSweepFade,
  type PriorSessionSweepDecision,
} from './research/si-prior-session-sweep-fade.js';

type Spec = { date: string; contract: string };
type RawPage = { sha256: string; body: string };
type CachedDay = { version: 1; date: string; contract: string; pages: RawPage[] };
type Source = Spec & { rawFileSha256: string; pageHashes: string[]; candleCount: number };

const sourceDir = join(process.cwd(), '.trading', 'si-opening-breakout-v1');
const protocolPath = join(process.cwd(), 'docs', 'SI_PRIOR_SESSION_SWEEP_FADE_2023_2024_V1.md');
const outputPath = join(process.cwd(), '.trading', 'si-prior-session-sweep-fade-2023-2024-v1.json');
const protocolHash = 'a67e5bb7cbd22aa944d52dc095ecc80c73b510f675c2539494608c75cef1b3ed';
const inventoryHash = 'bcffb767570bf75bd61c922494dd80d15739563773cb600dd0cd5532498ca5a3';
const noSessionDates = new Set(['2024-11-04']);
const specialDates = new Set(['2023-11-06']);

const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

function buildSpecs(): Spec[] {
  const ranges = [
    { first: '2023-07-03', last: '2023-12-08', change: '2023-09-11', before: 'SiU3', after: 'SiZ3' },
    { first: '2024-07-01', last: '2024-12-10', change: '2024-09-11', before: 'SiU4', after: 'SiZ4' },
  ];
  const specs: Spec[] = [];
  for (const range of ranges) {
    for (let ms = Date.parse(`${range.first}T00:00:00Z`); ms <= Date.parse(`${range.last}T00:00:00Z`); ms += 86_400_000) {
      const date = new Date(ms);
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
      const isoDate = date.toISOString().slice(0, 10);
      specs.push({ date: isoDate, contract: isoDate < range.change ? range.before : range.after });
    }
  }
  return specs;
}

function assertInventory(files: string[]): void {
  const names = files.filter((file) => file.endsWith('.json.gz')).sort();
  const digest = createHash('sha256');
  for (const name of names) {
    const body = readFileSync(join(sourceDir, name));
    digest.update(`${name}\0${sha256(body)}\n`);
  }
  if (names.length !== 232 || digest.digest('hex') !== inventoryHash) throw new Error('Frozen Si archive inventory is missing or changed');
}

function load(spec: Spec): { candles: SiCandle[]; source: Source } {
  const compressed = readFileSync(join(sourceDir, `${spec.date}.json.gz`));
  const cached = JSON.parse(gunzipSync(compressed).toString('utf8')) as CachedDay;
  if (cached.version !== 1 || cached.date !== spec.date || cached.contract !== spec.contract || !Array.isArray(cached.pages)) {
    throw new Error(`Invalid locked source snapshot for ${spec.date}`);
  }
  const candles: SiCandle[] = [];
  for (const page of cached.pages) {
    if (typeof page.body !== 'string' || page.sha256 !== sha256(page.body)) throw new Error(`Raw page hash mismatch for ${spec.date}`);
    candles.push(...parseSiCandlePage(JSON.parse(page.body) as unknown, spec.date));
  }
  validateSiDayCandles(candles, spec.date);
  return { candles, source: { ...spec, rawFileSha256: sha256(compressed), pageHashes: cached.pages.map((page) => page.sha256), candleCount: candles.length } };
}

function completeSession(candles: readonly SiCandle[], date: string): boolean {
  const byTime = new Set(candles.map((candle) => candle.time.slice(11, 16)));
  for (let minute = 600; minute <= 1019; minute += 1) {
    if (minute >= 840 && minute <= 844) continue;
    const key = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    if (!byTime.has(key)) return false;
  }
  return candles.some((candle) => candle.time.startsWith(`${date} `));
}

function main(): void {
  if (process.argv.length !== 2) throw new Error('Offline replay takes no flags');
  if (!existsSync(protocolPath) || sha256(readFileSync(protocolPath)) !== protocolHash) {
    throw new Error('Frozen sweep-fade protocol is missing or changed; pin its SHA-256 before running');
  }
  const files = readdirSync(sourceDir);
  assertInventory(files);
  const specs = buildSpecs();
  const sources: Source[] = [];
  const loaded = new Map<string, SiCandle[]>();
  for (const spec of specs) {
    const day = load(spec);
    sources.push(day.source);
    loaded.set(spec.date, day.candles);
  }

  const priorByContract = new Map<string, { date: string; candles: SiCandle[] }>();
  const decisions: PriorSessionSweepDecision[] = [];
  for (const spec of specs) {
    const candles = loaded.get(spec.date)!;
    if (noSessionDates.has(spec.date)) {
      if (candles.length !== 0) throw new Error(`No-session date has unexpected candles: ${spec.date}`);
      decisions.push({ ...spec, status: 'no_session' });
      continue;
    }
    if (specialDates.has(spec.date)) {
      if (candles.length === 0) throw new Error(`Special session has no source candles: ${spec.date}`);
      decisions.push({ ...spec, status: 'special_session' });
      continue;
    }
    if (candles.length === 0) {
      decisions.push({ ...spec, status: 'no_session' });
      continue;
    }
    const prior = priorByContract.get(spec.contract);
    if (!prior) {
      decisions.push({ ...spec, status: 'warmup' });
      priorByContract.set(spec.contract, { date: spec.date, candles });
      continue;
    }
    if (!completeSession(prior.candles, prior.date)) {
      decisions.push({ ...spec, status: 'missing_reference' });
      priorByContract.set(spec.contract, { date: spec.date, candles });
      continue;
    }
    const reference = prior.candles.filter((candle) => {
      const hm = candle.time.slice(11, 16);
      return hm >= '10:00' && hm <= '16:59' && !(hm >= '14:00' && hm <= '14:04');
    });
    const prevHigh = Math.max(...reference.map((candle) => candle.high));
    const prevLow = Math.min(...reference.map((candle) => candle.low));
    decisions.push(evaluateSiPriorSessionSweepFade({ ...spec, prevHigh, prevLow }, candles));
    priorByContract.set(spec.contract, { date: spec.date, candles });
  }

  const combined = summarizeSiPriorSessionSweepFade(decisions);
  const byYear = Object.fromEntries(['2023', '2024'].map((year) =>
    [year, summarizeSiPriorSessionSweepFade(decisions.filter((decision) => decision.date.startsWith(year)))]));
  const byContract = Object.fromEntries(['SiU3', 'SiZ3', 'SiU4', 'SiZ4'].map((contract) =>
    [contract, summarizeSiPriorSessionSweepFade(decisions.filter((decision) => decision.contract === contract))]));
  const groups = [...Object.values(byYear), ...Object.values(byContract)];
  const tradesDates = new Set(decisions.filter((decision) => decision.status === 'trade').map((decision) => decision.date)).size;
  const statuses = combined.statuses as Record<string, number>;
  const status = combined.trades >= 100 && tradesDates >= 50 &&
    statuses.missing_reference === 0 && statuses.missing_signal === 0 && statuses.cancelled_entry === 0 &&
    statuses.ambiguous_signal === 0 && statuses.unresolved_holding === 0 &&
    combined.winRate !== null && combined.winRate >= 0.51 && combined.meanBaseNet !== null && combined.meanBaseNet > 0 &&
    combined.meanStressNet !== null && combined.meanStressNet > 0 && combined.profitFactor !== null && combined.profitFactor > 1 &&
    combined.withoutBestTradeSum !== null && combined.withoutBestTradeSum > 0 &&
    groups.every((group) => group.trades > 0 && group.meanBaseNet !== null && group.meanBaseNet > 0)
      ? 'candidate-for-independent-check-only' : 'failed-or-insufficient-development-gate';
  const report = { status, protocolSha256: protocolHash, archiveInventorySha256: inventoryHash, completedTradeDates: tradesDates,
    sources, combined, byYear, byContract, decisions };
  const temporary = `${outputPath}.part`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, outputPath);
  console.log(JSON.stringify({ status, combined, byYear, byContract, outputPath }));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  try { main(); } catch (error) {
    console.error(`Historical Si sweep-fade research failed: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  }
}

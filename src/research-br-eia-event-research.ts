import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { parseSiCandlePage, validateSiDayCandles, type SiCandle } from './research/si-first-hour.js';
import { evaluateBrEiaEvent, summarizeBrEiaEvents, type BrEiaDecision, type BrEiaEventSpec } from './research/br-eia-event.js';

type EventSourceSpec = BrEiaEventSpec & { fromMinute: number; toMinute: number };
type RawPage = { sha256: string; body: string };
type CachedWindow = { version: 1; date: string; contract: string; releaseEastern: string; pages: RawPage[] };
type Source = Omit<EventSourceSpec, 'signalStartMinute'> & {
  signalStartMinute: number; rawFileSha256: string; pageHashes: string[]; candleCount: number;
};

const sourceDir = join(process.cwd(), '.trading', 'br-eia-event-source');
const sourceReportPath = join(process.cwd(), '.trading', 'br-eia-event-source.json');
const resultPath = join(process.cwd(), '.trading', 'br-eia-event-v1.json');
const protocolPath = join(process.cwd(), 'docs', 'BR_EIA_INVENTORY_REACTION_V1.md');
const protocolHash = '81a703c5c1ebb78dc0960de8863c82ef92a50b5fd7e9655982823edb1b8940db';

const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const pad = (value: number) => String(value).padStart(2, '0');
const timeKey = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
const etFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const mskFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function parts(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

export function easternToMoscow(date: string, hhmm: string): { date: string; minute: number } {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);
  const localAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const matches = [4, 5].map((offset) => new Date(localAsUtc + offset * 60 * 60_000))
    .filter((candidate) => {
      const p = parts(etFormatter, candidate);
      return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` === `${date} ${hhmm}`;
    });
  if (matches.length !== 1) throw new Error(`Cannot resolve America/New_York time ${date} ${hhmm}`);
  const msk = parts(mskFormatter, matches[0]!);
  return { date: `${msk.year}-${msk.month}-${msk.day}`, minute: Number(msk.hour) * 60 + Number(msk.minute) };
}

function dates(year: number, entries: Record<string, number[]>): string[] {
  return Object.entries(entries).flatMap(([month, days]) => days.map((day) => `${year}-${month}-${pad(day)}`));
}

export function buildBrEiaEvents(): EventSourceSpec[] {
  const dates2024 = dates(2024, {
    '01': [10, 24, 31], '02': [7, 14, 28], '03': [6, 13, 20, 27], '04': [3, 10, 17, 24],
    '05': [1, 8, 15, 22], '06': [5, 12, 26], '07': [3, 10, 17, 24, 31], '08': [7, 14, 21, 28],
    '09': [11, 18, 25], '10': [2, 9, 23, 30], '11': [6, 20, 27], '12': [4, 11, 18],
  });
  const dates2025 = dates(2025, {
    '01': [2, 8, 15, 23, 29], '02': [5, 12, 20, 26], '03': [5, 12, 19, 26],
    '04': [2, 9, 16, 23, 30], '05': [7, 14, 21, 29], '06': [4, 11, 18, 25],
    '07': [2, 9, 16, 23, 30], '08': [6, 13, 20, 27], '09': [4, 10, 17, 24],
  });
  const dates2026 = dates(2026, {
    '03': [25], '04': [1, 8, 15, 22, 29], '05': [6, 13, 20, 28], '06': [3, 10, 17, 24],
    '07': [1, 8, 15, 22, 29], '08': [5, 12, 19, 26], '09': [2, 10, 16, 23],
  });
  const timeOverrides = new Map<string, string>([
    ['2025-01-02', '11:00'], ['2025-01-23', '12:00'], ['2025-02-20', '12:00'],
    ['2025-05-29', '12:00'], ['2025-09-04', '12:00'],
    ['2026-05-28', '12:00'], ['2026-09-10', '12:00'],
  ]);
  const contractByMonth: Record<string, string> = {
    '2024-01': 'BRG4', '2024-02': 'BRH4', '2024-03': 'BRJ4', '2024-04': 'BRK4',
    '2024-05': 'BRM4', '2024-06': 'BRN4', '2024-07': 'BRQ4', '2024-08': 'BRU4',
    '2024-09': 'BRV4', '2024-10': 'BRX4', '2024-11': 'BRZ4', '2024-12': 'BRF5',
    '2025-01': 'BRG5', '2025-02': 'BRH5', '2025-03': 'BRJ5', '2025-04': 'BRK5',
    '2025-05': 'BRM5', '2025-06': 'BRN5', '2025-07': 'BRQ5', '2025-08': 'BRU5',
    '2025-09': 'BRV5', '2026-03': 'BRJ6', '2026-04': 'BRK6', '2026-05': 'BRM6',
    '2026-06': 'BRN6', '2026-07': 'BRQ6', '2026-08': 'BRU6', '2026-09': 'BRV6',
  };
  const calendar = [...dates2024, ...dates2025, ...dates2026].sort();
  if (calendar.length !== 109 || new Set(calendar).size !== calendar.length) throw new Error('Frozen EIA calendar count or uniqueness check failed');
  return calendar.map((date) => {
    const releaseEastern = timeOverrides.get(date) ?? '10:30';
    const moscow = easternToMoscow(date, releaseEastern);
    const signalStartMinute = moscow.minute + 5;
    const contract = contractByMonth[date.slice(0, 7)];
    if (!contract || moscow.date !== date || signalStartMinute + 65 >= 24 * 60) throw new Error(`Invalid event mapping for ${date}`);
    return { date, contract, releaseEastern, signalStartMinute, fromMinute: signalStartMinute, toMinute: signalStartMinute + 65 };
  });
}

function cachePath(date: string): string { return join(sourceDir, `${date}.json.gz`); }

function parseCached(spec: EventSourceSpec): { candles: SiCandle[]; cached: CachedWindow; rawFileSha256: string } {
  const compressed = readFileSync(cachePath(spec.date));
  const cached = JSON.parse(gunzipSync(compressed).toString('utf8')) as CachedWindow;
  if (cached.version !== 1 || cached.date !== spec.date || cached.contract !== spec.contract ||
      cached.releaseEastern !== spec.releaseEastern || !Array.isArray(cached.pages) || cached.pages.length !== 1) {
    throw new Error(`Invalid event source snapshot for ${spec.date}`);
  }
  const candles: SiCandle[] = [];
  for (const page of cached.pages) {
    if (typeof page.body !== 'string' || page.sha256 !== hash(page.body)) throw new Error(`Raw event page hash mismatch for ${spec.date}`);
    candles.push(...parseSiCandlePage(JSON.parse(page.body) as unknown, spec.date, { from: timeKey(spec.fromMinute), to: timeKey(spec.toMinute) }));
  }
  validateSiDayCandles(candles, spec.date);
  if (candles.length > 66) throw new Error(`Unexpected event-window candle count for ${spec.date}`);
  return { candles, cached, rawFileSha256: hash(compressed) };
}

async function fetchOne(spec: EventSourceSpec): Promise<void> {
  const from = `${spec.date} ${timeKey(spec.fromMinute)}:00`;
  const till = `${spec.date} ${timeKey(spec.toMinute)}:00`;
  const url = new URL(`https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/${spec.contract}/candles.json`);
  for (const [key, value] of Object.entries({ interval: '1', from, till, start: '0', 'iss.meta': 'off',
    'iss.only': 'candles', 'candles.columns': 'open,close,high,low,volume,begin' })) url.searchParams.set(key, value);
  let failure: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      const body = await response.text();
      parseSiCandlePage(JSON.parse(body) as unknown, spec.date, { from: timeKey(spec.fromMinute), to: timeKey(spec.toMinute) });
      const snapshot: CachedWindow = { version: 1, date: spec.date, contract: spec.contract, releaseEastern: spec.releaseEastern,
        pages: [{ sha256: hash(body), body }] };
      const temp = `${cachePath(spec.date)}.part`;
      writeFileSync(temp, gzipSync(JSON.stringify(snapshot)), { mode: 0o600, flag: 'wx' });
      renameSync(temp, cachePath(spec.date));
      parseCached(spec);
      return;
    } catch (error) {
      failure = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`Event capture ${spec.date}/${spec.contract} failed: ${failure instanceof Error ? failure.message : 'unknown error'}`);
}

async function fetchAll(specs: EventSourceSpec[]): Promise<void> {
  let cursor = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < specs.length) {
      const spec = specs[cursor++]!;
      if (!existsSync(cachePath(spec.date))) await fetchOne(spec);
      parseCached(spec);
      completed += 1;
      if (completed % 20 === 0 || completed === specs.length) process.stdout.write(`${completed}/${specs.length} fixed event windows verified\n`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }));
}

function writeSourceReport(specs: EventSourceSpec[]): Source[] {
  const sources: Source[] = specs.map((spec) => {
    const { candles, cached, rawFileSha256 } = parseCached(spec);
    return { ...spec, rawFileSha256, pageHashes: cached.pages.map((page) => page.sha256), candleCount: candles.length };
  });
  const report = { protocolSha256: protocolHash, calendarSource: 'EIA official WPSR/TWIP publication archive and WPSR schedule',
    events: sources, summary: { events: sources.length, windowsWithBars: sources.filter((source) => source.candleCount > 0).length,
      totalCandles: sources.reduce((sum, source) => sum + source.candleCount, 0), emptyDates: sources.filter((source) => source.candleCount === 0).map((source) => source.date) } };
  const temp = `${sourceReportPath}.part`;
  writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, sourceReportPath);
  return sources;
}

function sourceInventoryDigest(): string {
  const names = readdirSync(sourceDir).filter((name) => name.endsWith('.json.gz')).sort();
  const digest = createHash('sha256');
  for (const name of names) digest.update(`${name}\0${hash(readFileSync(join(sourceDir, name)))}\n`);
  if (names.length !== 109) throw new Error(`Expected 109 frozen event snapshots, found ${names.length}`);
  return digest.digest('hex');
}

function runReplay(specs: EventSourceSpec[], sources: Source[]): void {
  const decisions: BrEiaDecision[] = specs.map((spec) => {
    const candles = parseCached(spec).candles;
    return evaluateBrEiaEvent(spec, candles);
  });
  const combined = summarizeBrEiaEvents(decisions);
  const byYear = Object.fromEntries(['2024', '2025', '2026'].map((year) =>
    [year, summarizeBrEiaEvents(decisions.filter((decision) => decision.date.startsWith(year)))]));
  const byContract = Object.fromEntries([...new Set(specs.map((spec) => spec.contract))].map((contract) =>
    [contract, summarizeBrEiaEvents(decisions.filter((decision) => decision.contract === contract))]));
  const groups = [...Object.values(byYear), ...Object.values(byContract)];
  const statusCounts = combined.statuses as Record<string, number>;
  const status = combined.trades >= 100 && combined.tradeDates >= 50 && statusCounts.missing_signal === 0 &&
    statusCounts.cancelled_entry === 0 && statusCounts.unresolved === 0 && combined.winRate !== null && combined.winRate >= 0.51 &&
    combined.meanBaseNet !== null && combined.meanBaseNet > 0 && combined.meanStressNet !== null && combined.meanStressNet > 0 &&
    combined.profitFactor !== null && combined.profitFactor > 1 && combined.withoutBestTradeSum !== null && combined.withoutBestTradeSum > 0 &&
    groups.every((group) => group.trades > 0 && group.meanBaseNet !== null && group.meanBaseNet > 0)
      ? 'candidate-for-forward-check-only' : 'rejected-or-insufficient-development-gate';
  const report = { status, protocolSha256: protocolHash, sourceInventorySha256: sourceInventoryDigest(), sources, combined, byYear, byContract, decisions };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const temp = `${resultPath}.part`;
  writeFileSync(temp, body, { mode: 0o600 });
  renameSync(temp, resultPath);
  process.stdout.write(JSON.stringify({ status, combined, byYear, resultPath }) + '\n');
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--fetch') || flags.length > 1) throw new Error('Only --fetch is supported');
  if (!existsSync(protocolPath) || hash(readFileSync(protocolPath)) !== protocolHash) throw new Error('Frozen EIA protocol missing or changed');
  mkdirSync(sourceDir, { recursive: true, mode: 0o700 });
  chmodSync(sourceDir, 0o700);
  const specs = buildBrEiaEvents();
  if (flags.includes('--fetch')) await fetchAll(specs);
  if (specs.some((spec) => !existsSync(cachePath(spec.date)))) throw new Error('Missing source windows; run the explicit --fetch pass first');
  const sources = writeSourceReport(specs);
  if (!flags.includes('--fetch')) runReplay(specs, sources);
  else process.stdout.write(JSON.stringify({ sourceReportPath, events: sources.length, totalCandles: sources.reduce((sum, source) => sum + source.candleCount, 0) }) + '\n');
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`BR EIA event research failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}

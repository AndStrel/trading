import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  evaluatePairDay,
  joinPairCandles,
  type PairAttempt,
  type PairCandle,
  type PairDayResult,
  type PairTrade,
} from './research/sber-sberp-intraday-reversion.js';

type RawPage = { retrievedAtUtc: string; sha256: string; body: string };
type CachedChunk = { version: 1; ticker: 'SBER' | 'SBERP'; from: string; till: string; pages: RawPage[] };
type ChunkSpec = { from: string; till: string; ticker: 'SBER' | 'SBERP' };

const firstDate = '2023-01-03';
const lastDate = '2026-09-25';
const pageSize = 500;
const sourceDir = join(process.cwd(), '.trading', 'sber-sberp-intraday-reversion-v1');
const reportPath = join(process.cwd(), '.trading', 'sber-sberp-intraday-reversion-v1.json');
const protocolPath = join(process.cwd(), 'docs', 'SBER_SBERP_INTRADAY_REVERSION_V1.md');
const origin = 'https://iss.moex.com/iss';

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function weekdays(): string[] {
  const result: string[] = [];
  for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) result.push(date);
  }
  return result;
}

function chunks(ticker: ChunkSpec['ticker']): ChunkSpec[] {
  const result: ChunkSpec[] = [];
  for (let from = firstDate; from <= lastDate; from = addDays(from, 7)) {
    result.push({ ticker, from, till: from > addDays(lastDate, -6) ? lastDate : addDays(from, 6) });
  }
  return result;
}

function filePath(spec: ChunkSpec): string {
  return join(sourceDir, `${spec.ticker}_${spec.from}_${spec.till}.json.gz`);
}

function parsePage(body: string): PairCandle[] {
  const payload = JSON.parse(body) as { candles?: { columns?: string[]; data?: unknown[][] } };
  const table = payload.candles;
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.data)) throw new Error('MOEX response has no candles table');
  const column = (name: string) => {
    const index = table.columns!.indexOf(name);
    if (index < 0) throw new Error(`MOEX response is missing ${name} column`);
    return index;
  };
  const indices = { open: column('open'), close: column('close'), begin: column('begin') };
  return table.data.map((row) => {
    const begin = row[indices.begin];
    const open = Number(row[indices.open]);
    const close = Number(row[indices.close]);
    if (typeof begin !== 'string' || !Number.isFinite(open) || open <= 0 || !Number.isFinite(close) || close <= 0) {
      throw new Error('MOEX response contains an invalid candle');
    }
    return { begin, open, close };
  });
}

function readCachedChunk(spec: ChunkSpec): { candles: PairCandle[]; manifest: { ticker: string; from: string; till: string; pages: string[]; candles: number } } {
  const path = filePath(spec);
  if (!existsSync(path)) throw new Error(`Missing source snapshot ${path}; run with --fetch`);
  const cached = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as CachedChunk;
  if (cached.version !== 1 || cached.ticker !== spec.ticker || cached.from !== spec.from || cached.till !== spec.till || cached.pages.length === 0) {
    throw new Error(`Invalid source snapshot ${path}`);
  }
  const candles: PairCandle[] = [];
  for (const page of cached.pages) {
    if (!page.body || page.sha256 !== sha256(page.body)) throw new Error(`Source page hash mismatch in ${path}`);
    candles.push(...parsePage(page.body));
  }
  const times = new Set<string>();
  for (const candle of candles) {
    const date = candle.begin.slice(0, 10);
    if (date < spec.from || date > spec.till) throw new Error(`Out-of-range candle in ${path}: ${candle.begin}`);
    if (times.has(candle.begin)) throw new Error(`Duplicate candle in ${path}: ${candle.begin}`);
    times.add(candle.begin);
  }
  return {
    candles,
    manifest: { ticker: spec.ticker, from: spec.from, till: spec.till, pages: cached.pages.map((page) => page.sha256), candles: candles.length },
  };
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchChunk(spec: ChunkSpec): Promise<void> {
  const path = filePath(spec);
  if (existsSync(path)) {
    readCachedChunk(spec);
    return;
  }
  const pages: RawPage[] = [];
  for (let start = 0; ; start += pageSize) {
    const url = new URL(`${origin}/engines/stock/markets/shares/boards/TQBR/securities/${spec.ticker}/candles.json`);
    for (const [key, value] of Object.entries({
      interval: '10', from: `${spec.from} 10:00:00`, till: `${spec.till} 18:50:00`, start: String(start),
      'iss.meta': 'off', 'iss.only': 'candles', 'candles.columns': 'open,close,high,low,volume,begin',
    })) url.searchParams.set(key, value);
    let saved: RawPage | null = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-research' },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
        const body = await response.text();
        const rows = parsePage(body);
        if (rows.some((row) => row.begin.slice(0, 10) < spec.from || row.begin.slice(0, 10) > spec.till)) {
          throw new Error('MOEX returned a candle outside the requested range');
        }
        saved = { retrievedAtUtc: new Date().toISOString(), sha256: sha256(body), body };
        break;
      } catch (error) {
        if (attempt === 4) throw new Error(`${spec.ticker} ${spec.from}..${spec.till}, page ${start}: ${error instanceof Error ? error.message : 'unknown failure'}`);
        await pause(500 * 2 ** (attempt - 1));
      }
    }
    pages.push(saved!);
    if (parsePage(saved!.body).length < pageSize) break;
    await pause(100);
  }
  const cache: CachedChunk = { version: 1, ticker: spec.ticker, from: spec.from, till: spec.till, pages };
  const temporary = `${path}.part`;
  writeFileSync(temporary, gzipSync(JSON.stringify(cache)), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
  readCachedChunk(spec);
}

async function fetchAll(): Promise<void> {
  const specs = [...chunks('SBER'), ...chunks('SBERP')];
  let next = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < specs.length) {
      const spec = specs[next++]!;
      await fetchChunk(spec);
      completed += 1;
      if (completed % 20 === 0 || completed === specs.length) console.log(JSON.stringify({ status: 'source_progress', completed, total: specs.length }));
      await pause(100);
    }
  }));
}

function statistics(trades: readonly PairTrade[]) {
  const bases = trades.map((trade) => trade.baseNetReturn);
  const stress = trades.map((trade) => trade.stressNetReturn);
  const wins = bases.filter((value) => value > 0).length;
  const grossWins = bases.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLosses = bases.filter((value) => value < 0).reduce((sum, value) => sum - value, 0);
  const totalBase = bases.reduce((sum, value) => sum + value, 0);
  const bestFive = [...bases].sort((a, b) => b - a).slice(0, 5).reduce((sum, value) => sum + value, 0);
  return {
    trades: trades.length,
    netWinners: wins,
    netWinRate: trades.length ? wins / trades.length : null,
    meanBaseNet: trades.length ? totalBase / trades.length : null,
    sumBaseNet: totalBase,
    meanStressNet: trades.length ? stress.reduce((sum, value) => sum + value, 0) / trades.length : null,
    stressNetWinners: stress.filter((value) => value > 0).length,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : null,
    withoutBestFiveSum: totalBase - bestFive,
  };
}

function analyze(): Record<string, unknown> {
  const sourceRows = [...chunks('SBER'), ...chunks('SBERP')].map((spec) => readCachedChunk(spec));
  const allSber: PairCandle[] = [];
  const allSberp: PairCandle[] = [];
  for (const [index, spec] of [...chunks('SBER'), ...chunks('SBERP')].entries()) {
    (spec.ticker === 'SBER' ? allSber : allSberp).push(...sourceRows[index]!.candles);
  }
  const sessions = weekdays();
  const attempts: PairAttempt[] = [];
  let pairedBars = 0;
  let sberBars = 0;
  let sberpBars = 0;
  let datesWithOnlyOneLeg = 0;
  let datesWithNoBars = 0;
  const byYear: Record<string, PairDayResult[]> = {};
  const byDate = (candles: readonly PairCandle[]) => {
    const result = new Map<string, PairCandle[]>();
    for (const candle of candles) {
      const date = candle.begin.slice(0, 10);
      const list = result.get(date) ?? [];
      list.push(candle);
      result.set(date, list);
    }
    return result;
  };
  const sberByDate = byDate(allSber);
  const sberpByDate = byDate(allSberp);
  for (const date of sessions) {
    const first = sberByDate.get(date) ?? [];
    const second = sberpByDate.get(date) ?? [];
    sberBars += first.length;
    sberpBars += second.length;
    if (first.length === 0 && second.length === 0) datesWithNoBars += 1;
    if ((first.length === 0) !== (second.length === 0)) datesWithOnlyOneLeg += 1;
    const synchronized = joinPairCandles(first, second);
    pairedBars += synchronized.length;
    const result = evaluatePairDay(date, synchronized);
    attempts.push(...result.attempts);
    (byYear[date.slice(0, 4)] ??= []).push(result);
  }
  const trades = attempts.flatMap((attempt) => attempt.trade ? [attempt.trade] : []);
  const all = statistics(trades);
  const yearStats = Object.fromEntries(Object.entries(byYear).map(([year, days]) => [year, statistics(days.flatMap((day) => day.attempts.flatMap((attempt) => attempt.trade ? [attempt.trade] : [])))]));
  const completed = attempts.filter((attempt) => attempt.status === 'trade').length;
  const cancelled = attempts.filter((attempt) => attempt.status === 'cancelled_entry').length;
  const unresolved = attempts.filter((attempt) => attempt.status === 'unresolved_exit').length;
  const economicPass = completed >= 100 && new Set(trades.map((trade) => trade.date)).size >= 50 &&
    all.netWinRate !== null && all.netWinRate >= 0.51 && all.meanBaseNet! > 0 && all.sumBaseNet! > 0 &&
    all.meanStressNet! > 0 && unresolved === 0 && cancelled === 0 && datesWithOnlyOneLeg === 0 &&
    all.withoutBestFiveSum! > 0 && Object.values(yearStats).every((year: any) => year.trades > 0 && year.meanBaseNet > 0 && year.meanStressNet > 0);
  return {
    protocolSha256: sha256(readFileSync(protocolPath)),
    source: 'public MOEX ISS TQBR 10-minute candles; no broker credentials',
    period: { firstDate, lastDate },
    coverage: {
      weekdayDates: sessions.length,
      sberBars,
      sberpBars,
      synchronizedBars: pairedBars,
      weekdaysWithOnlyOneLeg: datesWithOnlyOneLeg,
      weekdaysWithNoBarsUnclassified: datesWithNoBars,
      sourcePages: sourceRows.map((row) => row.manifest),
    },
    attemptSummary: { total: attempts.length, completed, cancelled, unresolved, tradesOnDates: new Set(trades.map((trade) => trade.date)).size },
    combined: all,
    byYear: yearStats,
    exits: Object.fromEntries(['reversion', 'adverse_expansion', 'time'].map((reason) => [reason, trades.filter((trade) => trade.exitReason === reason).length])),
    decision: economicPass
      ? datesWithNoBars > 0 ? 'candidate_pending_exchange_calendar_verification' : 'candidate_for_independent_forward_test_only'
      : 'reject_or_incomplete_development_gate',
    limitations: [
      '10-minute trade candles are not contemporaneous executable bid/ask quotes.',
      'Historical short availability, borrow fees, and market impact are not established.',
      'Discovery sample overlaps periods used by other research and is not independent validation.',
      'Weekdays with no bars are not classified as exchange holidays without a separate calendar join.',
    ],
    trades,
    attempts: attempts.map(({ trade, ...attempt }) => ({ ...attempt, ...(trade ? { trade } : {}) })),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--fetch')) throw new Error('Only --fetch is supported');
  if (!existsSync(protocolPath)) throw new Error(`Missing protocol ${protocolPath}`);
  mkdirSync(sourceDir, { recursive: true, mode: 0o700 });
  chmodSync(sourceDir, 0o700);
  if (args.includes('--fetch')) await fetchAll();
  const report = analyze();
  const temporary = `${reportPath}.part`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, reportPath);
  const { trades: _trades, attempts: _attempts, coverage: _coverage, ...summary } = report;
  console.log(JSON.stringify({ ...summary, coverage: { ...(report.coverage as object), sourcePages: undefined } }, null, 2));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error(`SBER/SBERP intraday research failed: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  });
}

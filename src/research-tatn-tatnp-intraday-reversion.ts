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
  type PairTrade,
} from './research/sber-sberp-intraday-reversion.js';

type Ticker = 'TATN' | 'TATNP';
type Page = { retrievedAtUtc: string; sha256: string; body: string };
type Chunk = { version: 1; ticker: Ticker; from: string; till: string; pages: Page[] };
type Spec = { ticker: Ticker; from: string; till: string };

const fromDate = '2023-01-03';
const tillDate = '2026-09-25';
const pageSize = 500;
const directory = join(process.cwd(), '.trading', 'tatn-tatnp-intraday-reversion-v1');
const reportPath = join(process.cwd(), '.trading', 'tatn-tatnp-intraday-reversion-v1.json');
const protocolPath = join(process.cwd(), 'docs', 'TATN_TATNP_INTRADAY_REVERSION_TRANSFER_V1.md');

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function addDays(date: string, count: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}
function specs(): Spec[] {
  const result: Spec[] = [];
  for (const ticker of ['TATN', 'TATNP'] as const) {
    for (let from = fromDate; from <= tillDate; from = addDays(from, 7)) {
      result.push({ ticker, from, till: from > addDays(tillDate, -6) ? tillDate : addDays(from, 6) });
    }
  }
  return result;
}
function path(spec: Spec): string { return join(directory, `${spec.ticker}_${spec.from}_${spec.till}.json.gz`); }
function parse(body: string): PairCandle[] {
  const table = (JSON.parse(body) as { candles?: { columns?: string[]; data?: unknown[][] } }).candles;
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.data)) throw new Error('MOEX response has no candles table');
  const ix = (key: string) => {
    const index = table.columns!.indexOf(key);
    if (index < 0) throw new Error(`MOEX response missing ${key}`);
    return index;
  };
  const open = ix('open'); const close = ix('close'); const begin = ix('begin');
  return table.data.map((row) => {
    const time = row[begin]; const first = Number(row[open]); const last = Number(row[close]);
    if (typeof time !== 'string' || !Number.isFinite(first) || first <= 0 || !Number.isFinite(last) || last <= 0) throw new Error('Invalid MOEX candle');
    return { begin: time, open: first, close: last };
  });
}
function read(spec: Spec): { bars: PairCandle[]; manifest: object } {
  const file = path(spec);
  if (!existsSync(file)) throw new Error(`Missing source ${file}; run --fetch`);
  const chunk = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as Chunk;
  if (chunk.version !== 1 || chunk.ticker !== spec.ticker || chunk.from !== spec.from || chunk.till !== spec.till || !chunk.pages.length) throw new Error(`Invalid source ${file}`);
  const bars = chunk.pages.flatMap((page) => {
    if (page.sha256 !== hash(page.body)) throw new Error(`SHA-256 mismatch in ${file}`);
    return parse(page.body);
  });
  const seen = new Set<string>();
  for (const bar of bars) {
    const date = bar.begin.slice(0, 10);
    if (date < spec.from || date > spec.till || seen.has(bar.begin)) throw new Error(`Invalid or repeated candle ${bar.begin} in ${file}`);
    seen.add(bar.begin);
  }
  return { bars, manifest: { ticker: spec.ticker, from: spec.from, till: spec.till, candles: bars.length, pageHashes: chunk.pages.map((page) => page.sha256) } };
}
async function wait(ms: number): Promise<void> { await new Promise((resolve) => setTimeout(resolve, ms)); }
async function fetchOne(spec: Spec): Promise<void> {
  const file = path(spec);
  if (existsSync(file)) { read(spec); return; }
  const pages: Page[] = [];
  for (let start = 0; ; start += pageSize) {
    const url = new URL(`https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/${spec.ticker}/candles.json`);
    for (const [key, value] of Object.entries({ interval: '10', from: `${spec.from} 10:00:00`, till: `${spec.till} 18:50:00`, start: String(start), 'iss.meta': 'off', 'iss.only': 'candles', 'candles.columns': 'open,close,high,low,volume,begin' })) url.searchParams.set(key, value);
    let page: Page | undefined;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-research' }, signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
        const body = await response.text();
        parse(body);
        page = { retrievedAtUtc: new Date().toISOString(), sha256: hash(body), body };
        break;
      } catch (error) {
        if (attempt === 4) throw new Error(`${spec.ticker} ${spec.from}..${spec.till}, page ${start}: ${error instanceof Error ? error.message : 'unknown failure'}`);
        await wait(500 * 2 ** (attempt - 1));
      }
    }
    pages.push(page!);
    if (parse(page!.body).length < pageSize) break;
    await wait(100);
  }
  const temporary = `${file}.part`;
  writeFileSync(temporary, gzipSync(JSON.stringify({ version: 1, ...spec, pages } satisfies Chunk)), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
  read(spec);
}
async function fetchAll(): Promise<void> {
  const queue = specs(); let next = 0; let completed = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < queue.length) {
      const spec = queue[next++]!;
      await fetchOne(spec);
      completed += 1;
      if (completed % 20 === 0 || completed === queue.length) console.log(JSON.stringify({ status: 'source_progress', completed, total: queue.length }));
      await wait(100);
    }
  }));
}
function weekdays(): string[] {
  const dates: string[] = [];
  for (let d = fromDate; d <= tillDate; d = addDays(d, 1)) {
    const day = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (day > 0 && day < 6) dates.push(d);
  }
  return dates;
}
function stats(trades: readonly PairTrade[]) {
  const net = trades.map((trade) => trade.baseNetReturn);
  const stress = trades.map((trade) => trade.stressNetReturn);
  const positive = net.filter((value) => value > 0);
  const negative = net.filter((value) => value < 0).map((value) => -value);
  const total = net.reduce((sum, value) => sum + value, 0);
  const bestFive = [...net].sort((a, b) => b - a).slice(0, 5).reduce((sum, value) => sum + value, 0);
  return { trades: net.length, winners: positive.length, netWinRate: net.length ? positive.length / net.length : null,
    meanBaseNet: net.length ? total / net.length : null, sumBaseNet: total,
    meanStressNet: stress.length ? stress.reduce((sum, value) => sum + value, 0) / stress.length : null,
    stressWinners: stress.filter((value) => value > 0).length,
    profitFactor: negative.length ? positive.reduce((sum, value) => sum + value, 0) / negative.reduce((sum, value) => sum + value, 0) : 0,
    withoutBestFiveSum: total - bestFive };
}
function analyze(): Record<string, unknown> {
  const source = specs().map((spec) => ({ spec, data: read(spec) }));
  const sber = source.filter((item) => item.spec.ticker === 'TATN').flatMap((item) => item.data.bars);
  const sberp = source.filter((item) => item.spec.ticker === 'TATNP').flatMap((item) => item.data.bars);
  const byDate = (bars: readonly PairCandle[]) => {
    const map = new Map<string, PairCandle[]>();
    for (const bar of bars) { const date = bar.begin.slice(0, 10); const list = map.get(date) ?? []; list.push(bar); map.set(date, list); }
    return map;
  };
  const firstByDate = byDate(sber); const secondByDate = byDate(sberp);
  const attempts: PairAttempt[] = [];
  let firstCount = 0; let secondCount = 0; let synchronizedCount = 0; let oneLegDates = 0; let emptyDates = 0;
  const years: Record<string, PairTrade[]> = {};
  for (const date of weekdays()) {
    const first = firstByDate.get(date) ?? []; const second = secondByDate.get(date) ?? [];
    firstCount += first.length; secondCount += second.length;
    if (!first.length && !second.length) emptyDates += 1;
    if ((!first.length) !== (!second.length)) oneLegDates += 1;
    const result = evaluatePairDay(date, joinPairCandles(first, second));
    synchronizedCount += result.synchronizedBars.length;
    attempts.push(...result.attempts);
    const target = years[date.slice(0, 4)] ??= [];
    target.push(...result.attempts.flatMap((attempt) => attempt.trade ? [attempt.trade] : []));
  }
  const trades = attempts.flatMap((attempt) => attempt.trade ? [attempt.trade] : []);
  const summary = stats(trades);
  const byYear = Object.fromEntries(Object.entries(years).map(([year, items]) => [year, stats(items)]));
  const completed = trades.length; const cancelled = attempts.filter((x) => x.status === 'cancelled_entry').length;
  const unresolved = attempts.filter((x) => x.status === 'unresolved_exit').length;
  const eligible = completed >= 100 && new Set(trades.map((trade) => trade.date)).size >= 50 && summary.netWinRate! >= 0.51 &&
    summary.meanBaseNet! > 0 && summary.sumBaseNet! > 0 && summary.meanStressNet! > 0 && cancelled === 0 && unresolved === 0 &&
    oneLegDates === 0 && summary.withoutBestFiveSum! > 0 && Object.values(byYear).every((y: any) => y.meanBaseNet > 0 && y.meanStressNet > 0);
  const report = {
    protocolSha256: hash(readFileSync(protocolPath)), source: 'public MOEX ISS TQBR 10-minute candles; no broker credentials',
    period: { fromDate, tillDate },
    coverage: { weekdayDates: weekdays().length, tatnBars: firstCount, tatnpBars: secondCount, synchronizedBars: synchronizedCount,
      weekdaysWithOnlyOneLeg: oneLegDates, weekdaysWithNoBarsUnclassified: emptyDates,
      sourcePages: source.map((item) => ({ ...item.data.manifest })) },
    attempts: { total: attempts.length, completed, cancelled, unresolved, tradeDates: new Set(trades.map((trade) => trade.date)).size },
    combined: summary, byYear,
    exits: Object.fromEntries(['reversion', 'adverse_expansion', 'time'].map((reason) => [reason, trades.filter((trade) => trade.exitReason === reason).length])),
    decision: eligible ? emptyDates ? 'candidate_pending_exchange_calendar_verification' : 'candidate_for_independent_forward_test_only' : 'reject_or_incomplete_development_gate',
    limitations: ['Ten-minute trade candles are not executable bid/ask quotes.', 'No historical short availability or borrow-cost data.',
      'Transfer is exploratory and uses a development period; it is not independent validation.', 'No-bars weekdays require official calendar classification.'],
    trades,
    attemptDetails: attempts,
  };
  return report;
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((x) => x !== '--fetch')) throw new Error('Only --fetch is supported');
  if (!existsSync(protocolPath)) throw new Error(`Missing protocol ${protocolPath}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  if (args.includes('--fetch')) await fetchAll();
  const report = analyze();
  const temporary = `${reportPath}.part`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, reportPath);
  const { trades: _trades, attemptDetails: _attemptDetails, coverage: _coverage, ...summary } = report;
  const coverage = report.coverage as Record<string, unknown>;
  console.log(JSON.stringify({ ...summary, coverage: { ...coverage, sourcePages: undefined } }, null, 2));
}
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => { console.error(`TATN/TATNP research failed: ${error instanceof Error ? error.message : 'unknown failure'}`); process.exitCode = 1; });
}

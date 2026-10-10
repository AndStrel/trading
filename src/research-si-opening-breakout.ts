import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { parseSiCandlePage, validateSiDayCandles, type SiCandle } from './research/si-first-hour.js';
import { evaluateSiOpeningBreakout, type OpeningBreakoutDecision } from './research/si-opening-breakout.js';

type RawPage = { sha256: string; body: string };
type CachedDay = { version: 1; date: string; contract: string; pages: RawPage[] };

const researchDir = join(process.cwd(), '.trading', 'si-opening-breakout-v1');
const reportPath = join(process.cwd(), '.trading', 'si-opening-breakout-v1.json');
const protocolPath = join(process.cwd(), 'docs', 'SI_OPENING_COMPRESSION_BREAKOUT_V1.md');
const pageSize = 500;
const verifiedNoSessionDates = new Set(['2024-11-04']);

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function daySpecs(): { date: string; contract: string }[] {
  const ranges = [
    { first: '2023-07-03', last: '2023-12-08', change: '2023-09-11', before: 'SiU3', after: 'SiZ3' },
    { first: '2024-07-01', last: '2024-12-10', change: '2024-09-11', before: 'SiU4', after: 'SiZ4' },
  ];
  const days: { date: string; contract: string }[] = [];
  for (const range of ranges) {
    for (let ms = Date.parse(`${range.first}T00:00:00Z`); ms <= Date.parse(`${range.last}T00:00:00Z`); ms += 86_400_000) {
      const current = new Date(ms);
      if (current.getUTCDay() === 0 || current.getUTCDay() === 6) continue;
      const date = current.toISOString().slice(0, 10);
      days.push({ date, contract: date < range.change ? range.before : range.after });
    }
  }
  return days;
}

function cachePath(date: string): string {
  return join(researchDir, `${date}.json.gz`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(date: string, contract: string, start: number): Promise<RawPage> {
  const url = new URL(`https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/${contract}/candles.json`);
  for (const [key, value] of Object.entries({
    interval: '1', from: `${date} 10:00:00`, till: `${date} 17:00:00`, start: String(start),
    'iss.meta': 'off', 'iss.only': 'candles', 'candles.columns': 'open,close,high,low,volume,begin',
  })) url.searchParams.set(key, value);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      const body = await response.text();
      parseSiCandlePage(JSON.parse(body) as unknown, date);
      return { sha256: sha256(body), body };
    } catch (error) {
      if (attempt === 4) throw new Error(`${contract} ${date} page ${start}: ${error instanceof Error ? error.message : 'unknown failure'}`);
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error('MOEX retry attempts exhausted');
}

async function fetchDay(date: string, contract: string): Promise<CachedDay> {
  const pages: RawPage[] = [];
  for (let index = 0; index < 5; index += 1) {
    const page = await fetchPage(date, contract, index * pageSize);
    pages.push(page);
    if (parseSiCandlePage(JSON.parse(page.body) as unknown, date).length < pageSize) {
      return { version: 1, date, contract, pages };
    }
    await sleep(100);
  }
  throw new Error(`MOEX pagination limit exceeded for ${contract} ${date}`);
}

function writeCachedDay(day: CachedDay): void {
  const output = cachePath(day.date);
  if (existsSync(output)) throw new Error(`Refusing to replace source snapshot ${output}`);
  const temporary = `${output}.part`;
  writeFileSync(temporary, gzipSync(JSON.stringify(day)), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, output);
}

function readCachedDay(date: string, contract: string): { candles: SiCandle[]; pageHashes: string[] } {
  const path = cachePath(date);
  if (!existsSync(path)) throw new Error(`Missing source snapshot ${path}; run --fetch first`);
  const day = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as CachedDay;
  if (day.version !== 1 || day.date !== date || day.contract !== contract || !Array.isArray(day.pages) || day.pages.length === 0) {
    throw new Error(`Invalid source snapshot ${path}`);
  }
  const candles: SiCandle[] = [];
  for (const page of day.pages) {
    if (typeof page.body !== 'string' || page.sha256 !== sha256(page.body)) throw new Error(`Source hash mismatch in ${path}`);
    candles.push(...parseSiCandlePage(JSON.parse(page.body) as unknown, date));
  }
  if (day.pages.length > 1 && candles.length < pageSize * (day.pages.length - 1)) {
    throw new Error(`Incomplete pagination in ${path}`);
  }
  validateSiDayCandles(candles, date);
  if (candles.length > 421) throw new Error(`Unexpectedly many 10:00–17:00 candles in ${path}`);
  return { candles, pageHashes: day.pages.map((page) => page.sha256) };
}

function summarize(decisions: readonly OpeningBreakoutDecision[]): Record<string, number | null> {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const values = trades.map((trade) => trade.baseNet!);
  const positive = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negative = values.filter((value) => value < 0).reduce((sum, value) => sum - value, 0);
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    days: decisions.length,
    noSessions: decisions.filter((decision) => decision.status === 'no_session').length,
    noCandles: decisions.filter((decision) => decision.status === 'no_candles').length,
    missingOpening: decisions.filter((decision) => decision.status === 'missing_opening').length,
    unresolvedHolding: decisions.filter((decision) => decision.status === 'unresolved_holding').length,
    cancelledEntry: decisions.filter((decision) => decision.status === 'cancelled_entry').length,
    ambiguousSignals: decisions.filter((decision) => decision.status === 'ambiguous_signal').length,
    cash: decisions.filter((decision) => decision.status === 'cash').length,
    signals: decisions.filter((decision) => decision.side !== undefined).length,
    trades: trades.length,
    stops: trades.filter((trade) => trade.exitReason === 'stop').length,
    targets: trades.filter((trade) => trade.exitReason === 'target').length,
    timedExits: trades.filter((trade) => trade.exitReason === 'time').length,
    winners: values.filter((value) => value > 0).length,
    winRate: trades.length ? values.filter((value) => value > 0).length / trades.length : null,
    meanBaseNet: trades.length ? sum / trades.length : null,
    meanStressNet: trades.length ? trades.reduce((total, trade) => total + trade.stressNet!, 0) / trades.length : null,
    sumBaseNet: sum,
    profitFactor: negative > 0 ? positive / negative : null,
    withoutBestDaySum: trades.length ? sum - Math.max(...values) : null,
  };
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--fetch')) throw new Error('Only --fetch is supported; omit flags for offline replay');
  if (!existsSync(protocolPath)) throw new Error(`Missing fixed protocol ${protocolPath}`);
  mkdirSync(researchDir, { recursive: true, mode: 0o700 });
  chmodSync(researchDir, 0o700);
  const specs = daySpecs();
  if (flags.includes('--fetch')) {
    let nextIndex = 0;
    let completed = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (nextIndex < specs.length) {
        const spec = specs[nextIndex++]!;
        if (!existsSync(cachePath(spec.date))) writeCachedDay(await fetchDay(spec.date, spec.contract));
        readCachedDay(spec.date, spec.contract);
        completed += 1;
        if (completed % 20 === 0 || completed === specs.length) {
          console.log(JSON.stringify({ status: 'source_progress', completed, total: specs.length }));
        }
        await sleep(100);
      }
    });
    await Promise.all(workers);
  }
  const sources: { date: string; contract: string; candleCount: number; pageHashes: string[] }[] = [];
  const decisions: OpeningBreakoutDecision[] = [];
  for (const spec of specs) {
    const { candles, pageHashes } = readCachedDay(spec.date, spec.contract);
    sources.push({ date: spec.date, contract: spec.contract, candleCount: candles.length, pageHashes });
    const decision = evaluateSiOpeningBreakout(spec.date, spec.contract, candles);
    if (verifiedNoSessionDates.has(spec.date)) {
      if (decision.status !== 'no_candles') throw new Error(`Verified non-trading date has unexpected candles: ${spec.date}`);
      decisions.push({ date: spec.date, contract: spec.contract, status: 'no_session' });
    } else {
      decisions.push(decision);
    }
  }
  const combined = summarize(decisions);
  const years = Object.fromEntries(['2023', '2024'].map((year) => [year, summarize(decisions.filter((decision) => decision.date.startsWith(year)))]));
  const contracts = Object.fromEntries(['SiU3', 'SiZ3', 'SiU4', 'SiZ4'].map((contract) => [contract, summarize(decisions.filter((decision) => decision.contract === contract))]));
  const sides = Object.fromEntries(['long', 'short'].map((side) => [side, summarize(decisions.filter((decision) => decision.side === side))]));
  const groups = [...Object.values(years), ...Object.values(contracts)];
  const passesGate = combined.trades! >= 100 && combined.noCandles === 0 && combined.missingOpening === 0 &&
    combined.unresolvedHolding === 0 && combined.cancelledEntry === 0 && combined.ambiguousSignals === 0 &&
    combined.winRate! >= 0.51 && combined.meanBaseNet! > 0 && combined.meanStressNet! > 0 &&
    combined.profitFactor! > 1 && combined.withoutBestDaySum! > 0 &&
    groups.every((group) => group.trades! > 0 && group.meanBaseNet! > 0);
  const report = {
    protocolSha256: sha256(readFileSync(protocolPath)),
    source: 'MOEX ISS RFUD one-minute candles; cached raw pages, no broker token',
    status: passesGate ? 'candidate-for-independent-check-only' : 'failed-or-insufficient-development-gate',
    costs: { commissionPerSide: 0.001, baseSlippagePerSide: 0.0005, stressSlippagePerSide: 0.001 },
    calendar: { verifiedNoSessionDates: [...verifiedNoSessionDates], source: 'https://www.moex.com/n74370' },
    combined, years, contracts, sides, sources, decisions,
  };
  const temporary = `${reportPath}.part`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, reportPath);
  console.log(JSON.stringify({ status: report.status, combined, years, contracts, reportPath }));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error(`Si opening-breakout research failed: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  });
}

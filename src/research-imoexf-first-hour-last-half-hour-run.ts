import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  isWeekday, parseMoexCandles, scoreTrade, sessionWindows, signalReturn, validateWindow,
} from './research/imoexf-first-hour-last-half-hour.js';

const sourceRoot = join(process.cwd(), '.trading', 'imoexf-first-hour-last-half-hour');
const manifestPath = join(sourceRoot, 'source-manifest.json');
const protocolPath = join(process.cwd(), 'docs', 'IMOEXF_FIRST_HOUR_LAST_HALF_HOUR_V1.md');
const expectedProtocolSha256 = '56fe50fc8dd76f1ee15b3d612fd94f4b7f9053aabea4dc00eb78d05b492b1b19';
const resultsJsonPath = join(sourceRoot, 'results.json');
const resultsMarkdownPath = join(process.cwd(), 'docs', 'IMOEXF_FIRST_HOUR_LAST_HALF_HOUR_V1_RESULTS.md');

type PageRef = { path: string; sha256: string; url: string; kind: string; date?: string; start?: number };
type SourceManifest = {
  protocolSha256: string;
  manifestSha256: string;
  sourcePages: PageRef[];
  windowCoverage: { date: string; signalComplete: boolean; exitComplete: boolean }[];
  officialWeekdayCount: number;
  officialDailyDateCount: number;
  outcomeReturnsCalculated: false;
  [key: string]: unknown;
};
type Trade = ReturnType<typeof scoreTrade> & { date: string; year: string; stressNetRub: number };

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function round(value: number, digits = 8): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function summary(trades: Trade[], netKey: 'netRub' | 'stressNetRub' = 'netRub') {
  const values = trades.map((trade) => trade[netKey]);
  const total = values.reduce((sum, value) => sum + value, 0);
  const winners = values.filter((value) => value > 0).length;
  const ordered = [...values].sort((left, right) => right - left);
  const cutoff = Math.min(5, ordered.length);
  return {
    trades: values.length,
    winners,
    winRate: values.length ? winners / values.length : 0,
    meanRub: values.length ? total / values.length : 0,
    medianRub: median(values),
    totalRub: total,
    totalWithoutBestFiveRub: total - ordered.slice(0, cutoff).reduce((sum, value) => sum + value, 0),
  };
}

async function readSourceManifest(): Promise<SourceManifest> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as SourceManifest;
  const { manifestSha256, ...base } = manifest;
  if (manifest.protocolSha256 !== expectedProtocolSha256 || sha256(await readFile(protocolPath, 'utf8')) !== expectedProtocolSha256) {
    throw new Error('Frozen IMOEXF protocol changed; refuse outcome calculation');
  }
  if (manifest.outcomeReturnsCalculated !== false || sha256(JSON.stringify(base)) !== manifestSha256) {
    throw new Error('Source checkpoint hash or price-blind status is invalid');
  }
  if (manifest.officialWeekdayCount !== manifest.windowCoverage.length) throw new Error('Source checkpoint date count is inconsistent');
  if (new Set(manifest.windowCoverage.map((row) => row.date)).size !== manifest.windowCoverage.length) throw new Error('Duplicate source date');
  for (const row of manifest.windowCoverage) if (!isWeekday(row.date)) throw new Error(`Weekend in weekday-only source checkpoint: ${row.date}`);
  return manifest;
}

async function loadPage(path: string, refs: Map<string, PageRef>) {
  const ref = refs.get(path);
  if (!ref) throw new Error(`Raw source page is absent from manifest: ${path}`);
  const cached = JSON.parse(await readFile(join(process.cwd(), path), 'utf8')) as { url: string; sha256: string; body: string };
  if (cached.url !== ref.url || cached.sha256 !== ref.sha256 || sha256(cached.body) !== ref.sha256) {
    throw new Error(`Raw source page provenance changed: ${path}`);
  }
  return parseMoexCandles(cached.body);
}

function fmt(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

async function main(): Promise<void> {
  if (await fileExists(resultsJsonPath) || await fileExists(resultsMarkdownPath)) throw new Error('IMOEXF outcome report already exists; refusing to overwrite');
  const manifest = await readSourceManifest();
  const refs = new Map(manifest.sourcePages.map((page) => [page.path, page]));
  if (refs.size !== manifest.sourcePages.length) throw new Error('Duplicate raw page paths in source manifest');
  for (const page of manifest.sourcePages) await loadPage(page.path, refs);

  const coverageByDate = new Map(manifest.windowCoverage.map((row) => [row.date, row]));
  const trades: Trade[] = [];
  const unresolved: { date: string; reason: string }[] = [];
  let zeroSignals = 0;
  let validSignalDates = 0;
  let exitWindowsNeeded = 0;
  const sourceCoverageMismatch: string[] = [];

  for (const date of [...coverageByDate.keys()].sort()) {
    const expected = coverageByDate.get(date)!;
    const signalPath = `.trading/imoexf-first-hour-last-half-hour/minute/${date}-signal.json`;
    const exitPath = `.trading/imoexf-first-hour-last-half-hour/minute/${date}-exit.json`;
    const [signalCandles, exitCandles] = await Promise.all([loadPage(signalPath, refs), loadPage(exitPath, refs)]);
    const windows = sessionWindows(date);
    const signalComplete = validateWindow(signalCandles, date, windows.signalStart, windows.signalEnd);
    const exitComplete = validateWindow(exitCandles, date, windows.exitStart, windows.exitEnd);
    if (signalComplete !== expected.signalComplete || exitComplete !== expected.exitComplete) sourceCoverageMismatch.push(date);
    if (!signalComplete) {
      unresolved.push({ date, reason: 'incomplete_signal_window' });
      continue;
    }
    validSignalDates += 1;
    const signal = signalReturn(signalCandles);
    if (signal === 0) {
      zeroSignals += 1;
      continue;
    }
    exitWindowsNeeded += 1;
    if (!exitComplete) {
      unresolved.push({ date, reason: 'incomplete_entry_or_exit_window' });
      continue;
    }
    const base = scoreTrade(signalCandles, exitCandles, 1);
    const stress = scoreTrade(signalCandles, exitCandles, 2);
    trades.push({ ...base, date, year: date.slice(0, 4), stressNetRub: stress.netRub });
  }
  if (sourceCoverageMismatch.length) throw new Error(`Source checkpoint completeness changed on ${sourceCoverageMismatch.length} date(s)`);

  const baseSummary = summary(trades);
  const stressSummary = summary(trades, 'stressNetRub');
  const yearly = Object.fromEntries(['2024', '2025', '2026'].map((year) => {
    const rows = trades.filter((trade) => trade.year === year);
    return [year, { ...summary(rows), stress: summary(rows, 'stressNetRub') }];
  }));
  const yearlyPositive = Object.values(yearly).every((row) => row.trades > 0 && row.totalRub > 0);
  const gates = {
    sampleAtLeast100TradesAnd50Dates: baseSummary.trades >= 100 && new Set(trades.map((trade) => trade.date)).size >= 50,
    baseNetWinRateAtLeast51Percent: baseSummary.winRate >= 0.51,
    baseMeanAndMedianPositive: baseSummary.meanRub > 0 && baseSummary.medianRub > 0,
    everyCalendarYearNetPositive: yearlyPositive,
    stressAggregatePositive: stressSummary.totalRub > 0,
    excludingBestFivePositive: baseSummary.totalWithoutBestFiveRub > 0,
    noUnresolvedOrCancelledDates: unresolved.length === 0,
  };
  const result = {
    version: 1,
    protocol: relative(process.cwd(), protocolPath),
    protocolSha256: expectedProtocolSha256,
    sourceManifest: relative(process.cwd(), manifestPath),
    sourceManifestSha256: manifest.manifestSha256,
    instrument: 'IMOEXF',
    scope: `${manifest.windowCoverage[0]?.date ?? 'none'}–2026-09-24; MOEX official weekday trading dates only`,
    sourceDateCounts: {
      officialAllDates: manifest.officialDailyDateCount,
      officialWeekdays: manifest.officialWeekdayCount,
      completeSignalWindows: validSignalDates,
      completeExitWindowsObserved: manifest.windowCoverage.filter((row) => row.exitComplete).length,
      nonZeroSignalsRequiringExecution: exitWindowsNeeded,
      zeroSignalsInCash: zeroSignals,
      unresolvedDates: unresolved,
    },
    base: baseSummary,
    stress: stressSummary,
    yearly,
    gates,
    decision: Object.values(gates).every(Boolean) ? 'PASS_TO_PROSPECTIVE_SHADOW_ONLY' : 'REJECT_THIS_RULE',
    caveats: [
      'Trade-print candle opens and closes are not executable bid/ask fills; fixed adverse-tick costs are only a screening model.',
      'Uses current published Investor broker commission and MOEX transaction fee as historical proxies; the user tariff is unverified.',
      'Excludes personal taxes, margin financing, queue position, and market impact.',
      'A pass is not an order authorization and requires prospective route-specific bid/ask shadow validation.',
    ],
    calculatedAtUtc: new Date().toISOString(),
  };
  const json = JSON.stringify(result, null, 2);
  await writeFile(resultsJsonPath, json, { encoding: 'utf8', flag: 'wx', mode: 0o600 });

  const md = [
    '# IMOEXF first-hour to final-half-hour v1 — result', '',
    `Protocol SHA-256: \`${expectedProtocolSha256}\`. Source manifest SHA-256: \`${manifest.manifestSha256}\`.`, '',
    `**Decision: ${result.decision}.** This is an OHLC screen, not an executable-fill result.`, '',
    `Source calendar: ${manifest.officialDailyDateCount} dates, of which ${manifest.officialWeekdayCount} weekdays. ` +
      `${validSignalDates} complete first-hour windows, ${zeroSignals} zero signals left in cash, ` +
      `${exitWindowsNeeded} nonzero signals requiring execution, ${unresolved.length} unresolved dates.`, '',
    '| Period | Trades | Net winners | Win rate | Mean RUB | Median RUB | Total RUB | Stress total RUB |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    `| Combined | ${baseSummary.trades} | ${baseSummary.winners} | ${fmt(baseSummary.winRate * 100)}% | ${fmt(baseSummary.meanRub)} | ${fmt(baseSummary.medianRub)} | ${fmt(baseSummary.totalRub)} | ${fmt(stressSummary.totalRub)} |`,
    ...Object.entries(yearly).map(([year, row]) => `| ${year} | ${row.trades} | ${row.winners} | ${fmt(row.winRate * 100)}% | ${fmt(row.meanRub)} | ${fmt(row.medianRub)} | ${fmt(row.totalRub)} | ${fmt(row.stress.totalRub)} |`), '',
    `Combined base net P&L excluding the five best trades: RUB ${fmt(baseSummary.totalWithoutBestFiveRub)}.`, '',
    '## Admission gates', '',
    ...Object.entries(gates).map(([name, passed]) => `- ${passed ? 'PASS' : 'FAIL'} — ${name}`), '',
    '## Limitations', '',
    ...result.caveats.map((item) => `- ${item}`), '',
    `Reproduce after source verification with \`node dist/research-imoexf-first-hour-last-half-hour-run.js\`. JSON: \`${relative(process.cwd(), resultsJsonPath)}\`.`, '',
  ].join('\n');
  await writeFile(resultsMarkdownPath, md, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write(`Outcome screen: ${result.decision}; trades=${baseSummary.trades}; net wins=${baseSummary.winners}/${baseSummary.trades}; unresolved=${unresolved.length}.\n`);
  process.stdout.write(`Base total RUB ${fmt(baseSummary.totalRub)}; stress total RUB ${fmt(stressSummary.totalRub)}; without best five RUB ${fmt(baseSummary.totalWithoutBestFiveRub)}.\n`);
}

async function fileExists(path: string): Promise<boolean> {
  try { await readFile(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`IMOEXF outcome screen failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});

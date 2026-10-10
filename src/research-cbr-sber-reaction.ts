import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { SiCandle } from './research/si-first-hour.js';
import {
  CBR_DECISION_DATES,
  CBR_WINDOWS,
  cbrSberAdmission,
  cbrWindowMinuteTimes,
  evaluateCbrSberWindow,
  summarizeCbrSberWindows,
  type CbrSberWindow,
} from './research/cbr-sber-reaction.js';

const root = process.cwd();
const protocolPath = join(root, 'docs', 'CBR_SBER_REACTION_MOMENTUM_V1.md');
const protocolSha256 = '944aeff77ecd9364ee0c14597bf35a8c34727ea9d29e7c5970724ca6cf48bfb9';
const defaultDbPath = process.env.CBR_SBER_EVENT_DB ?? join(root, '.trading', 'market-data.sqlite');
const reportPath = process.env.CBR_SBER_EVENT_REPORT_PATH ?? join(root, '.trading', 'cbr-sber-reaction-v1.json');
const expectedSources: Record<number, string> = {
  2015: 'cd7a36a864d22f1a03ab7d5dea1ede0e9285570c8bf71f49e44cc634eb9fa5cd',
  2016: '4a9f1087ca67807f273cd1339f813720448b69d98720689d16b424c32d9d3c1e',
  2017: 'fb400a287437ee99ac2ad4a52618025ac046541af670a38a05f5d8be734db628',
  2018: '2d423671057d8a3b9797ee6a05bcba73a6f4fabc4487f7189c7ffe53adeffa63',
  2019: '418118e20f2a0656549bf7530cb293b71ad0eb772f484726565bf35c60a109a2',
  2020: '49be51ab4ec61bd229fd4a7cb19a6da7db7c1e2e167d02b4c46c57bbf5123ea9',
  2021: '2087983e6712c7c06dc40778e6089acb31a6c530bb88988da6234d37c5a7e44c',
  2022: '960131d073aa91b7dc0232e89490f2765b5414babe4ea7c69ba5b6207b8e31e5',
  2023: '34fabbc21a04b94d300277713cb2097ebc794c6a21f03d6787c3229ff76f922c',
  2024: '7b01881fc93e7c635a6e5250edeeffbcbc8c64805b655e58c8f01688ebb476e1',
  2025: '30a96134305860a244aa71952fbfe3fe56f0341b10c56f4114ec980c84322d2f',
  2026: '90a765fe22fb8499d7050e2c5cc05e239e8a639be0b149d8e37592c5858d381f',
};

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function utcTimestamp(date: string, localTime: string): string {
  return new Date(`${date}T${localTime}+03:00`).toISOString();
}

function summarize(windows: readonly CbrSberWindow[]) {
  return summarizeCbrSberWindows(windows);
}

function main(): void {
  if (process.argv.length !== 2) throw new Error('Offline replay takes no flags; set CBR_SBER_EVENT_DB for another SQLite source');
  if (!existsSync(protocolPath) || sha256(readFileSync(protocolPath)) !== protocolSha256) {
    throw new Error('Frozen CBR/SBER protocol is missing or changed; create a new version before outcome analysis');
  }

  const db = new DatabaseSync(defaultDbPath, { readOnly: true });
  const windows: CbrSberWindow[] = [];
  const archiveSummaries: unknown[] = [];
  try {
    db.exec('BEGIN');
    for (const [yearText, expectedSha] of Object.entries(expectedSources)) {
      const year = Number(yearText);
      const rows = db.prepare(`SELECT instrument_id id, archive_sha256 sha, raw_row_count raw,
          stored_candle_count stored, invalid_row_count invalid, duplicate_row_count duplicates, source
        FROM historical_archive_imports WHERE ticker='SBER' AND source_year=?`).all(year) as unknown as
          { id: string; sha: string; raw: number; stored: number; invalid: number; duplicates: number; source: string }[];
      if (rows.length !== 1) throw new Error(`Missing or ambiguous SBER ${year} archive`);
      const source = rows[0]!;
      if (source.id !== 'MOEX:TQBR:SBER' || source.sha !== expectedSha || source.source !== 'moex' || source.duplicates !== 0) {
        throw new Error(`Unexpected SBER ${year} source provenance`);
      }
      const expectedInvalid = year === 2015 || year === 2017 ? 1 : 0;
      if (source.invalid !== expectedInvalid || source.raw - source.stored !== source.invalid) {
        throw new Error(`Unexpected SBER ${year} source row quality`);
      }
      const actual = db.prepare(`SELECT count(*) count FROM historical_minute_candles
        WHERE instrument_id=? AND source_year=? AND source_archive_sha256=?`).get(source.id, year, expectedSha) as { count: number };
      if (actual.count !== source.stored) throw new Error(`SBER ${year} stored row count changed`);
      archiveSummaries.push({ year, ...source });
    }

    const findCandle = db.prepare(`SELECT candle_time time, open, high, low, close, volume
      FROM historical_minute_candles WHERE instrument_id='MOEX:TQBR:SBER' AND source_year=?
        AND source_archive_sha256=? AND candle_time=?`);
    for (const date of CBR_DECISION_DATES) {
      const year = Number(date.slice(0, 4));
      const sourceSha = expectedSources[year];
      if (!sourceSha) throw new Error(`No locked source for decision date ${date}`);
      for (const window of CBR_WINDOWS) {
        const start = window.startMinute;
        const candles = new Map<string, SiCandle>();
        for (const localTime of cbrWindowMinuteTimes(start)) {
          const time = utcTimestamp(date, localTime);
          const row = findCandle.get(year, sourceSha, time) as SiCandle | undefined;
          if (row) candles.set(`${date} ${localTime}`, { ...row, time: `${date} ${localTime}` });
        }
        windows.push(evaluateCbrSberWindow(date, window.kind, start, candles));
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* snapshot may already be closed */ }
    throw error;
  } finally {
    db.close();
  }

  const years = [...new Set(CBR_DECISION_DATES.map((date) => date.slice(0, 4)))];
  const byYear = Object.fromEntries(years.map((year) => [year, summarize(windows.filter((item) => item.date.startsWith(year)))]));
  const blocks = {
    '2015-2019': summarize(windows.filter((item) => item.date >= '2015-01-01' && item.date <= '2019-12-31')),
    '2020-2021': summarize(windows.filter((item) => item.date >= '2020-01-01' && item.date <= '2021-12-31')),
    '2022': summarize(windows.filter((item) => item.date.startsWith('2022'))),
    '2023-2026': summarize(windows.filter((item) => item.date >= '2023-01-01')),
  };
  const coverageByYear = Object.fromEntries(years.map((year) => {
    const subset = windows.filter((item) => item.date.startsWith(year));
    return [year, subset.length ? subset.filter((item) => item.status !== 'missing_candles').length / subset.length : 0];
  }));
  const all = summarize(windows);
  const unresolvedEventWindows = windows.filter((item) => item.status === 'missing_candles').length;
  const unresolvedEntered = windows.filter((item) => item.status === 'missing_candles' &&
    item.side !== undefined && item.entryAvailable === true && item.exitAvailable === false).length;
  const passesGate = cbrSberAdmission({ all, byYear, byBlock: blocks, coverageByYear, unresolvedEntered });
  const report = {
    protocolSha256,
    codeSha256: sha256(Buffer.concat([
      readFileSync(join(root, 'src', 'research-cbr-sber-reaction.ts')),
      readFileSync(join(root, 'src', 'research', 'cbr-sber-reaction.ts')),
    ])),
    calendarSource: 'Bank of Russia key-rate decision calendar, frozen at 2026-09-28',
    marketDataSource: 'MOEX ISS public one-minute TQBR SBER candles, local timestamps Moscow time',
    status: passesGate ? 'research-candidate-only-needs-independent-and-executable-validation' : 'rejected-or-insufficient',
    costs: { commissionPerSide: 0.003, baseSlippagePerSide: 0.0005, stressSlippagePerSide: 0.001 },
    sources: archiveSummaries,
    excludedUnscheduledDates: ['2022-02-28', '2022-04-08', '2022-05-26', '2023-08-15'],
    coverageByYear,
    unresolvedEntered,
    unresolvedEventWindows,
    all,
    byYear,
    blocks,
    windows,
    limitations: [
      'MOEX candle opens are price proxies, not observed bid/ask executions or fills.',
      'Short availability, borrow cost, market impact, taxes, and broker realized charges are unverified.',
      'Two event windows on a decision date are clustered observations, not independent dates.',
      '2015 and 2017 source archives each contain one invalid row; missing required event candles remain unresolved.',
      'A historical pass would only justify independent and prospective paper-fill validation, never live orders.',
    ],
  };
  const temporary = `${reportPath}.part`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, reportPath);
  const brief = (summary: ReturnType<typeof summarize>) => ({
    windows: summary.windows, trades: summary.trades, dates: summary.dates,
    missingWindows: summary.missingWindows, flatWindows: summary.flatWindows,
    grossWinners: summary.grossWinners, grossWinRate: summary.grossWinRate,
    winners: summary.winners, winRate: summary.winRate,
    meanGross: summary.meanGross, meanBaseNet: summary.meanBaseNet,
    meanStressNet: summary.meanStressNet, sumBaseNet: summary.sumBaseNet,
    profitFactor: summary.profitFactor, baseSumWithoutBestFive: summary.baseSumWithoutBestFive,
    positiveDateClusters: summary.positiveDateClusters,
  });
  console.log(JSON.stringify({
    status: report.status, all: brief(all), coverageByYear,
    byYear: Object.fromEntries(Object.entries(byYear).map(([year, summary]) => [year, brief(summary)])),
    blocks: Object.fromEntries(Object.entries(blocks).map(([block, summary]) => [block, brief(summary)])),
    unresolvedEntered, unresolvedEventWindows,
    missing: windows.filter((window) => window.status === 'missing_candles'), reportPath,
  }, null, 2));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  try { main(); } catch (error) {
    console.error(`CBR/SBER research failed: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  }
}

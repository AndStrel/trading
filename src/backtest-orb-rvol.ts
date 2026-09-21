import { pathToFileURL } from 'node:url';

import { loadConfig } from './config.js';
import {
  DEFAULT_REPLAY_TICKERS,
  parseReplayArgs,
  type ReplayCliOptions,
} from './backtest-replay.js';
import {
  collectOrbRvolResearch,
  DEFAULT_ORB_RVOL_PARAMETERS,
  type OrbRvolMarketBreadth,
  type OrbRvolParameters,
  type OrbRvolReport,
  type OrbRvolResearchMode,
  type OrbRvolSessionSchedule,
} from './backtest/orb-rvol.js';
import { getMoexEquities2025SessionSchedule } from './backtest/orb-rvol-calendar.js';
import { buildOrbRvolOpeningRangeBreadth } from './backtest/orb-rvol-breadth.js';
import { MarketDataStore } from './history/market-data-store.js';

export type OrbRvolResearchModeName = 'legacy' | 'retest-breadth';

export type OrbRvolCliOptions = {
  replay: ReplayCliOptions;
  sessionStartMinuteMoscow: number | null;
  sessionEndMinuteMoscow: number | null;
  mode: OrbRvolResearchModeName;
};

export type OrbRvolArchiveMetadata = {
  ticker: string;
  instrumentId: string;
  archiveSha256: string;
  storedCandleCount: number;
  invalidRowCount: number;
  lotSize: number | null;
  priceStep: number | null;
  importedAt: string;
};

export type OrbRvolRunResult = {
  status: 'ok';
  mode: 'orb-rvol-research' | 'orb-rvol-retest-breadth-research';
  year: number;
  requestedTickers: string[];
  sessionSchedule: OrbRvolSessionSchedule;
  sourceCommit: string | null;
  archives: OrbRvolArchiveMetadata[];
  report: OrbRvolReport;
};

const usage = `Usage:
  npm run backtest:replay:orb-rvol -- --year 2025 --session-start 10:00 --session-end 18:40
  npm run backtest:replay:orb-rvol -- --year 2025 --ticker SBER,GAZP --session-start 10:00 --session-end 18:40
  npm run backtest:replay:orb-rvol -- --mode retest-breadth --year 2025 --session-start 10:00 --session-end 18:40

Collects all first opening-range breakout events from imported minute archives. The command is
read-only, does not send broker orders, and requires explicit historical session hours so an
unverified current exchange schedule cannot silently change the experiment.

The fixed session profile is recorded in the JSON output. For 2025, date eligibility is
resolved by the versioned MOEX equity calendar; verify the supplied session hours separately.
The retest-breadth mode is research-only: it waits for a post-breakout retest and adds
a same-opening-range cross-sectional breadth filter; it never sends broker orders.`;

function parseClock(value: string, flag: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`${flag} must use HH:MM in Moscow time`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`${flag} contains an invalid Moscow time`);
  return hour * 60 + minute;
}

export function parseOrbRvolArgs(args: string[]): OrbRvolCliOptions {
  const replayArgs: string[] = [];
  let sessionStartMinuteMoscow: number | null = null;
  let sessionEndMinuteMoscow: number | null = null;
  let mode: OrbRvolResearchModeName = 'legacy';
  let modeProvided = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const [flag, inlineValue] = argument.split('=', 2);
    if (flag !== '--session-start' && flag !== '--session-end' && flag !== '--mode') {
      replayArgs.push(argument);
      continue;
    }
    const value = inlineValue ?? args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (inlineValue === undefined) index += 1;
    if (flag === '--mode') {
      if (modeProvided) throw new Error('--mode may be provided only once');
      if (value !== 'legacy' && value !== 'retest-breadth') {
        throw new Error('--mode must be legacy or retest-breadth');
      }
      mode = value;
      modeProvided = true;
      continue;
    }
    const minute = parseClock(value, flag);
    if (flag === '--session-start') {
      if (sessionStartMinuteMoscow !== null) throw new Error('--session-start may be provided only once');
      sessionStartMinuteMoscow = minute;
    } else {
      if (sessionEndMinuteMoscow !== null) throw new Error('--session-end may be provided only once');
      sessionEndMinuteMoscow = minute;
    }
  }

  return {
    replay: parseReplayArgs(replayArgs),
    sessionStartMinuteMoscow,
    sessionEndMinuteMoscow,
    mode,
  };
}

function archiveRange(year: number): { from: string; to: string } {
  return {
    from: `${year}-01-01T00:00:00.000Z`,
    to: `${year + 1}-01-01T00:00:00.000Z`,
  };
}

function requireSessionSchedule(options: OrbRvolCliOptions): OrbRvolSessionSchedule {
  if (options.sessionStartMinuteMoscow === null || options.sessionEndMinuteMoscow === null) {
    throw new Error(
      'ORB RVOL requires both --session-start and --session-end. Check the dated exchange schedule before running.',
    );
  }
  if (options.sessionEndMinuteMoscow <= options.sessionStartMinuteMoscow) {
    throw new Error('--session-end must be after --session-start');
  }
  return {
    startMinuteMoscow: options.sessionStartMinuteMoscow,
    endMinuteMoscow: options.sessionEndMinuteMoscow,
    source: 'fixed-cli-profile; calendar=moex-equities-2025-v1 for 2025',
  };
}

export async function runOrbRvolResearch(options: OrbRvolCliOptions): Promise<OrbRvolRunResult> {
  if (options.replay.year === null) throw new Error(`An explicit --year is required.\n\n${usage}`);
  const sessionSchedule = requireSessionSchedule(options);
  const config = loadConfig();
  const requestedTickers = options.replay.tickers.length > 0 ? options.replay.tickers : [...DEFAULT_REPLAY_TICKERS];
  if (options.mode === 'retest-breadth' && requestedTickers.length < 5) {
    throw new Error('retest-breadth requires at least five requested tickers for its market-direction proxy');
  }
  const store = new MarketDataStore(config.marketDataPath);
  const range = archiveRange(options.replay.year);
  const archivesByTicker = new Map<string, ReturnType<MarketDataStore['listArchiveImports']>[number]>();
  for (const archive of store.listArchiveImports(options.replay.year)) {
    if (archive.ticker === null) continue;
    if (archivesByTicker.has(archive.ticker)) {
      throw new Error(`Historical archive provenance is ambiguous for ticker: ${archive.ticker}`);
    }
    archivesByTicker.set(archive.ticker, archive);
  }

  const definitions: Array<{
    instrument: { instrumentId: string; ticker: string; lotSize: number; priceStep: number };
    archive: ReturnType<MarketDataStore['listArchiveImports']>[number];
  }> = [];
  const archives: OrbRvolArchiveMetadata[] = [];
  const missingArchives: string[] = [];
  const missingMetadata: string[] = [];
  for (const ticker of requestedTickers) {
    const archive = archivesByTicker.get(ticker);
    if (!archive || archive.storedCandleCount === 0) {
      missingArchives.push(ticker);
      continue;
    }
    if (archive.lotSize === null || archive.priceStep === null) {
      missingMetadata.push(ticker);
      continue;
    }
    definitions.push({
      instrument: {
        instrumentId: archive.instrumentId,
        ticker,
        lotSize: archive.lotSize,
        priceStep: archive.priceStep,
      },
      archive,
    });
    archives.push({
      ticker,
      instrumentId: archive.instrumentId,
      archiveSha256: archive.archiveSha256,
      storedCandleCount: archive.storedCandleCount,
      invalidRowCount: archive.invalidRowCount,
      lotSize: archive.lotSize,
      priceStep: archive.priceStep,
      importedAt: archive.importedAt,
    });
  }
  if (missingArchives.length > 0) {
    throw new Error(
      `Historical archive for ${options.replay.year} is missing or empty for: ${missingArchives.join(', ')}. ` +
        'Import the requested ticker with current archive provenance before research.',
    );
  }
  if (missingMetadata.length > 0) {
    throw new Error(
      `Historical archive metadata is missing for: ${missingMetadata.join(', ')}. ` +
        'Re-import the archive so ticker, lot size and price step are captured together.',
    );
  }

  function* loadInstruments(): Generator<{
    instrument: { instrumentId: string; ticker: string; lotSize: number; priceStep: number };
    candles: ReturnType<MarketDataStore['listMinuteCandles']>;
  }> {
    for (const definition of definitions) {
      const candles = store.listMinuteCandles({
        instrumentId: definition.archive.instrumentId,
        from: range.from,
        to: range.to,
      });
      if (candles.length === 0) {
        throw new Error(`Historical archive for ${definition.instrument.ticker} returned no candles`);
      }
      yield { instrument: definition.instrument, candles };
    }
  }

  const parameters: OrbRvolParameters = {
    ...DEFAULT_ORB_RVOL_PARAMETERS,
    commissionRate: config.commissionRate,
    slippageRate: config.scanner.slippageRate,
  };
  const scheduleForSession = (session: {
    ticker: string;
    instrumentId: string;
    sessionDate: string;
  }): OrbRvolSessionSchedule | null =>
    options.replay.year === 2025
      ? getMoexEquities2025SessionSchedule({
          sessionDate: session.sessionDate,
          startMinuteMoscow: sessionSchedule.startMinuteMoscow,
          endMinuteMoscow: sessionSchedule.endMinuteMoscow,
        })
      : sessionSchedule;

  let marketBreadthByDate: Map<string, OrbRvolMarketBreadth | null> | null = null;
  if (options.mode === 'retest-breadth') {
    marketBreadthByDate = buildOrbRvolOpeningRangeBreadth({
      instruments: loadInstruments(),
      scheduleForSession,
      openingRangeMinutes: parameters.openingRangeMinutes,
      minValidInstruments: 5,
    });
  }
  const researchMode: OrbRvolResearchMode | undefined =
    options.mode === 'retest-breadth'
      ? {
          kind: 'retest-breadth',
          maxRetestWaitMinutes: 45,
          minMarketBreadthScore: 0.1,
          minMarketBreadthInstruments: 5,
          marketBreadthForSession: ({ sessionDate }) => marketBreadthByDate?.get(sessionDate) ?? null,
        }
      : undefined;
  const report = collectOrbRvolResearch({
    instruments: loadInstruments(),
    scheduleForSession,
    parameters,
    ...(researchMode ? { mode: researchMode } : {}),
  });

  return {
    status: 'ok',
    mode: options.mode === 'retest-breadth' ? 'orb-rvol-retest-breadth-research' : 'orb-rvol-research',
    year: options.replay.year,
    requestedTickers,
    sessionSchedule,
    sourceCommit: process.env.REPLAY_SOURCE_COMMIT?.trim() || process.env.GITHUB_SHA?.trim() || null,
    archives,
    report,
  };
}

async function main(): Promise<void> {
  const options = parseOrbRvolArgs(process.argv.slice(2));
  if (options.replay.help) {
    console.log(usage);
    return;
  }
  console.log(JSON.stringify(await runOrbRvolResearch(options)));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : 'unknown ORB RVOL research error';
    console.error(`ORB RVOL research failed: ${detail}`);
    process.exitCode = 1;
  });
}

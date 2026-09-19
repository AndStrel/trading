import { pathToFileURL } from 'node:url';

import { loadConfig } from './config.js';
import {
  DEFAULT_REPLAY_PARAMETERS,
  DEFAULT_REPLAY_PHASES,
  replayVwapPullback,
  type ReplayInstrument,
} from './backtest/replay.js';
import { MarketDataStore } from './history/market-data-store.js';
import {
  DEFAULT_MOEX_LIQUID_TICKERS,
  TInvestIntradayUniverseProvider,
} from './scanner/intraday-universe.js';
import { TInvestClient } from './tbank/client.js';

export const DEFAULT_REPLAY_TICKERS = DEFAULT_MOEX_LIQUID_TICKERS.slice(0, 20);

export type ReplayCliOptions = {
  year: number | null;
  tickers: string[];
  help: boolean;
};

const usage = `Usage:
  npm run backtest:replay -- --year 2025
  npm run backtest:replay -- --year 2025 --ticker SBER,GAZP

Replays the fixed vwap-pullback-v1 baseline from already imported one-minute archives.
It is read-only: the command never sends a broker order and fails rather than silently
dropping a requested ticker that lacks an imported archive.`;

function parseYear(value: string): number {
  const year = Number(value.trim());
  const latestCompleteYear = new Date().getUTCFullYear() - 1;
  if (!Number.isInteger(year) || year < 2000 || year > latestCompleteYear) {
    throw new Error(`--year must be an integer from 2000 through ${latestCompleteYear}`);
  }
  return year;
}

function parseTickers(value: string): string[] {
  const tickers = value
    .split(',')
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean);
  if (tickers.length === 0 || tickers.some((ticker) => !/^[A-Z0-9.-]{1,16}$/.test(ticker))) {
    throw new Error('--ticker must be a comma-separated list of exchange tickers');
  }
  return tickers;
}

export function parseReplayArgs(args: string[]): ReplayCliOptions {
  let year: number | null = null;
  const tickers: string[] = [];
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    const [flag, inlineValue] = argument.split('=', 2);
    const value = inlineValue ?? args[index + 1];
    if (flag !== '--year' && flag !== '--ticker') throw new Error(`Unknown argument: ${argument}`);
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (inlineValue === undefined) index += 1;

    if (flag === '--year') {
      if (year !== null) throw new Error('--year may be provided only once');
      year = parseYear(value);
    } else {
      tickers.push(...parseTickers(value));
    }
  }

  const uniqueTickers = [...new Set(tickers)];
  if (uniqueTickers.length > 20) throw new Error('--ticker accepts at most 20 instruments per replay');
  return { year, tickers: uniqueTickers, help };
}

function archiveRange(year: number): { from: string; to: string } {
  return {
    from: `${year}-01-01T00:00:00.000Z`,
    to: `${year + 1}-01-01T00:00:00.000Z`,
  };
}

async function main(): Promise<void> {
  const options = parseReplayArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  if (options.year === null) throw new Error(`An explicit --year is required.\n\n${usage}`);

  const config = loadConfig();
  const requestedTickers = options.tickers.length > 0 ? options.tickers : [...DEFAULT_REPLAY_TICKERS];
  const universeConfig = {
    ...config,
    scanner: {
      ...config.scanner,
      universeMode: 'moex-liquid' as const,
      universeTickers: requestedTickers,
      maxInstruments: requestedTickers.length,
    },
  };
  const client = new TInvestClient(config.token, config.baseUrl, { transport: config.transport });
  const snapshot = await new TInvestIntradayUniverseProvider(universeConfig, client).getSnapshot(new Date());
  if (snapshot.missingTickers.length > 0 || snapshot.instruments.length !== requestedTickers.length) {
    const missing = snapshot.missingTickers.length > 0 ? snapshot.missingTickers : requestedTickers;
    throw new Error(`Could not resolve all requested TQBR/RUB instruments: ${missing.join(', ')}`);
  }

  const store = new MarketDataStore(config.marketDataPath);
  const range = archiveRange(options.year);
  const missingArchives: string[] = [];
  const instruments: Array<{ instrument: ReplayInstrument; candles: ReturnType<MarketDataStore['listMinuteCandles']> }> = [];
  const archives: Array<{
    ticker: string;
    instrumentId: string;
    archiveSha256: string;
    storedCandleCount: number;
    invalidRowCount: number;
    lotSize: number | null;
    priceStep: number | null;
    importedAt: string;
  }> = [];
  const missingArchiveMetadata: string[] = [];
  for (const resolved of snapshot.instruments) {
    const archive = store.getArchiveImport(resolved.instrumentId, options.year);
    if (!archive || archive.storedCandleCount === 0) {
      missingArchives.push(resolved.ticker);
      continue;
    }
    if (archive.lotSize === null || archive.priceStep === null) {
      missingArchiveMetadata.push(resolved.ticker);
      continue;
    }
    const candles = store.listMinuteCandles({
      instrumentId: resolved.instrumentId,
      from: range.from,
      to: range.to,
    });
    if (candles.length === 0) {
      missingArchives.push(resolved.ticker);
      continue;
    }
    instruments.push({
      instrument: {
        instrumentId: resolved.instrumentId,
        ticker: resolved.ticker,
        lotSize: archive.lotSize,
        priceStep: archive.priceStep,
      },
      candles,
    });
    archives.push({
      ticker: resolved.ticker,
      instrumentId: resolved.instrumentId,
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
      `Historical archive for ${options.year} is missing or empty for: ${missingArchives.join(', ')}. ` +
        'Import the full requested universe before comparing results.',
    );
  }
  if (missingArchiveMetadata.length > 0) {
    throw new Error(
      `Historical replay metadata is missing for: ${missingArchiveMetadata.join(', ')}. ` +
        'Re-import the requested archive so its lot size and price step are captured with the archive.',
    );
  }

  const report = replayVwapPullback({
    instruments,
    phases:
      options.year === 2025
        ? DEFAULT_REPLAY_PHASES
        : [
            {
              id: 'out_of_sample',
              label: `Full ${options.year} (custom year; not the pre-registered 2025 split)`,
              from: `${options.year}-01-01`,
              to: `${options.year}-12-31`,
            },
          ],
    parameters: {
      ...DEFAULT_REPLAY_PARAMETERS,
      commissionRate: config.commissionRate,
      slippageRate: config.scanner.slippageRate,
      startingCapitalRub: config.backtest.startingCapitalRub,
      maxPositionRub: config.strategies.intraday.maxPositionRub,
      maxRiskRub: config.strategies.intraday.maxRiskRub,
      maxConcurrentPositions: config.backtest.maxConcurrentPositions,
      minAverageCandleTurnoverRub: config.scanner.minAverageCandleTurnoverRub,
    },
  });

  console.log(
    JSON.stringify({
      status: 'ok',
      year: options.year,
      requestedTickers,
      resolvedAt: snapshot.refreshedAt,
      archives,
      report,
    }),
  );
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : 'unknown replay error';
    console.error(`Historical replay failed: ${detail}`);
    process.exitCode = 1;
  });
}

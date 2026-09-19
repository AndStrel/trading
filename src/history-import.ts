import { loadConfig } from './config.js';
import { pathToFileURL } from 'node:url';
import { archiveSha256, parseHistoryMinuteArchive } from './history/history-archive.js';
import { MarketDataStore } from './history/market-data-store.js';
import { TInvestIntradayUniverseProvider } from './scanner/intraday-universe.js';
import { TInvestClient } from './tbank/client.js';
import { TInvestHistoryClient } from './tbank/history-client.js';

type ImportCliOptions = {
  years: number[];
  tickers: string[];
  help: boolean;
};

const usage = `Usage:
  npm run history:import -- --year 2025
  npm run history:import -- --year 2025 --year 2026 --ticker SBER,GAZP

Downloads the official annual ZIP archive of minute candles for the configured intraday universe,
validates it, and stores it in T_INVEST_MARKET_DATA_PATH. No broker orders are created.`;

function parseYears(raw: string): number[] {
  return raw.split(',').map((value) => {
    const year = Number(value.trim());
    const currentYear = new Date().getUTCFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > currentYear) {
      throw new Error(`--year must be an integer from 2000 through ${currentYear}`);
    }
    return year;
  });
}

function parseTickers(raw: string): string[] {
  const tickers = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (tickers.some((ticker) => !/^[A-Z0-9.-]{1,16}$/.test(ticker))) {
    throw new Error('--ticker must be a comma-separated list of exchange tickers');
  }
  return tickers;
}

export function parseHistoryImportArgs(args: string[]): ImportCliOptions {
  const years: number[] = [];
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
    if (flag !== '--year' && flag !== '--ticker') {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (inlineValue === undefined) index += 1;

    if (flag === '--year') years.push(...parseYears(value));
    else tickers.push(...parseTickers(value));
  }

  return {
    years: [...new Set(years)].sort((left, right) => left - right),
    tickers: [...new Set(tickers)],
    help,
  };
}

async function main(): Promise<void> {
  const options = parseHistoryImportArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  if (options.years.length === 0) throw new Error(`At least one --year is required.\n\n${usage}`);

  const config = loadConfig();
  const marketClient = new TInvestClient(config.token, config.baseUrl, { transport: config.transport });
  const universe = await new TInvestIntradayUniverseProvider(config, marketClient).getSnapshot(new Date());
  const requestedTickers = new Set(options.tickers);
  const instruments = universe.instruments.filter(
    (instrument) => requestedTickers.size === 0 || requestedTickers.has(instrument.ticker),
  );

  if (instruments.length === 0) {
    const suffix = options.tickers.length > 0 ? `: ${options.tickers.join(', ')}` : '';
    throw new Error(`No configured intraday instruments matched the import request${suffix}`);
  }

  const historyClient = new TInvestHistoryClient(config.token, config.historyDataUrl, {
    transport: config.transport,
  });
  const store = new MarketDataStore(config.marketDataPath);
  let failedImports = 0;

  for (const year of options.years) {
    for (const instrument of instruments) {
      try {
        const archive = await historyClient.getMinuteCandleArchive({
          ...(instrument.figi
            ? { figi: instrument.figi }
            : { instrumentId: instrument.instrumentId }),
          year,
        });
        const parsed = parseHistoryMinuteArchive(archive, {
          instrumentId: instrument.instrumentId,
          year,
        });
        const imported = store.importMinuteArchive({
          instrumentId: instrument.instrumentId,
          ticker: instrument.ticker,
          year,
          archiveSha256: archiveSha256(archive),
          lotSize: instrument.lotSize,
          priceStep: instrument.priceStep,
          candles: parsed.candles,
          rawRowCount: parsed.rawRowCount,
          invalidRowCount: parsed.invalidRowCount,
        });
        const coverage = store.getCoverage(instrument.instrumentId);

        console.log(
          JSON.stringify({
            status: 'imported',
            ticker: instrument.ticker,
            instrumentId: instrument.instrumentId,
            year,
            storedCandleCount: imported.storedCandleCount,
            invalidRowCount: parsed.invalidRowCount,
            duplicateRowCount: parsed.duplicateRowCount,
            coverage,
          }),
        );
      } catch (error) {
        failedImports += 1;
        const detail = error instanceof Error ? error.message : 'unknown import error';
        console.error(
          JSON.stringify({
            status: 'failed',
            ticker: instrument.ticker,
            instrumentId: instrument.instrumentId,
            year,
            error: detail,
          }),
        );
      }
    }
  }

  if (failedImports > 0) {
    throw new Error(`${failedImports} historical archive import(s) failed; successful imports were kept`);
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : 'unknown history import error';
    console.error(`T-Invest history import failed: ${detail}`);
    process.exitCode = 1;
  });
}

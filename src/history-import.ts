import { pathToFileURL } from 'node:url';

import { loadConfig } from './config.js';
import { archiveSha256, parseHistoryMinuteArchive } from './history/history-archive.js';
import { MarketDataStore } from './history/market-data-store.js';
import { MoexIssHistoryClient } from './moex/iss-history-client.js';
import { TInvestIntradayUniverseProvider } from './scanner/intraday-universe.js';
import { TInvestClient } from './tbank/client.js';
import { TInvestHistoryClient } from './tbank/history-client.js';

type HistorySource = 'auto' | 'tinvest' | 'moex';
type ImportCliOptions = { years: number[]; tickers: string[]; source: HistorySource; help: boolean };

const usage = `Usage:
  npm run history:import -- --year 2025
  npm run history:import -- --year 2023,2024,2025 --ticker SBER,GAZP --source auto

Downloads minute candles from T-Invest, with an automatic MOEX ISS fallback, validates them,
and stores them in T_INVEST_MARKET_DATA_PATH. No broker orders are created.

Options:
  --source auto|tinvest|moex   Data source (default: auto)`;

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
  const tickers = raw.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
  if (tickers.some((ticker) => !/^[A-Z0-9.-]{1,16}$/.test(ticker))) {
    throw new Error('--ticker must be a comma-separated list of exchange tickers');
  }
  return tickers;
}

export function parseHistoryImportArgs(args: string[]): ImportCliOptions {
  const years: number[] = [];
  const tickers: string[] = [];
  let source: HistorySource = 'auto';
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--help' || argument === '-h') { help = true; continue; }
    const [flag, inlineValue] = argument.split('=', 2);
    const value = inlineValue ?? args[index + 1];
    if (flag !== '--year' && flag !== '--ticker' && flag !== '--source') throw new Error(`Unknown argument: ${argument}`);
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (inlineValue === undefined) index += 1;
    if (flag === '--year') years.push(...parseYears(value));
    else if (flag === '--ticker') tickers.push(...parseTickers(value));
    else {
      if (value !== 'auto' && value !== 'tinvest' && value !== 'moex') throw new Error('--source must be auto, tinvest or moex');
      source = value;
    }
  }
  return { years: [...new Set(years)].sort((a, b) => a - b), tickers: [...new Set(tickers)], source, help };
}

async function main(): Promise<void> {
  const options = parseHistoryImportArgs(process.argv.slice(2));
  if (options.help) { console.log(usage); return; }
  if (options.years.length === 0) throw new Error(`At least one --year is required.\n\n${usage}`);
  if (options.source === 'moex' && options.tickers.length === 0) throw new Error('--ticker is required when --source=moex');

  const config = loadConfig();
  const store = new MarketDataStore(config.marketDataPath);
  const moexClient = new MoexIssHistoryClient(process.env.MOEX_ISS_BASE_URL);
  const tInvestHistoryClient = new TInvestHistoryClient(config.token, config.historyDataUrl, { transport: config.transport });
  type TInvestInstrument = Awaited<ReturnType<TInvestIntradayUniverseProvider['getSnapshot']>>['instruments'][number];
  let tInvestInstruments: TInvestInstrument[] = [];

  if (options.source !== 'moex') {
    try {
      const marketClient = new TInvestClient(config.token, config.baseUrl, { transport: config.transport });
      const universe = await new TInvestIntradayUniverseProvider(config, marketClient).getSnapshot(new Date());
      const requested = new Set(options.tickers);
      tInvestInstruments = universe.instruments.filter((item) => requested.size === 0 || requested.has(item.ticker));
      if (tInvestInstruments.length === 0) throw new Error(`No configured intraday instruments matched: ${options.tickers.join(', ')}`);
    } catch (error) {
      if (options.source === 'tinvest' || options.tickers.length === 0) throw error;
      console.warn(JSON.stringify({ status: 'source_fallback', from: 'tinvest', to: 'moex', error: error instanceof Error ? error.message : 'unknown metadata error' }));
    }
  }

  const tInvestByTicker = new Map(tInvestInstruments.map((item) => [item.ticker, item]));
  const tickers = options.tickers.length > 0 ? options.tickers : tInvestInstruments.map((item) => item.ticker);
  let failedImports = 0;

  async function importMoex(ticker: string, year: number): Promise<void> {
    const history = await moexClient.getMinuteHistory(ticker, year);
    const imported = store.importMinuteArchive({ ...history, year, source: 'moex' });
    console.log(JSON.stringify({
      status: history.invalidRowCount === 0 ? 'complete' : 'partial', source: 'moex', ticker, year,
      storedCandleCount: imported.storedCandleCount, invalidRowCount: history.invalidRowCount,
      duplicateRowCount: history.duplicateRowCount, firstCandleAt: history.candles[0]?.time ?? null,
      lastCandleAt: history.candles.at(-1)?.time ?? null, archiveSha256: history.archiveSha256,
    }));
  }

  for (const year of options.years) {
    for (const ticker of tickers) {
      try {
        const instrument = tInvestByTicker.get(ticker);
        if (options.source === 'moex' || !instrument) { await importMoex(ticker, year); continue; }
        try {
          const archive = await tInvestHistoryClient.getMinuteCandleArchive({
            ...(instrument.figi ? { figi: instrument.figi } : { instrumentId: instrument.instrumentId }), year,
          });
          const parsed = parseHistoryMinuteArchive(archive, { instrumentId: instrument.instrumentId, year });
          const digest = archiveSha256(archive);
          const imported = store.importMinuteArchive({ instrumentId: instrument.instrumentId, ticker, year,
            archiveSha256: digest, lotSize: instrument.lotSize, priceStep: instrument.priceStep,
            candles: parsed.candles, rawRowCount: parsed.rawRowCount, invalidRowCount: parsed.invalidRowCount,
            duplicateRowCount: parsed.duplicateRowCount, source: 'tinvest' });
          console.log(JSON.stringify({ status: parsed.invalidRowCount === 0 ? 'complete' : 'partial', source: 'tinvest', ticker, year,
            storedCandleCount: imported.storedCandleCount, invalidRowCount: parsed.invalidRowCount,
            duplicateRowCount: parsed.duplicateRowCount, firstCandleAt: parsed.candles[0]?.time ?? null,
            lastCandleAt: parsed.candles.at(-1)?.time ?? null, archiveSha256: digest }));
        } catch (error) {
          if (options.source !== 'auto') throw error;
          console.warn(JSON.stringify({ status: 'source_fallback', from: 'tinvest', to: 'moex', ticker, year,
            error: error instanceof Error ? error.message : 'unknown archive error' }));
          await importMoex(ticker, year);
        }
      } catch (error) {
        failedImports += 1;
        console.error(JSON.stringify({ status: 'failed', ticker, year, error: error instanceof Error ? error.message : 'unknown import error' }));
      }
    }
  }
  if (failedImports > 0) throw new Error(`${failedImports} historical import(s) failed; successful imports were kept`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error(`Historical data import failed: ${error instanceof Error ? error.message : 'unknown history import error'}`);
    process.exitCode = 1;
  });
}

import { loadConfig } from './config.js';
import {
  buildResearchSituations,
  RESEARCH_DATASET_VERSION,
  RESEARCH_OUTCOME_HORIZONS_MINUTES,
} from './research/situation-catalog.js';
import { MarketDataStore, type HistoricalMinuteCandle } from './history/market-data-store.js';

type ResearchCatalogCliOptions = {
  years: number[];
  tickers: string[];
  lookbackMinutes: number;
  stepMinutes: number;
  outcomeHorizonsMinutes: number[];
  help: boolean;
};

const usage = `Usage:
  npm run research:catalog -- --year 2023 --year 2024 --year 2025
  npm run research:catalog -- --year 2025 --ticker SBER,GAZP --step-minutes 5

Builds a research-only catalog of past-only numeric situations and forward outcomes
from already imported minute archives. It does not call broker APIs or create orders.`;

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

function parsePositiveInteger(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${flag} must be a positive integer`);
  return value;
}

function parseHorizons(raw: string): number[] {
  const horizons = raw.split(',').map((value) => parsePositiveInteger(value.trim(), '--outcome-minutes'));
  return [...new Set(horizons)].sort((left, right) => left - right);
}

export function parseResearchCatalogArgs(args: string[]): ResearchCatalogCliOptions {
  const years: number[] = [];
  const tickers: string[] = [];
  let lookbackMinutes = 30;
  let stepMinutes = 5;
  let outcomeHorizonsMinutes: number[] = [...RESEARCH_OUTCOME_HORIZONS_MINUTES];
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    const [flag, inlineValue] = argument.split('=', 2);
    const value = inlineValue ?? args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (inlineValue === undefined) index += 1;

    if (flag === '--year') years.push(...parseYears(value));
    else if (flag === '--ticker') tickers.push(...parseTickers(value));
    else if (flag === '--lookback-minutes') lookbackMinutes = parsePositiveInteger(value, flag);
    else if (flag === '--step-minutes') stepMinutes = parsePositiveInteger(value, flag);
    else if (flag === '--outcome-minutes') outcomeHorizonsMinutes = parseHorizons(value);
    else throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    years: [...new Set(years)].sort((left, right) => left - right),
    tickers: [...new Set(tickers)],
    lookbackMinutes,
    stepMinutes,
    outcomeHorizonsMinutes,
    help,
  };
}

function minuteGap(left: string, right: string): number {
  return (Date.parse(right) - Date.parse(left)) / 60_000;
}

function qualitySummary(
  candles: readonly HistoricalMinuteCandle[],
  rawRowCount: number,
  invalidRowCount: number,
  duplicateRowCount: number,
) {
  let largestGapMinutes = 0;
  let oneMinuteGapCount = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const gap = minuteGap(candles[index - 1]!.time, candles[index]!.time);
    if (gap === 1) oneMinuteGapCount += 1;
    largestGapMinutes = Math.max(largestGapMinutes, gap);
  }
  return {
    rawRowCount,
    invalidRowCount,
    duplicateRowCount,
    invalidRate: rawRowCount === 0 ? 0 : invalidRowCount / rawRowCount,
    storedCandleCount: candles.length,
    firstCandleAt: candles[0]?.time ?? null,
    lastCandleAt: candles.at(-1)?.time ?? null,
    largestGapMinutes,
    oneMinuteGapCount,
  };
}

async function main(): Promise<void> {
  const options = parseResearchCatalogArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  if (options.years.length === 0) throw new Error(`At least one --year is required.\n\n${usage}`);

  const config = loadConfig();
  const store = new MarketDataStore(config.marketDataPath);
  const requestedTickers = new Set(options.tickers);
  let archiveCount = 0;
  let catalogedSituations = 0;

  for (const year of options.years) {
    const archives = store
      .listArchiveImports(year)
      .filter((archive) => archive.ticker !== null && (requestedTickers.size === 0 || requestedTickers.has(archive.ticker)));

    for (const archive of archives) {
      archiveCount += 1;
      const candles = store.listMinuteCandles({
        instrumentId: archive.instrumentId,
        from: `${year}-01-01T00:00:00.000Z`,
        to: `${year + 1}-01-01T00:00:00.000Z`,
      });
      const quality = qualitySummary(
        candles,
        archive.rawRowCount,
        archive.invalidRowCount,
        archive.duplicateRowCount,
      );
      if (archive.ticker === null || candles.length === 0) {
        console.log(
          JSON.stringify({
            status: 'skipped',
            reason: 'empty-archive',
            ticker: archive.ticker,
            year,
            source: archive.source,
            quality,
          }),
        );
        continue;
      }

      const situations = buildResearchSituations(
        candles,
        {
          instrumentId: archive.instrumentId,
          ticker: archive.ticker,
          sourceYear: year,
          sourceArchiveSha256: archive.archiveSha256,
        },
        {
          lookbackMinutes: options.lookbackMinutes,
          stepMinutes: options.stepMinutes,
          outcomeHorizonsMinutes: options.outcomeHorizonsMinutes,
        },
      );
      store.replaceResearchSituations({
        datasetVersion: RESEARCH_DATASET_VERSION,
        instrumentId: archive.instrumentId,
        sourceYear: year,
        situations,
      });
      catalogedSituations += situations.length;
      console.log(
        JSON.stringify({
          status: 'cataloged',
          ticker: archive.ticker,
          instrumentId: archive.instrumentId,
          year,
          source: archive.source,
          datasetVersion: RESEARCH_DATASET_VERSION,
          situations: situations.length,
          quality,
        }),
      );
    }
  }

  if (archiveCount === 0) {
    const suffix = options.tickers.length > 0 ? `: ${options.tickers.join(', ')}` : '';
    throw new Error(`No imported historical archives matched the research catalog request${suffix}`);
  }
  console.log(
    JSON.stringify({
      status: 'complete',
      datasetVersion: RESEARCH_DATASET_VERSION,
      archives: archiveCount,
      situations: catalogedSituations,
    }),
  );
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

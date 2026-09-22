import { loadConfig } from './config.js';
import { MarketDataStore } from './history/market-data-store.js';
import { RESEARCH_DATASET_VERSION } from './research/situation-catalog.js';

type SimilarCliOptions = {
  ticker: string;
  observedAt: string;
  neighbors: number;
  help: boolean;
};

const usage = `Usage:
  npm run research:similar -- --ticker SBER --at 2025-06-03T08:30:00.000Z --neighbors 20

Finds past situations similar to one cataloged situation. The target timestamp is
used as a strict temporal cutoff, so future situations cannot become neighbors.`;

function parsePositiveInteger(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${flag} must be a positive integer`);
  return value;
}

export function parseResearchSimilarArgs(args: string[]): SimilarCliOptions {
  let ticker = '';
  let observedAt = '';
  let neighbors = 20;
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

    if (flag === '--ticker') ticker = value.trim().toUpperCase();
    else if (flag === '--at') observedAt = value;
    else if (flag === '--neighbors') neighbors = parsePositiveInteger(value, flag);
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (ticker && !/^[A-Z0-9.-]{1,16}$/.test(ticker)) throw new Error('--ticker is invalid');
  if (observedAt && Number.isNaN(Date.parse(observedAt))) throw new Error('--at must be an ISO timestamp');
  if (neighbors > 500) throw new Error('--neighbors cannot exceed 500');
  return { ticker, observedAt, neighbors, help };
}

async function main(): Promise<void> {
  const options = parseResearchSimilarArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  if (!options.ticker || !options.observedAt) throw new Error(`--ticker and --at are required.\n\n${usage}`);

  const store = new MarketDataStore(loadConfig().marketDataPath);
  const target = store.getResearchSituation({
    datasetVersion: RESEARCH_DATASET_VERSION,
    ticker: options.ticker,
    observedAt: options.observedAt,
  });
  if (!target) {
    throw new Error(
      `Research situation not found for ${options.ticker} at ${options.observedAt}. ` +
        'Build the catalog first and use an exact catalog timestamp.',
    );
  }

  const neighbors = store.findSimilarResearchSituations({
    datasetVersion: RESEARCH_DATASET_VERSION,
    featureVector: target.featureVector,
    before: target.featureAvailableAt,
    limit: options.neighbors,
    excludeSituationId: target.situationId,
  });
  console.log(
    JSON.stringify(
      {
        status: 'complete',
        datasetVersion: RESEARCH_DATASET_VERSION,
        target: {
          situationId: target.situationId,
          ticker: target.ticker,
          observedAt: target.observedAt,
          features: target.features,
          outcomes: target.outcomes,
        },
        neighbors: neighbors.map(({ featureVector: _featureVector, ...neighbor }) => neighbor),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}


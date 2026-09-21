import { createHash } from 'node:crypto';

import type { HistoricalMinuteCandle } from '../history/market-data-store.js';

export const RESEARCH_DATASET_VERSION = 'situation-v1';
export const RESEARCH_OUTCOME_HORIZONS_MINUTES = [15, 30, 60] as const;

export const RESEARCH_FEATURE_SPECS = [
  { name: 'return1mPct', scale: 0.2 },
  { name: 'return5mPct', scale: 0.5 },
  { name: 'return15mPct', scale: 1 },
  { name: 'return30mPct', scale: 2 },
  { name: 'range30mPct', scale: 2 },
  { name: 'realizedVol30mPct', scale: 0.2 },
  { name: 'volumeLogRatio30m', scale: 1 },
  { name: 'closeLocation30m', scale: 1 },
  { name: 'drawdown30mPct', scale: 2 },
  { name: 'runup30mPct', scale: 2 },
] as const;

export type ResearchFeatureName = (typeof RESEARCH_FEATURE_SPECS)[number]['name'];

export type ResearchFeatureSet = Record<ResearchFeatureName, number>;

export type ResearchOutcome = {
  horizonMinutes: number;
  terminalAt: string;
  forwardReturnPct: number;
  maxFavorablePct: number;
  maxAdversePct: number;
};

export type ResearchSituationRecord = {
  situationId: string;
  datasetVersion: string;
  instrumentId: string;
  ticker: string;
  sessionDate: string;
  observedAt: string;
  featureAvailableAt: string;
  sourceYear: number;
  sourceArchiveSha256: string;
  features: ResearchFeatureSet;
  featureVector: number[];
  outcomes: ResearchOutcome[];
};

export type ResearchCatalogOptions = {
  lookbackMinutes?: number;
  stepMinutes?: number;
  outcomeHorizonsMinutes?: readonly number[];
};

const MOSCOW_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function validateOptions(options: Required<ResearchCatalogOptions>): void {
  assertPositiveInteger(options.lookbackMinutes, 'Research lookbackMinutes');
  assertPositiveInteger(options.stepMinutes, 'Research stepMinutes');
  if (options.lookbackMinutes < 30) throw new Error('Research lookbackMinutes must be at least 30');
  if (options.lookbackMinutes > 240) throw new Error('Research lookbackMinutes cannot exceed 240');
  if (options.stepMinutes > options.lookbackMinutes) throw new Error('Research stepMinutes cannot exceed lookbackMinutes');
  if (options.outcomeHorizonsMinutes.length === 0) {
    throw new Error('Research outcomeHorizonsMinutes must not be empty');
  }
  for (const horizon of options.outcomeHorizonsMinutes) {
    assertPositiveInteger(horizon, 'Research outcome horizon');
    if (horizon > 240) throw new Error('Research outcome horizon cannot exceed 240 minutes');
  }
}

function dateKey(value: string): string {
  const parts = MOSCOW_DATE_FORMATTER.formatToParts(new Date(value));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error(`Unable to derive Moscow session date from ${value}`);
  return `${year}-${month}-${day}`;
}

function minuteDelta(left: string, right: string): number {
  return (Date.parse(right) - Date.parse(left)) / 60_000;
}

function percentageChange(current: number, previous: number): number {
  return (current / previous - 1) * 100;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxDrawdownPct(candles: HistoricalMinuteCandle[]): number {
  let highWatermark = candles[0]!.high;
  let result = 0;
  for (const candle of candles) {
    highWatermark = Math.max(highWatermark, candle.high);
    result = Math.min(result, percentageChange(candle.low, highWatermark));
  }
  return result;
}

function maxRunupPct(candles: HistoricalMinuteCandle[]): number {
  let lowWatermark = candles[0]!.low;
  let result = 0;
  for (const candle of candles) {
    lowWatermark = Math.min(lowWatermark, candle.low);
    result = Math.max(result, percentageChange(candle.high, lowWatermark));
  }
  return result;
}

function buildFeatures(candles: HistoricalMinuteCandle[], endIndex: number, lookbackMinutes: number): ResearchFeatureSet {
  const current = candles[endIndex]!;
  const window = candles.slice(endIndex - lookbackMinutes, endIndex + 1);
  const currentClose = current.close;
  const closes = window.map((candle) => candle.close);
  const logReturns = window.slice(1).map((candle, index) => Math.log(candle.close / closes[index]!));
  const minLow = Math.min(...window.map((candle) => candle.low));
  const maxHigh = Math.max(...window.map((candle) => candle.high));
  const averageVolume = mean(window.map((candle) => candle.volume));
  const closeLocation = maxHigh === minLow ? 0 : (2 * currentClose - maxHigh - minLow) / (maxHigh - minLow);

  const feature = {
    return1mPct: percentageChange(currentClose, candles[endIndex - 1]!.close),
    return5mPct: percentageChange(currentClose, candles[endIndex - 5]!.close),
    return15mPct: percentageChange(currentClose, candles[endIndex - 15]!.close),
    return30mPct: percentageChange(currentClose, candles[endIndex - 30]!.close),
    range30mPct: percentageChange(maxHigh, minLow),
    realizedVol30mPct: Math.sqrt(mean(logReturns.map((value) => value ** 2))) * 100,
    volumeLogRatio30m: Math.log1p(averageVolume > 0 ? current.volume / averageVolume : 0),
    closeLocation30m: Math.max(-1, Math.min(1, closeLocation)),
    drawdown30mPct: maxDrawdownPct(window),
    runup30mPct: maxRunupPct(window),
  } satisfies ResearchFeatureSet;

  for (const value of Object.values(feature)) {
    if (!Number.isFinite(value)) throw new Error('Research feature calculation produced a non-finite value');
  }
  return feature;
}

function buildFeatureVector(features: ResearchFeatureSet): number[] {
  return RESEARCH_FEATURE_SPECS.map(({ name, scale }) => features[name] / scale);
}

function buildOutcome(
  candles: HistoricalMinuteCandle[],
  endIndex: number,
  horizonMinutes: number,
): ResearchOutcome | null {
  const terminalIndex = endIndex + horizonMinutes;
  if (terminalIndex >= candles.length) return null;

  const entryClose = candles[endIndex]!.close;
  const futureWindow = candles.slice(endIndex + 1, terminalIndex + 1);
  if (futureWindow.length !== horizonMinutes) return null;

  return {
    horizonMinutes,
    terminalAt: candles[terminalIndex]!.time,
    forwardReturnPct: percentageChange(candles[terminalIndex]!.close, entryClose),
    maxFavorablePct: percentageChange(Math.max(...futureWindow.map((candle) => candle.high)), entryClose),
    maxAdversePct: percentageChange(Math.min(...futureWindow.map((candle) => candle.low)), entryClose),
  };
}

function situationId(instrumentId: string, observedAt: string): string {
  const digest = createHash('sha256').update(`${RESEARCH_DATASET_VERSION}\0${instrumentId}\0${observedAt}`).digest('hex');
  return `${RESEARCH_DATASET_VERSION}/${digest.slice(0, 32)}`;
}

function buildSegmentSituations(
  candles: HistoricalMinuteCandle[],
  segmentStart: number,
  segmentEnd: number,
  metadata: Pick<ResearchSituationRecord, 'instrumentId' | 'ticker' | 'sourceYear' | 'sourceArchiveSha256'>,
  options: Required<ResearchCatalogOptions>,
): ResearchSituationRecord[] {
  const firstEndIndex = segmentStart + options.lookbackMinutes;
  const situations: ResearchSituationRecord[] = [];
  for (let endIndex = firstEndIndex; endIndex < segmentEnd; endIndex += options.stepMinutes) {
    const features = buildFeatures(candles, endIndex, options.lookbackMinutes);
    const outcomes = options.outcomeHorizonsMinutes
      .map((horizonMinutes) => buildOutcome(candles.slice(segmentStart, segmentEnd), endIndex - segmentStart, horizonMinutes))
      .filter((outcome): outcome is ResearchOutcome => outcome !== null);
    const observedAt = candles[endIndex]!.time;
    situations.push({
      situationId: situationId(metadata.instrumentId, observedAt),
      datasetVersion: RESEARCH_DATASET_VERSION,
      instrumentId: metadata.instrumentId,
      ticker: metadata.ticker,
      sessionDate: dateKey(observedAt),
      observedAt,
      featureAvailableAt: observedAt,
      sourceYear: metadata.sourceYear,
      sourceArchiveSha256: metadata.sourceArchiveSha256,
      features,
      featureVector: buildFeatureVector(features),
      outcomes,
    });
  }
  return situations;
}

export function buildResearchSituations(
  candles: readonly HistoricalMinuteCandle[],
  metadata: Pick<ResearchSituationRecord, 'instrumentId' | 'ticker' | 'sourceYear' | 'sourceArchiveSha256'>,
  inputOptions: ResearchCatalogOptions = {},
): ResearchSituationRecord[] {
  const options: Required<ResearchCatalogOptions> = {
    lookbackMinutes: inputOptions.lookbackMinutes ?? 30,
    stepMinutes: inputOptions.stepMinutes ?? 5,
    outcomeHorizonsMinutes: [...(inputOptions.outcomeHorizonsMinutes ?? RESEARCH_OUTCOME_HORIZONS_MINUTES)],
  };
  validateOptions(options);

  const ordered = [...candles].sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  const situations: ResearchSituationRecord[] = [];
  let segmentStart = 0;
  for (let index = 1; index <= ordered.length; index += 1) {
    const isSegmentEnd = index === ordered.length || minuteDelta(ordered[index - 1]!.time, ordered[index]!.time) !== 1;
    if (!isSegmentEnd) continue;
    if (index - segmentStart > options.lookbackMinutes) {
      situations.push(
        ...buildSegmentSituations(ordered, segmentStart, index, metadata, options),
      );
    }
    segmentStart = index;
  }
  return situations;
}

export function researchFeatureNames(): ResearchFeatureName[] {
  return RESEARCH_FEATURE_SPECS.map(({ name }) => name);
}

export function researchVectorDistance(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) throw new Error('Research vectors must have the same dimension');
  return Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]!) ** 2, 0));
}

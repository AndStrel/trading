import { quotationToNumber, roundMoney, type Quotation } from './money.js';

type CandleLike = {
  open?: Quotation;
  high?: Quotation;
  low?: Quotation;
  close?: Quotation;
  volume?: string | number;
  time?: string;
  isComplete?: boolean;
};

type NormalizedCandle = {
  high: number;
  low: number;
  close: number;
  volume: number;
  time: string | null;
};

export type CandleTrend = 'up' | 'down' | 'flat' | 'insufficient_data';

export type CandleAnalysis = {
  status: 'ok' | 'insufficient_data';
  rawCandleCount: number;
  analyzedCandleCount: number;
  incompleteCandleCount: number;
  invalidCandleCount: number;
  latestClose: number | null;
  latestCandleTime: string | null;
  sma20: number | null;
  sma50: number | null;
  trend: CandleTrend;
  averageTrueRange14: number | null;
  volatilityPct: number | null;
  latestVolume: number | null;
  averageVolume20: number | null;
  relativeVolume: number | null;
  warnings: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asCandle(value: unknown): CandleLike | null {
  const record = asRecord(value);
  if (!record) return null;

  return record as CandleLike;
}

function asFiniteNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeCandle(value: unknown): NormalizedCandle | null {
  const candle = asCandle(value);
  if (!candle) return null;

  const high = quotationToNumber(candle.high);
  const low = quotationToNumber(candle.low);
  const close = quotationToNumber(candle.close);
  const volume = asFiniteNumber(candle.volume);
  if (
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    high < low ||
    close < low ||
    close > high ||
    volume < 0
  ) {
    return null;
  }

  return {
    high,
    low,
    close,
    volume,
    time: typeof candle.time === 'string' ? candle.time : null,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function lastAverage(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return average(values.slice(-period));
}

function calculateAtr(candles: NormalizedCandle[], period: number): number | null {
  if (candles.length <= period) return null;

  const trueRanges: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    if (!current || !previous) continue;
    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    );
  }

  return lastAverage(trueRanges, period);
}

function roundRatio(value: number | null): number | null {
  return value === null ? null : Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function readRawCandles(payload: unknown): unknown[] {
  const response = asRecord(payload);
  if (!response || !Array.isArray(response.candles)) {
    throw new Error('T-Invest candle response does not contain a candles array');
  }
  return response.candles;
}

export function analyzeCandles(payload: unknown): CandleAnalysis {
  const rawCandles = readRawCandles(payload);
  const normalized: NormalizedCandle[] = [];
  let incompleteCandleCount = 0;
  let invalidCandleCount = 0;

  for (const rawCandle of rawCandles) {
    const candle = asCandle(rawCandle);
    if (candle?.isComplete === false) {
      incompleteCandleCount += 1;
      continue;
    }

    const normalizedCandle = normalizeCandle(rawCandle);
    if (!normalizedCandle) {
      invalidCandleCount += 1;
      continue;
    }
    normalized.push(normalizedCandle);
  }

  const closes = normalized.map((candle) => candle.close);
  const volumes = normalized.map((candle) => candle.volume);
  const latest = normalized.at(-1) ?? null;
  const sma20 = lastAverage(closes, 20);
  const sma50 = lastAverage(closes, 50);
  const averageTrueRange14 = calculateAtr(normalized, 14);
  const latestVolume = latest?.volume ?? null;
  const averageVolume20 =
    volumes.length >= 21 ? average(volumes.slice(-21, -1)) : null;
  const relativeVolume =
    latestVolume !== null && averageVolume20 !== null && averageVolume20 > 0
      ? latestVolume / averageVolume20
      : null;
  const volatilityPct =
    latest && averageTrueRange14 !== null && latest.close > 0
      ? (averageTrueRange14 / latest.close) * 100
      : null;

  let trend: CandleTrend = 'insufficient_data';
  if (sma20 !== null && sma50 !== null && sma50 > 0) {
    const trendDistance = (sma20 - sma50) / sma50;
    if (trendDistance > 0.002) trend = 'up';
    else if (trendDistance < -0.002) trend = 'down';
    else trend = 'flat';
  }

  const warnings: string[] = [];
  if (normalized.length < 50) {
    warnings.push('Fewer than 50 complete valid candles: long trend is unavailable');
  }
  if (normalized.length <= 14) {
    warnings.push('Fewer than 15 complete valid candles: ATR volatility is unavailable');
  }
  if (normalized.length < 21) {
    warnings.push('Fewer than 21 complete valid candles: relative volume is unavailable');
  }
  if (incompleteCandleCount > 0) {
    warnings.push('Incomplete candles were excluded from the analysis');
  }
  if (invalidCandleCount > 0) {
    warnings.push('Invalid candle records were excluded from the analysis');
  }

  return {
    status: warnings.some((warning) => warning.startsWith('Fewer than 50')) ? 'insufficient_data' : 'ok',
    rawCandleCount: rawCandles.length,
    analyzedCandleCount: normalized.length,
    incompleteCandleCount,
    invalidCandleCount,
    latestClose: latest ? roundMoney(latest.close) : null,
    latestCandleTime: latest?.time ?? null,
    sma20: sma20 === null ? null : roundMoney(sma20),
    sma50: sma50 === null ? null : roundMoney(sma50),
    trend,
    averageTrueRange14: averageTrueRange14 === null ? null : roundMoney(averageTrueRange14),
    volatilityPct: volatilityPct === null ? null : roundMoney(volatilityPct),
    latestVolume: latestVolume === null ? null : roundRatio(latestVolume),
    averageVolume20: averageVolume20 === null ? null : roundRatio(averageVolume20),
    relativeVolume: roundRatio(relativeVolume),
    warnings,
  };
}

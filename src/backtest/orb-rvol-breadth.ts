import type { HistoricalMinuteCandle } from '../history/market-data-store.js';
import type {
  OrbRvolInstrument,
  OrbRvolMarketBreadth,
  OrbRvolSessionSchedule,
} from './orb-rvol.js';

type PreparedMinuteCandle = HistoricalMinuteCandle & {
  epochMs: number;
  sessionDate: string;
  minuteOfDayMoscow: number;
};

export type OrbRvolBreadthInput = {
  instruments: Iterable<{
    instrument: OrbRvolInstrument;
    candles: HistoricalMinuteCandle[];
  }>;
  scheduleForSession: (input: {
    ticker: string;
    instrumentId: string;
    sessionDate: string;
  }) => OrbRvolSessionSchedule | null;
  openingRangeMinutes: number;
  minValidInstruments: number;
};

const MINUTE_MS = 60_000;
const MOSCOW_OFFSET_MS = 3 * 60 * MINUTE_MS;

function moscowParts(epochMs: number): { date: string; minuteOfDay: number } {
  const local = new Date(epochMs + MOSCOW_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return {
    date: `${year}-${month}-${day}`,
    minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

function isValidMinuteCandle(candle: HistoricalMinuteCandle): boolean {
  const values = [candle.open, candle.high, candle.low, candle.close, candle.volume];
  return (
    candle.instrumentId.trim().length > 0 &&
    values.every(Number.isFinite) &&
    candle.open > 0 &&
    candle.high >= candle.low &&
    candle.open >= candle.low &&
    candle.open <= candle.high &&
    candle.close >= candle.low &&
    candle.close <= candle.high &&
    Number.isSafeInteger(candle.volume) &&
    candle.volume >= 0
  );
}

function prepareMinutes(candles: HistoricalMinuteCandle[], instrumentId: string): PreparedMinuteCandle[] {
  const prepared = candles.map((candle) => {
    if (candle.instrumentId !== instrumentId || !isValidMinuteCandle(candle)) {
      throw new Error(`Historical candle is invalid for ${instrumentId}`);
    }
    const epochMs = Date.parse(candle.time);
    if (!Number.isFinite(epochMs) || epochMs % MINUTE_MS !== 0) {
      throw new Error(`Historical candle timestamp is invalid for ${instrumentId}`);
    }
    const moscow = moscowParts(epochMs);
    return { ...candle, epochMs, sessionDate: moscow.date, minuteOfDayMoscow: moscow.minuteOfDay };
  });

  prepared.sort((left, right) => left.epochMs - right.epochMs);
  for (let index = 1; index < prepared.length; index += 1) {
    if (prepared[index - 1]!.epochMs === prepared[index]!.epochMs) {
      throw new Error(`Historical candle timestamp is duplicated for ${instrumentId}`);
    }
  }
  return prepared;
}

function groupBySession(candles: PreparedMinuteCandle[]): Map<string, PreparedMinuteCandle[]> {
  const sessions = new Map<string, PreparedMinuteCandle[]>();
  for (const candle of candles) {
    const session = sessions.get(candle.sessionDate) ?? [];
    session.push(candle);
    sessions.set(candle.sessionDate, session);
  }
  return sessions;
}

function openingRangeReturn(
  byMinute: ReadonlyMap<number, PreparedMinuteCandle>,
  startMinuteMoscow: number,
  openingRangeMinutes: number,
): number | null {
  let first: PreparedMinuteCandle | null = null;
  let previous: PreparedMinuteCandle | null = null;
  let last: PreparedMinuteCandle | null = null;
  for (let offset = 0; offset < openingRangeMinutes; offset += 1) {
    const candle = byMinute.get(startMinuteMoscow + offset);
    if (!candle || (previous && candle.epochMs !== previous.epochMs + MINUTE_MS)) return null;
    first ??= candle;
    previous = candle;
    last = candle;
  }
  if (!first || !last) return null;
  return (last.close / first.open - 1) * 100;
}

type BreadthBucket = {
  upCount: number;
  downCount: number;
  flatCount: number;
};

/**
 * Builds a same-session, cross-sectional market-direction proxy.
 *
 * Each instrument contributes only its completed opening-range drift, so the
 * value is known before any signal bar or retest. Flat instruments are shown
 * separately and are excluded from the signed score denominator.
 */
export function buildOrbRvolOpeningRangeBreadth(input: OrbRvolBreadthInput): Map<string, OrbRvolMarketBreadth | null> {
  if (!Number.isInteger(input.openingRangeMinutes) || input.openingRangeMinutes < 5) {
    throw new Error('openingRangeMinutes must be an integer of at least 5');
  }
  if (!Number.isInteger(input.minValidInstruments) || input.minValidInstruments < 1) {
    throw new Error('minValidInstruments must be a positive integer');
  }

  const buckets = new Map<string, BreadthBucket>();
  for (const { instrument, candles } of input.instruments) {
    const prepared = prepareMinutes(candles, instrument.instrumentId);
    for (const [sessionDate, session] of groupBySession(prepared)) {
      const schedule = input.scheduleForSession({
        ticker: instrument.ticker,
        instrumentId: instrument.instrumentId,
        sessionDate,
      });
      if (!schedule) continue;
      const byMinute = new Map(session.map((candle) => [candle.minuteOfDayMoscow, candle]));
      const rangeReturnPct = openingRangeReturn(
        byMinute,
        schedule.startMinuteMoscow,
        input.openingRangeMinutes,
      );
      if (rangeReturnPct === null) continue;

      const bucket = buckets.get(sessionDate) ?? { upCount: 0, downCount: 0, flatCount: 0 };
      if (rangeReturnPct > 0) bucket.upCount += 1;
      else if (rangeReturnPct < 0) bucket.downCount += 1;
      else bucket.flatCount += 1;
      buckets.set(sessionDate, bucket);
    }
  }

  const result = new Map<string, OrbRvolMarketBreadth | null>();
  for (const [sessionDate, bucket] of buckets) {
    const validInstrumentCount = bucket.upCount + bucket.downCount;
    const availableInstrumentCount = validInstrumentCount + bucket.flatCount;
    result.set(
      sessionDate,
      validInstrumentCount < input.minValidInstruments
        ? null
        : {
            score: (bucket.upCount - bucket.downCount) / validInstrumentCount,
            upCount: bucket.upCount,
            downCount: bucket.downCount,
            flatCount: bucket.flatCount,
            validInstrumentCount,
            availableInstrumentCount,
          },
    );
  }
  return result;
}

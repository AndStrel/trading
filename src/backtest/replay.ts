import { calculateTradePlan } from '../domain/trade-plan.js';
import type { HistoricalMinuteCandle } from '../history/market-data-store.js';

/**
 * A deliberately small, pre-registered intraday baseline. It is not an optimiser and it
 * does not submit orders. A completed five-minute bar may create a long signal; the replay
 * then enters at the open of the following one-minute bar, so no candle used by the signal
 * can also be used as the entry price.
 */
export const REPLAY_STRATEGY_ID = 'vwap-pullback-v1' as const;

export type ReplayInstrument = {
  instrumentId: string;
  ticker: string;
  lotSize: number;
  priceStep: number;
};

export type ReplayPhase = {
  id: 'development' | 'validation' | 'out_of_sample';
  label: string;
  /** Inclusive Moscow trading dates in YYYY-MM-DD form. */
  from: string;
  to: string;
};

/**
 * These dates and rules are fixed before inspecting the 2025 results. January--March are
 * available only as indicator warm-up; they are not scored. No parameter search is performed
 * inside the replay.
 */
export const DEFAULT_REPLAY_PHASES: readonly ReplayPhase[] = [
  {
    id: 'development',
    label: 'Development (fixed baseline)',
    from: '2025-04-01',
    to: '2025-08-31',
  },
  {
    id: 'validation',
    label: 'Validation (unchanged rules)',
    from: '2025-09-01',
    to: '2025-10-31',
  },
  {
    id: 'out_of_sample',
    label: 'Out-of-sample holdout (untouched)',
    from: '2025-11-01',
    to: '2025-12-31',
  },
] as const;

export type ReplayParameters = {
  commissionRate: number;
  slippageRate: number;
  startingCapitalRub: number;
  maxPositionRub: number;
  maxRiskRub: number;
  maxConcurrentPositions: number;
  minAverageCandleTurnoverRub: number;
  minRelativeVolume: number;
  minTrendDistance: number;
  maxHoldingMinutes: number;
  minSignalMinuteMoscow: number;
  maxSignalMinuteMoscow: number;
  forceExitMinuteMoscow: number;
};

export const DEFAULT_REPLAY_PARAMETERS: Omit<
  ReplayParameters,
  | 'commissionRate'
  | 'slippageRate'
  | 'startingCapitalRub'
  | 'maxPositionRub'
  | 'maxRiskRub'
  | 'maxConcurrentPositions'
  | 'minAverageCandleTurnoverRub'
> = {
  minRelativeVolume: 1,
  minTrendDistance: 0.002,
  maxHoldingMinutes: 90,
  // Signals first become possible after the 50 five-minute-bar warm-up. Keeping the window
  // away from the open and evening session makes the first baseline intentionally conservative.
  minSignalMinuteMoscow: 14 * 60 + 10,
  maxSignalMinuteMoscow: 17 * 60 + 15,
  forceExitMinuteMoscow: 18 * 60 + 40,
};

export type ReplayInput = {
  instruments: Array<{
    instrument: ReplayInstrument;
    candles: HistoricalMinuteCandle[];
  }>;
  phases?: readonly ReplayPhase[];
  parameters: ReplayParameters;
};

export type ReplayExitReason = 'target' | 'stop' | 'time_exit' | 'session_exit' | 'data_gap';

export type ReplayTrade = {
  ticker: string;
  instrumentId: string;
  sessionDate: string;
  signalAt: string;
  entryAt: string;
  exitAt: string;
  exitReason: ReplayExitReason;
  lots: number;
  units: number;
  entryMarketPrice: number;
  entryFillPrice: number;
  stopPrice: number;
  targetPrice: number;
  exitMarketPrice: number;
  exitFillPrice: number;
  marketPnlRub: number;
  totalSlippageRub: number;
  totalCommissionRub: number;
  pnlAfterSlippageRub: number;
  netPnlRub: number;
};

export type ReplaySkippedCandidates = {
  invalidTradePlan: number;
  portfolioCapacity: number;
  insufficientCash: number;
  instrumentAlreadyOpen: number;
  instrumentSessionLimit: number;
};

export type ReplayTickerSummary = {
  ticker: string;
  tradeCount: number;
  netPnlRub: number;
  winRate: number | null;
};

export type ReplayPhaseReport = {
  phase: ReplayPhase;
  signalCount: number;
  planApprovedCount: number;
  /** Approved signals omitted because the archive ends before a terminal exit is observable. */
  incompleteDataTradeCount: number;
  /** Signals whose next executable minute is absent from the archive. */
  missingEntryDataCount: number;
  /** Earliest incomplete entry; results after this point are intentionally not scheduled. */
  portfolioTruncatedAt: string | null;
  executedTradeCount: number;
  skipped: ReplaySkippedCandidates;
  startingCapitalRub: number;
  endingCapitalRub: number;
  returnPct: number;
  marketPnlRub: number;
  pnlAfterSlippageRub: number;
  totalSlippageRub: number;
  totalCommissionRub: number;
  netPnlRub: number;
  winRate: number | null;
  profitFactor: number | null;
  realizedMaxDrawdownRub: number;
  exitReasons: Record<ReplayExitReason, number>;
  tickerResults: ReplayTickerSummary[];
  /** Complete deterministic ledger for audit/recalculation; it never contains credentials. */
  trades: ReplayTrade[];
  warnings: string[];
};

export type ReplayReport = {
  strategyId: typeof REPLAY_STRATEGY_ID;
  strategyRules: string[];
  /** Full validated input set needed to reproduce this report. */
  parameters: ReplayParameters;
  costModel: {
    commissionRatePerSide: number;
    slippageRatePerSide: number;
    roundTripCostRate: number;
  };
  data: Array<{
    ticker: string;
    instrumentId: string;
    minuteCandleCount: number;
    firstCandleAt: string | null;
    lastCandleAt: string | null;
  }>;
  phases: ReplayPhaseReport[];
  warnings: string[];
};

type PreparedMinuteCandle = HistoricalMinuteCandle & {
  epochMs: number;
  sessionDate: string;
  minuteOfDayMoscow: number;
};

type FiveMinuteBar = {
  startAt: string;
  endAt: string;
  sessionDate: string;
  minuteOfDayMoscow: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Candidate = {
  ticker: string;
  instrumentId: string;
  sessionDate: string;
  signalAt: string;
  entryAt: string;
  exitAt: string;
  exitReason: ReplayExitReason;
  lotSize: number;
  lots: number;
  units: number;
  entryMarketPrice: number;
  stopPrice: number;
  targetPrice: number;
  exitMarketPrice: number;
};

type IncompleteCandidate = Omit<Candidate, 'exitAt' | 'exitReason' | 'exitMarketPrice'>;

type CandidateBuildResult = {
  candidates: Candidate[];
  rejectedPlanSessionDates: string[];
  incompleteCandidates: IncompleteCandidate[];
  missingEntrySessionDates: string[];
};

type ActivePosition = {
  candidate: Candidate;
  trade: ReplayTrade;
  releaseCashRub: number;
};

const MINUTE_MS = 60_000;
const FIVE_MINUTE_MS = 5 * MINUTE_MS;
const MOSCOW_OFFSET_MS = 3 * 60 * MINUTE_MS;

function round(value: number, decimals = 2): number {
  const multiplier = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and greater than zero`);
}

function assertRate(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 0.1) {
    throw new Error(`${name} must be a finite rate from 0 through 0.1`);
  }
}

function assertMinuteOfDay(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= 24 * 60) {
    throw new Error(`${name} must be a Moscow minute from 0 through 1439`);
  }
}

function assertDate(value: string, name: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must use YYYY-MM-DD`);
}

function validateParameters(parameters: ReplayParameters): void {
  assertRate(parameters.commissionRate, 'commissionRate');
  assertRate(parameters.slippageRate, 'slippageRate');
  assertFinitePositive(parameters.startingCapitalRub, 'startingCapitalRub');
  assertFinitePositive(parameters.maxPositionRub, 'maxPositionRub');
  assertFinitePositive(parameters.maxRiskRub, 'maxRiskRub');
  if (!Number.isInteger(parameters.maxConcurrentPositions) || parameters.maxConcurrentPositions < 1) {
    throw new Error('maxConcurrentPositions must be a positive integer');
  }
  assertFinitePositive(parameters.minAverageCandleTurnoverRub, 'minAverageCandleTurnoverRub');
  assertFinitePositive(parameters.minRelativeVolume, 'minRelativeVolume');
  if (!Number.isFinite(parameters.minTrendDistance) || parameters.minTrendDistance < 0) {
    throw new Error('minTrendDistance must be finite and non-negative');
  }
  if (!Number.isInteger(parameters.maxHoldingMinutes) || parameters.maxHoldingMinutes < 1) {
    throw new Error('maxHoldingMinutes must be a positive integer');
  }
  assertMinuteOfDay(parameters.minSignalMinuteMoscow, 'minSignalMinuteMoscow');
  assertMinuteOfDay(parameters.maxSignalMinuteMoscow, 'maxSignalMinuteMoscow');
  assertMinuteOfDay(parameters.forceExitMinuteMoscow, 'forceExitMinuteMoscow');
  if (
    parameters.minSignalMinuteMoscow > parameters.maxSignalMinuteMoscow ||
    parameters.maxSignalMinuteMoscow >= parameters.forceExitMinuteMoscow
  ) {
    throw new Error('Signal window must be ordered and end before the forced exit time');
  }
}

function moscowParts(epochMs: number): { date: string; minuteOfDay: number } {
  // Moscow had no daylight-saving changes in the tested archive years. Keeping this explicit
  // avoids a locale-dependent runtime and makes the 5-minute replay deterministic in Node.
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
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0 &&
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

function toFiveMinuteBars(session: PreparedMinuteCandle[]): FiveMinuteBar[] {
  const groups = new Map<number, PreparedMinuteCandle[]>();
  for (const candle of session) {
    const bucket = Math.floor(candle.epochMs / FIVE_MINUTE_MS) * FIVE_MINUTE_MS;
    const candles = groups.get(bucket) ?? [];
    candles.push(candle);
    groups.set(bucket, candles);
  }

  const bars: FiveMinuteBar[] = [];
  for (const [bucket, candles] of [...groups.entries()].sort(([left], [right]) => left - right)) {
    candles.sort((left, right) => left.epochMs - right.epochMs);
    if (!isCompleteFiveMinuteBucket(candles)) {
      continue;
    }
    const first = candles[0]!;
    const last = candles.at(-1)!;
    bars.push({
      startAt: new Date(bucket).toISOString(),
      endAt: last.time,
      sessionDate: first.sessionDate,
      minuteOfDayMoscow: first.minuteOfDayMoscow,
      open: first.open,
      high: Math.max(...candles.map((candle) => candle.high)),
      low: Math.min(...candles.map((candle) => candle.low)),
      close: last.close,
      volume: candles.reduce((total, candle) => total + candle.volume, 0),
    });
  }
  return bars;
}

function isCompleteFiveMinuteBucket(candles: readonly PreparedMinuteCandle[]): boolean {
  return (
    candles.length === 5 &&
    candles.every(
      (candle, index) => index === 0 || candle.epochMs === candles[index - 1]!.epochMs + MINUTE_MS,
    )
  );
}

function hasIncompleteSessionEdge(
  session: readonly PreparedMinuteCandle[],
  forceExitMinuteMoscow: number,
): { first: boolean; last: boolean } {
  const mainSession = session.filter((candle) => candle.minuteOfDayMoscow <= forceExitMinuteMoscow);
  if (mainSession.length === 0) return { first: false, last: false };

  const groups = new Map<number, PreparedMinuteCandle[]>();
  for (const candle of mainSession) {
    const bucket = Math.floor(candle.epochMs / FIVE_MINUTE_MS) * FIVE_MINUTE_MS;
    const candles = groups.get(bucket) ?? [];
    candles.push(candle);
    groups.set(bucket, candles);
  }
  const ordered = [...groups.entries()].sort(([left], [right]) => left - right).map(([, candles]) => candles);
  return {
    first: !isCompleteFiveMinuteBucket(ordered[0]!),
    last: !isCompleteFiveMinuteBucket(ordered.at(-1)!),
  };
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function tailAverage(values: readonly number[], period: number): number | null {
  return values.length < period ? null : average(values.slice(-period));
}

function averageTrueRange(
  sessionBars: readonly FiveMinuteBar[],
  index: number,
  period = 14,
  segmentStartIndex = 0,
): number | null {
  if (index - segmentStartIndex < period) return null;
  const ranges: number[] = [];
  for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
    const current = sessionBars[cursor]!;
    const previous = sessionBars[cursor - 1]!;
    ranges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    );
  }
  return average(ranges);
}

function roundDownToStep(value: number, step: number): number {
  return Math.floor((value + Number.EPSILON) / step) * step;
}

function roundUpToStep(value: number, step: number): number {
  return Math.ceil((value - Number.EPSILON) / step) * step;
}

function volumeReference(history: Map<number, number[]>, minuteOfDay: number): number | null {
  const values = history.get(minuteOfDay) ?? [];
  return tailAverage(values, 20);
}

function addSessionVolumes(history: Map<number, number[]>, bars: readonly FiveMinuteBar[]): void {
  for (const bar of bars) {
    const values = history.get(bar.minuteOfDayMoscow) ?? [];
    values.push(bar.volume);
    // Preserve exactly the data horizon used by the relative-volume calculation.
    if (values.length > 20) values.shift();
    history.set(bar.minuteOfDayMoscow, values);
  }
}

function simulateExit(input: {
  entryIndex: number;
  session: readonly PreparedMinuteCandle[];
  stopPrice: number;
  targetPrice: number;
  parameters: ReplayParameters;
}): { exitAt: string; exitReason: ReplayExitReason; exitMarketPrice: number } | null {
  const forcedExitIndex = input.session.findLastIndex(
    (candle) => candle.minuteOfDayMoscow <= input.parameters.forceExitMinuteMoscow,
  );
  if (forcedExitIndex < input.entryIndex) return null;

  const entry = input.session[input.entryIndex]!;
  const terminalEpochMs = entry.epochMs + Math.min(
    input.parameters.maxHoldingMinutes - 1,
    input.parameters.forceExitMinuteMoscow - entry.minuteOfDayMoscow,
  ) * MINUTE_MS;

  const endIndex = Math.min(
    forcedExitIndex,
    input.entryIndex + input.parameters.maxHoldingMinutes - 1,
  );
  let previous = input.session[input.entryIndex]!;

  for (let index = input.entryIndex; index <= endIndex; index += 1) {
    const candle = input.session[index]!;
    if (index > input.entryIndex && candle.epochMs !== previous.epochMs + MINUTE_MS) {
      return {
        // A missing minute makes the previous close unobservable as an exit decision.
        // Close at the first price we can actually observe after the gap; slippage is
        // still applied by the execution model below.
        exitAt: candle.time,
        exitReason: 'data_gap',
        exitMarketPrice: candle.open,
      };
    }

    const stopTouched = candle.low <= input.stopPrice;
    const targetTouched = candle.high >= input.targetPrice;
    // OHLC does not reveal the intrabar path. If both levels were touched in one minute,
    // deliberately assume the adverse stop happened first. This keeps the replay conservative.
    if (stopTouched) {
      return {
        exitAt: candle.time,
        exitReason: 'stop',
        // A gap below the stop fills at the opening price. Otherwise the level was crossed
        // intrabar, so use the stop itself; adverse slippage is applied separately later.
        exitMarketPrice: candle.open <= input.stopPrice ? candle.open : input.stopPrice,
      };
    }
    if (targetTouched) {
      return {
        exitAt: candle.time,
        exitReason: 'target',
        exitMarketPrice: input.targetPrice,
      };
    }
    previous = candle;
  }

  const ending = input.session[endIndex]!;
  // A final stored candle is not proof that the position could be closed there. If the
  // requested time/session exit is absent, drop the candidate instead of inventing a fill.
  if (ending.epochMs < terminalEpochMs) return null;
  return {
    exitAt: ending.time,
    exitReason: endIndex === forcedExitIndex ? 'session_exit' : 'time_exit',
    exitMarketPrice: ending.close,
  };
}

function buildCandidates(
  instrument: ReplayInstrument,
  candles: HistoricalMinuteCandle[],
  parameters: ReplayParameters,
): CandidateBuildResult {
  if (!instrument.instrumentId.trim() || !instrument.ticker.trim()) {
    throw new Error('Replay instrument requires instrumentId and ticker');
  }
  if (!Number.isInteger(instrument.lotSize) || instrument.lotSize <= 0) {
    throw new Error(`Replay lot size is invalid for ${instrument.ticker}`);
  }
  assertFinitePositive(instrument.priceStep, `Replay price step for ${instrument.ticker}`);

  const minutes = prepareMinutes(candles, instrument.instrumentId);
  const sessions = groupBySession(minutes);
  const globalCloses: number[] = [];
  const historicalVolumes = new Map<number, number[]>();
  const candidates: Candidate[] = [];
  const rejectedPlanSessionDates: string[] = [];
  const incompleteCandidates: IncompleteCandidate[] = [];
  const missingEntrySessionDates: string[] = [];
  let resetGlobalClosesAtSessionStart = false;

  for (const [, session] of sessions) {
    // Deliberately omit the evening session from all trend and volume indicators. The baseline
    // trades main-session liquidity only and must not let an after-hours print affect its next
    // day signal.
    const bars = toFiveMinuteBars(session).filter(
      (bar) => bar.minuteOfDayMoscow <= parameters.forceExitMinuteMoscow,
    );
    const incompleteEdge = hasIncompleteSessionEdge(session, parameters.forceExitMinuteMoscow);
    if (resetGlobalClosesAtSessionStart || incompleteEdge.first) {
      globalCloses.length = 0;
    }
    resetGlobalClosesAtSessionStart = incompleteEdge.last;
    let cumulativeTypicalVolume = 0;
    let cumulativeVolume = 0;
    let previousVwap: number | null = null;
    let segmentStartIndex = 0;
    const minuteIndexByEpoch = new Map(session.map((candle, index) => [candle.epochMs, index]));

    for (let index = 0; index < bars.length; index += 1) {
      const bar = bars[index]!;
      const lastBar = index > 0 ? bars[index - 1]! : null;
      const hasGapBeforeBar =
        lastBar !== null && Date.parse(bar.startAt) !== Date.parse(lastBar.startAt) + FIVE_MINUTE_MS;
      if (hasGapBeforeBar) {
        // `toFiveMinuteBars` deliberately omits incomplete buckets. Do not let its retained
        // neighbours become artificial indicator neighbours across that missing interval.
        segmentStartIndex = index;
        cumulativeTypicalVolume = 0;
        cumulativeVolume = 0;
        previousVwap = null;
        globalCloses.length = 0;
      }
      const previousBar = index > segmentStartIndex ? lastBar : null;
      const typicalPrice = (bar.high + bar.low + bar.close) / 3;
      cumulativeTypicalVolume += typicalPrice * bar.volume;
      cumulativeVolume += bar.volume;
      const vwap = cumulativeVolume > 0 ? cumulativeTypicalVolume / cumulativeVolume : null;
      const referenceVolume = volumeReference(historicalVolumes, bar.minuteOfDayMoscow);
      const relativeVolume =
        referenceVolume !== null && referenceVolume > 0 ? bar.volume / referenceVolume : null;
      globalCloses.push(bar.close);
      const sma20 = tailAverage(globalCloses, 20);
      const sma50 = tailAverage(globalCloses, 50);
      const atr14 = averageTrueRange(bars, index, 14, segmentStartIndex);
      const averageTurnover = average(
        bars
          .slice(Math.max(segmentStartIndex, index - 20), index)
          .map((previous) => previous.volume * previous.close * instrument.lotSize),
      );

      const signalReady =
        previousBar !== null &&
        index - segmentStartIndex >= 20 &&
        vwap !== null &&
        sma20 !== null &&
        sma50 !== null &&
        atr14 !== null &&
        referenceVolume !== null &&
        relativeVolume !== null &&
        averageTurnover !== null &&
        bar.minuteOfDayMoscow >= parameters.minSignalMinuteMoscow &&
        bar.minuteOfDayMoscow <= parameters.maxSignalMinuteMoscow &&
        sma20 > sma50 * (1 + parameters.minTrendDistance) &&
        averageTurnover >= parameters.minAverageCandleTurnoverRub &&
        relativeVolume >= parameters.minRelativeVolume &&
        previousVwap !== null &&
        previousBar.low <= previousVwap &&
        previousBar.close <= previousVwap * 1.001 &&
        bar.close > vwap &&
        bar.close > previousBar.high;

      if (!signalReady) {
        previousVwap = vwap;
        continue;
      }

      // The last minute in the completed five-minute bar has closed. The following minute's
      // open is therefore the earliest observable executable price in this replay.
      const entryEpochMs = Date.parse(bar.endAt) + MINUTE_MS;
      const entryIndex = minuteIndexByEpoch.get(entryEpochMs);
      if (entryIndex === undefined) {
        missingEntrySessionDates.push(bar.sessionDate);
        previousVwap = vwap;
        continue;
      }
      const entryCandle = session[entryIndex]!;
      if (entryCandle.minuteOfDayMoscow > parameters.forceExitMinuteMoscow) {
        previousVwap = vwap;
        continue;
      }

      const entryMarketPrice = entryCandle.open;
      const riskPerUnit = Math.max(atr14 * 1.5, entryMarketPrice * 0.001);
      const roundTripCostPerUnit =
        entryMarketPrice * (parameters.commissionRate * 2 + parameters.slippageRate * 2);
      // Two ticks beyond the theoretical break-even R/R line prevent a floating-point or
      // exchange-step rounding artefact from turning an intended 2.0R net trade into 1.999R.
      const targetDistance = Math.max(
        riskPerUnit * 2.5,
        riskPerUnit * 2 + roundTripCostPerUnit * 3 + instrument.priceStep * 2,
      );
      const stopPrice = roundDownToStep(entryMarketPrice - riskPerUnit, instrument.priceStep);
      const targetPrice = roundUpToStep(entryMarketPrice + targetDistance, instrument.priceStep);
      if (stopPrice <= 0 || stopPrice >= entryMarketPrice || targetPrice <= entryMarketPrice) {
        previousVwap = vwap;
        continue;
      }

      const plan = calculateTradePlan({
        side: 'long',
        entryPrice: entryMarketPrice,
        stopPrice,
        targetPrice,
        lotSize: instrument.lotSize,
        maxRiskRub: parameters.maxRiskRub,
        maxPositionRub: parameters.maxPositionRub,
        commissionRate: parameters.commissionRate,
        slippageRate: parameters.slippageRate,
      });
      if (!plan.allowed || plan.lots === 0 || plan.units === 0) {
        rejectedPlanSessionDates.push(bar.sessionDate);
        previousVwap = vwap;
        continue;
      }

      const exit = simulateExit({
        entryIndex,
        session,
        stopPrice,
        targetPrice,
        parameters,
      });
      const candidateBase: IncompleteCandidate = {
        ticker: instrument.ticker,
        instrumentId: instrument.instrumentId,
        sessionDate: bar.sessionDate,
        signalAt: bar.endAt,
        entryAt: entryCandle.time,
        lotSize: instrument.lotSize,
        lots: plan.lots,
        units: plan.units,
        entryMarketPrice,
        stopPrice,
        targetPrice,
      };
      if (!exit) {
        incompleteCandidates.push(candidateBase);
        previousVwap = vwap;
        continue;
      }

      candidates.push({
        ...candidateBase,
        exitAt: exit.exitAt,
        exitReason: exit.exitReason,
        exitMarketPrice: exit.exitMarketPrice,
      });
      previousVwap = vwap;
    }

    // Relative volume at a time-of-day is compared only to preceding completed sessions.
    // Adding this session after all of its bars are evaluated prevents same-day leakage.
    addSessionVolumes(historicalVolumes, bars);
  }

  return { candidates, rejectedPlanSessionDates, incompleteCandidates, missingEntrySessionDates };
}

function materializeTrade(candidate: Candidate, parameters: ReplayParameters): {
  trade: ReplayTrade;
  entryDebitRub: number;
  releaseCashRub: number;
} {
  const entryFillPrice = candidate.entryMarketPrice * (1 + parameters.slippageRate);
  const exitFillPrice = candidate.exitMarketPrice * (1 - parameters.slippageRate);
  const entryNotionalRub = round(entryFillPrice * candidate.units);
  const exitNotionalRub = round(exitFillPrice * candidate.units);
  const entryCommissionRub = round(entryNotionalRub * parameters.commissionRate);
  const exitCommissionRub = round(exitNotionalRub * parameters.commissionRate);
  const marketPnlRub = round((candidate.exitMarketPrice - candidate.entryMarketPrice) * candidate.units);
  const entrySlippageRub = (entryFillPrice - candidate.entryMarketPrice) * candidate.units;
  const exitSlippageRub = (candidate.exitMarketPrice - exitFillPrice) * candidate.units;
  const totalSlippageRub = round(entrySlippageRub + exitSlippageRub);
  const pnlAfterSlippageRub = round(exitNotionalRub - entryNotionalRub);
  const totalCommissionRub = round(entryCommissionRub + exitCommissionRub);
  const entryDebitRub = round(entryNotionalRub + entryCommissionRub);
  const releaseCashRub = round(exitNotionalRub - exitCommissionRub);
  const netPnlRub = round(releaseCashRub - entryDebitRub);

  return {
    trade: {
      ticker: candidate.ticker,
      instrumentId: candidate.instrumentId,
      sessionDate: candidate.sessionDate,
      signalAt: candidate.signalAt,
      entryAt: candidate.entryAt,
      exitAt: candidate.exitAt,
      exitReason: candidate.exitReason,
      lots: candidate.lots,
      units: candidate.units,
      entryMarketPrice: round(candidate.entryMarketPrice, 6),
      entryFillPrice: round(entryFillPrice, 6),
      stopPrice: round(candidate.stopPrice, 6),
      targetPrice: round(candidate.targetPrice, 6),
      exitMarketPrice: round(candidate.exitMarketPrice, 6),
      exitFillPrice: round(exitFillPrice, 6),
      marketPnlRub,
      totalSlippageRub,
      totalCommissionRub,
      pnlAfterSlippageRub,
      netPnlRub,
    },
    entryDebitRub,
    releaseCashRub,
  };
}

function entryDebitForCandidate(
  candidate: Pick<Candidate, 'entryMarketPrice' | 'units'>,
  parameters: ReplayParameters,
): number {
  const entryFillPrice = candidate.entryMarketPrice * (1 + parameters.slippageRate);
  const entryNotionalRub = round(entryFillPrice * candidate.units);
  const entryCommissionRub = round(entryNotionalRub * parameters.commissionRate);
  return round(entryNotionalRub + entryCommissionRub);
}

function emptySkippedCandidates(): ReplaySkippedCandidates {
  return {
    invalidTradePlan: 0,
    portfolioCapacity: 0,
    insufficientCash: 0,
    instrumentAlreadyOpen: 0,
    instrumentSessionLimit: 0,
  };
}

function inPhase(candidate: Candidate, phase: ReplayPhase): boolean {
  return candidate.sessionDate >= phase.from && candidate.sessionDate <= phase.to;
}

function summarizePhase(
  phase: ReplayPhase,
  candidates: Candidate[],
  rejectedPlanSessionDates: readonly string[],
  incompleteCandidates: readonly IncompleteCandidate[],
  missingEntrySessionDates: readonly string[],
  parameters: ReplayParameters,
): ReplayPhaseReport {
  const phaseIncompleteCandidates = incompleteCandidates
    .filter((candidate) => candidate.sessionDate >= phase.from && candidate.sessionDate <= phase.to)
    .sort((left, right) => left.entryAt.localeCompare(right.entryAt));
  const allPhaseCandidates = candidates.filter((candidate) => inPhase(candidate, phase));
  const phaseCandidates = allPhaseCandidates.sort(
    (left, right) => left.entryAt.localeCompare(right.entryAt) || left.ticker.localeCompare(right.ticker),
  );
  const portfolioEvents: Array<
    | { kind: 'complete'; candidate: Candidate }
    | { kind: 'incomplete'; candidate: IncompleteCandidate }
  > = [
    ...phaseCandidates.map((candidate) => ({ kind: 'complete' as const, candidate })),
    ...phaseIncompleteCandidates.map((candidate) => ({ kind: 'incomplete' as const, candidate })),
  ].sort(
    (left, right) =>
      left.candidate.entryAt.localeCompare(right.candidate.entryAt) ||
      left.candidate.ticker.localeCompare(right.candidate.ticker) ||
      left.kind.localeCompare(right.kind),
  );
  const skipped = emptySkippedCandidates();
  skipped.invalidTradePlan = rejectedPlanSessionDates.filter(
    (sessionDate) => sessionDate >= phase.from && sessionDate <= phase.to,
  ).length;
  const incompleteDataTradeCount = phaseIncompleteCandidates.length;
  const missingEntryDataCount = missingEntrySessionDates.filter(
    (sessionDate) => sessionDate >= phase.from && sessionDate <= phase.to,
  ).length;
  const active: ActivePosition[] = [];
  const trades: ReplayTrade[] = [];
  const tradedSessions = new Set<string>();
  let availableCash = parameters.startingCapitalRub;
  let portfolioTruncatedAt: string | null = null;

  const settleBefore = (entryAt: string): void => {
    const settled = active.filter((position) => position.candidate.exitAt < entryAt);
    if (settled.length === 0) return;
    for (const position of settled) availableCash += position.releaseCashRub;
    const settledSet = new Set(settled);
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (settledSet.has(active[index]!)) active.splice(index, 1);
    }
  };

  for (const event of portfolioEvents) {
    const candidate = event.candidate;
    settleBefore(candidate.entryAt);
    const sessionKey = `${candidate.ticker}:${candidate.sessionDate}`;
    if (tradedSessions.has(sessionKey)) {
      skipped.instrumentSessionLimit += 1;
      continue;
    }
    if (active.some((position) => position.candidate.instrumentId === candidate.instrumentId)) {
      skipped.instrumentAlreadyOpen += 1;
      continue;
    }
    if (active.length >= parameters.maxConcurrentPositions) {
      skipped.portfolioCapacity += 1;
      continue;
    }

    const entryDebitRub = entryDebitForCandidate(candidate, parameters);
    if (entryDebitRub > availableCash + 1e-8) {
      skipped.insufficientCash += 1;
      continue;
    }
    if (event.kind === 'incomplete') {
      // This candidate passed the same portfolio constraints as an executable trade, but its
      // exit is unknowable. Stop the phase here instead of allowing later trades to use future
      // knowledge or cash that may still be locked in this position.
      portfolioTruncatedAt = candidate.entryAt;
      break;
    }
    const completeCandidate = event.candidate;
    const materialized = materializeTrade(completeCandidate, parameters);
    availableCash -= materialized.entryDebitRub;
    active.push({
      candidate: completeCandidate,
      trade: materialized.trade,
      releaseCashRub: materialized.releaseCashRub,
    });
    trades.push(materialized.trade);
    tradedSessions.add(sessionKey);
  }

  for (const position of [...active].sort(
    (left, right) =>
      left.candidate.exitAt.localeCompare(right.candidate.exitAt) ||
      left.candidate.ticker.localeCompare(right.candidate.ticker),
  )) {
    availableCash += position.releaseCashRub;
  }

  const marketPnlRub = trades.reduce((total, trade) => total + trade.marketPnlRub, 0);
  const totalSlippageRub = trades.reduce((total, trade) => total + trade.totalSlippageRub, 0);
  const pnlAfterSlippageRub = trades.reduce((total, trade) => total + trade.pnlAfterSlippageRub, 0);
  const totalCommissionRub = trades.reduce((total, trade) => total + trade.totalCommissionRub, 0);
  const netPnlRub = trades.reduce((total, trade) => total + trade.netPnlRub, 0);
  const wins = trades.filter((trade) => trade.netPnlRub > 0);
  const losses = trades.filter((trade) => trade.netPnlRub < 0);
  const grossWins = wins.reduce((total, trade) => total + trade.netPnlRub, 0);
  const grossLosses = losses.reduce((total, trade) => total + Math.abs(trade.netPnlRub), 0);
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : null;

  let equity = parameters.startingCapitalRub;
  let peakEquity = equity;
  let realizedMaxDrawdownRub = 0;
  const pnlByExitAt = new Map<string, number>();
  for (const trade of trades) {
    pnlByExitAt.set(trade.exitAt, (pnlByExitAt.get(trade.exitAt) ?? 0) + trade.netPnlRub);
  }
  for (const [exitAt, netPnlRubAtTime] of [...pnlByExitAt.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    equity += netPnlRubAtTime;
    peakEquity = Math.max(peakEquity, equity);
    realizedMaxDrawdownRub = Math.max(realizedMaxDrawdownRub, peakEquity - equity);
  }

  const exitReasons: Record<ReplayExitReason, number> = {
    target: 0,
    stop: 0,
    time_exit: 0,
    session_exit: 0,
    data_gap: 0,
  };
  for (const trade of trades) exitReasons[trade.exitReason] += 1;

  const tickerResults = [...new Set(trades.map((trade) => trade.ticker))]
    .map((ticker) => {
      const tickerTrades = trades.filter((trade) => trade.ticker === ticker);
      const tickerWins = tickerTrades.filter((trade) => trade.netPnlRub > 0).length;
      return {
        ticker,
        tradeCount: tickerTrades.length,
        netPnlRub: round(tickerTrades.reduce((total, trade) => total + trade.netPnlRub, 0)),
        winRate: tickerTrades.length > 0 ? round(tickerWins / tickerTrades.length, 4) : null,
      };
    })
    .sort((left, right) => right.netPnlRub - left.netPnlRub || left.ticker.localeCompare(right.ticker));

  const warnings: string[] = [];
  if (trades.length < 20) {
    warnings.push('Fewer than 20 executed trades: this segment is too small for a reliability claim');
  }
  if (phase.id === 'out_of_sample' && trades.length < 30) {
    warnings.push('Out-of-sample has fewer than 30 trades; treat its result as exploratory only');
  }
  if (totalSlippageRub === 0 && trades.length > 0) {
    warnings.push('Slippage is zero; this understates executable costs');
  }
  if (totalCommissionRub === 0 && trades.length > 0) {
    warnings.push('Commission is zero; this understates broker costs');
  }
  if (incompleteDataTradeCount > 0) {
    warnings.push(
      portfolioTruncatedAt === null
        ? `${incompleteDataTradeCount} approved signal(s) had no observable terminal exit but were rejected by portfolio constraints`
        : `${incompleteDataTradeCount} approved signal(s) had no observable terminal exit; portfolio scheduling stops at ${portfolioTruncatedAt}`,
    );
  }
  if (missingEntryDataCount > 0) {
    warnings.push(`${missingEntryDataCount} signal(s) had no observable following-minute entry`);
  }

  return {
    phase,
    signalCount:
      allPhaseCandidates.length + skipped.invalidTradePlan + incompleteDataTradeCount + missingEntryDataCount,
    planApprovedCount: allPhaseCandidates.length + incompleteDataTradeCount,
    incompleteDataTradeCount,
    missingEntryDataCount,
    portfolioTruncatedAt,
    executedTradeCount: trades.length,
    skipped,
    startingCapitalRub: round(parameters.startingCapitalRub),
    endingCapitalRub: round(availableCash),
    returnPct: round(((availableCash - parameters.startingCapitalRub) / parameters.startingCapitalRub) * 100, 4),
    marketPnlRub: round(marketPnlRub),
    pnlAfterSlippageRub: round(pnlAfterSlippageRub),
    totalSlippageRub: round(totalSlippageRub),
    totalCommissionRub: round(totalCommissionRub),
    netPnlRub: round(netPnlRub),
    winRate: trades.length > 0 ? round(wins.length / trades.length, 4) : null,
    profitFactor: profitFactor === null ? null : round(profitFactor, 4),
    realizedMaxDrawdownRub: round(realizedMaxDrawdownRub),
    exitReasons,
    tickerResults,
    trades: [...trades].sort(
      (left, right) => left.entryAt.localeCompare(right.entryAt) || left.ticker.localeCompare(right.ticker),
    ),
    warnings,
  };
}

export function replayVwapPullback(input: ReplayInput): ReplayReport {
  const parameters = { ...input.parameters };
  validateParameters(parameters);
  const phases = input.phases ?? DEFAULT_REPLAY_PHASES;
  if (phases.length === 0) throw new Error('At least one replay phase is required');
  for (const phase of phases) {
    assertDate(phase.from, `Replay phase ${phase.id} from`);
    assertDate(phase.to, `Replay phase ${phase.id} to`);
    if (phase.from > phase.to) throw new Error(`Replay phase ${phase.id} has an invalid date range`);
  }

  const seenInstrumentIds = new Set<string>();
  const allCandidates: Candidate[] = [];
  const rejectedPlanSessionDates: string[] = [];
  const incompleteCandidates: IncompleteCandidate[] = [];
  const missingEntrySessionDates: string[] = [];
  const data = input.instruments.map(({ instrument, candles }) => {
    if (seenInstrumentIds.has(instrument.instrumentId)) {
      throw new Error(`Replay input contains duplicate instrument ${instrument.instrumentId}`);
    }
    seenInstrumentIds.add(instrument.instrumentId);
    const built = buildCandidates(instrument, candles, parameters);
    allCandidates.push(...built.candidates);
    rejectedPlanSessionDates.push(...built.rejectedPlanSessionDates);
    incompleteCandidates.push(...built.incompleteCandidates);
    missingEntrySessionDates.push(...built.missingEntrySessionDates);
    return {
      ticker: instrument.ticker,
      instrumentId: instrument.instrumentId,
      minuteCandleCount: candles.length,
      firstCandleAt: candles.length > 0 ? candles[0]!.time : null,
      lastCandleAt: candles.length > 0 ? candles.at(-1)!.time : null,
    };
  });

  const phaseReports = phases.map((phase) =>
    summarizePhase(
      phase,
      allCandidates,
      rejectedPlanSessionDates,
      incompleteCandidates,
      missingEntrySessionDates,
      parameters,
    ),
  );
  const warnings = [
    'The archive has OHLCV candles, not bid/ask quotes or actual fills; adverse per-side slippage is a model, not a measurement.',
    'The replay is long-only, uses no leverage, and permits at most one executed trade per ticker per Moscow session.',
    'A positive development or validation result does not validate the strategy. Interpret the untouched out-of-sample result separately.',
  ];
  if (data.some((item) => item.minuteCandleCount === 0)) {
    warnings.push('At least one requested instrument has no minute candles; do not compare partial-universe results.');
  }

  return {
    strategyId: REPLAY_STRATEGY_ID,
    strategyRules: [
      'Completed 5m bar: SMA20 is at least 0.2% above SMA50, with session VWAP pullback and reclaim.',
      '5m turnover filter and time-of-day relative volume use only earlier completed data.',
      'Entry is next 1m open; stop uses max(1.5 ATR14, 0.1%); target preserves 2.5R before costs.',
      'When one OHLC minute touches both stop and target, replay assigns the adverse stop first.',
    ],
    parameters,
    costModel: {
      commissionRatePerSide: parameters.commissionRate,
      slippageRatePerSide: parameters.slippageRate,
      roundTripCostRate: round(parameters.commissionRate * 2 + parameters.slippageRate * 2, 6),
    },
    data,
    phases: phaseReports,
    warnings,
  };
}

import type { HistoricalMinuteCandle } from '../history/market-data-store.js';

export const ORB_RVOL_STRATEGY_ID = 'orb-rvol-research-v1' as const;

export type OrbRvolInstrument = {
  instrumentId: string;
  ticker: string;
  lotSize: number;
  priceStep: number;
};

export type OrbRvolSessionSchedule = {
  startMinuteMoscow: number;
  endMinuteMoscow: number;
  source: string;
};

export type OrbRvolParameters = {
  openingRangeMinutes: number;
  signalWindowEndOffsetMinutes: number;
  maxHoldingMinutes: number;
  rvolLookbackSessions: number;
  minRelativeVolume: number;
  targetRiskMultiple: number;
  stopBufferTicks: number;
  minStopDistanceToRoundTripCost: number;
  commissionRate: number;
  slippageRate: number;
  forwardHorizonsMinutes: readonly number[];
};

export const DEFAULT_ORB_RVOL_PARAMETERS: OrbRvolParameters = {
  openingRangeMinutes: 30,
  signalWindowEndOffsetMinutes: 120,
  maxHoldingMinutes: 120,
  rvolLookbackSessions: 20,
  minRelativeVolume: 1.5,
  targetRiskMultiple: 2,
  stopBufferTicks: 1,
  minStopDistanceToRoundTripCost: 3,
  commissionRate: 0.0005,
  slippageRate: 0.0005,
  forwardHorizonsMinutes: [15, 30, 60, 120],
};

export type OrbRvolForwardReturn = {
  horizonMinutes: number;
  terminalAt: string | null;
  marketReturnPct: number | null;
  netReturnPct: number | null;
  status: 'complete' | 'data_gap' | 'outside_session';
};

export type OrbRvolExitReason = 'target' | 'stop' | 'time_exit' | 'data_gap' | 'incomplete_data';

export type OrbRvolStrategyExit = {
  reason: OrbRvolExitReason;
  exitAt: string | null;
  exitMarketPrice: number | null;
  marketReturnPct: number | null;
  netReturnPct: number | null;
};

export type OrbRvolEvent = {
  ticker: string;
  instrumentId: string;
  sessionDate: string;
  scheduleSource: string;
  sessionStartMinuteMoscow: number;
  sessionEndMinuteMoscow: number;
  openingRangeStartAt: string;
  openingRangeEndAt: string;
  openingRangeHigh: number;
  openingRangeLow: number;
  openingRangeVolume: number;
  previousOpeningRangeMedianVolume: number;
  relativeVolume: number;
  signalAt: string;
  signalBarOpen: number;
  signalBarHigh: number;
  signalBarLow: number;
  signalBarClose: number;
  entryAt: string;
  entryMarketPrice: number;
  stopPrice: number;
  targetPrice: number;
  riskPerUnit: number;
  riskPct: number;
  estimatedRoundTripCostPct: number;
  passesRelativeVolume: boolean;
  passesCostFilter: boolean;
  eligible: boolean;
  forwardReturns: OrbRvolForwardReturn[];
  strategyExit: OrbRvolStrategyExit;
};

export type OrbRvolRejectionReason =
  | 'no_main_session_data'
  | 'incomplete_opening_range'
  | 'insufficient_rvol_history'
  | 'incomplete_signal_bar'
  | 'entry_data_gap'
  | 'entry_open_not_above_range'
  | 'outside_trading_calendar';

export type OrbRvolRejection = {
  ticker: string;
  instrumentId: string;
  sessionDate: string;
  reason: OrbRvolRejectionReason;
  detail: string;
};

export type OrbRvolGroupName =
  | 'all_entry_events'
  | 'cost_eligible_low_rvol'
  | 'cost_eligible_high_rvol';

export type OrbRvolHorizonSummary = {
  horizonMinutes: number;
  availableCount: number;
  missingCount: number;
  averageMarketReturnPct: number | null;
  averageNetReturnPct: number | null;
  medianNetReturnPct: number | null;
  positiveNetRate: number | null;
};

export type OrbRvolGroupSummary = {
  group: OrbRvolGroupName;
  eventCount: number;
  horizons: OrbRvolHorizonSummary[];
};

export type OrbRvolDataQuality = {
  sessionCount: number;
  calendarRejectedSessionCount: number;
  completeOpeningRangeSessionCount: number;
  noMainSessionDataCount: number;
  incompleteOpeningRangeSessionCount: number;
  insufficientRvolHistorySessionCount: number;
  signalWindowGapSessionCount: number;
  breakoutCount: number;
  entryDataGapCount: number;
  entryOpenRejectedCount: number;
  strategyIncompleteDataCount: number;
  forwardReturnGapCount: number;
};

export type OrbRvolReport = {
  strategyId: typeof ORB_RVOL_STRATEGY_ID;
  parameters: OrbRvolParameters;
  data: Array<{
    ticker: string;
    instrumentId: string;
    lotSize: number;
    priceStep: number;
    minuteCandleCount: number;
    firstCandleAt: string | null;
    lastCandleAt: string | null;
  }>;
  dataQuality: OrbRvolDataQuality;
  events: OrbRvolEvent[];
  rejections: OrbRvolRejection[];
  summaries: OrbRvolGroupSummary[];
  warnings: string[];
};

export type OrbRvolInput = {
  instruments: Iterable<{
    instrument: OrbRvolInstrument;
    candles: HistoricalMinuteCandle[];
  }>;
  scheduleForSession: (input: {
    ticker: string;
    instrumentId: string;
    sessionDate: string;
  }) => OrbRvolSessionSchedule | null;
  parameters: OrbRvolParameters;
};

type PreparedMinuteCandle = HistoricalMinuteCandle & {
  epochMs: number;
  sessionDate: string;
  minuteOfDayMoscow: number;
};

type FiveMinuteBar = {
  startMinuteMoscow: number;
  startAt: string;
  endAt: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

const MINUTE_MS = 60_000;
const MOSCOW_OFFSET_MS = 3 * 60 * MINUTE_MS;

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

function validateParameters(parameters: OrbRvolParameters): void {
  if (!Number.isInteger(parameters.openingRangeMinutes) || parameters.openingRangeMinutes < 5) {
    throw new Error('openingRangeMinutes must be an integer of at least 5');
  }
  if (
    !Number.isInteger(parameters.signalWindowEndOffsetMinutes) ||
    parameters.signalWindowEndOffsetMinutes <= parameters.openingRangeMinutes ||
    parameters.signalWindowEndOffsetMinutes % 5 !== 0
  ) {
    throw new Error('signalWindowEndOffsetMinutes must be a five-minute offset after the opening range');
  }
  if (!Number.isInteger(parameters.maxHoldingMinutes) || parameters.maxHoldingMinutes < 1) {
    throw new Error('maxHoldingMinutes must be a positive integer');
  }
  if (!Number.isInteger(parameters.rvolLookbackSessions) || parameters.rvolLookbackSessions < 1) {
    throw new Error('rvolLookbackSessions must be a positive integer');
  }
  assertFinitePositive(parameters.minRelativeVolume, 'minRelativeVolume');
  assertFinitePositive(parameters.targetRiskMultiple, 'targetRiskMultiple');
  if (!Number.isInteger(parameters.stopBufferTicks) || parameters.stopBufferTicks < 1) {
    throw new Error('stopBufferTicks must be a positive integer');
  }
  assertFinitePositive(parameters.minStopDistanceToRoundTripCost, 'minStopDistanceToRoundTripCost');
  assertRate(parameters.commissionRate, 'commissionRate');
  assertRate(parameters.slippageRate, 'slippageRate');
  if (
    parameters.forwardHorizonsMinutes.length === 0 ||
    parameters.forwardHorizonsMinutes.some(
      (horizon) => !Number.isInteger(horizon) || horizon < 1 || horizon > parameters.maxHoldingMinutes,
    )
  ) {
    throw new Error('forwardHorizonsMinutes must contain positive integer horizons within maxHoldingMinutes');
  }
  if (new Set(parameters.forwardHorizonsMinutes).size !== parameters.forwardHorizonsMinutes.length) {
    throw new Error('forwardHorizonsMinutes must contain unique values');
  }
}

function validateSchedule(schedule: OrbRvolSessionSchedule): void {
  assertMinuteOfDay(schedule.startMinuteMoscow, 'session start minute');
  assertMinuteOfDay(schedule.endMinuteMoscow, 'session end minute');
  if (schedule.endMinuteMoscow <= schedule.startMinuteMoscow) {
    throw new Error('session end must be after session start');
  }
  if (!schedule.source.trim()) throw new Error('session schedule source is required');
}

function validateInstrument(instrument: OrbRvolInstrument): void {
  if (!instrument.instrumentId.trim() || !/^[A-Z0-9.-]{1,16}$/.test(instrument.ticker)) {
    throw new Error('ORB RVOL instrument identity is invalid');
  }
  if (!Number.isInteger(instrument.lotSize) || instrument.lotSize <= 0) {
    throw new Error(`ORB RVOL lot size is invalid for ${instrument.ticker}`);
  }
  assertFinitePositive(instrument.priceStep, `ORB RVOL price step for ${instrument.ticker}`);
}

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

function roundDownToStep(value: number, step: number): number {
  const quotient = value / step;
  return Number((Math.floor(quotient + Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8) * step).toPrecision(15));
}

function roundUpToStep(value: number, step: number): number {
  const quotient = value / step;
  return Number((Math.ceil(quotient - Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8) * step).toPrecision(15));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function buildCompleteFiveMinuteBar(
  byMinute: ReadonlyMap<number, PreparedMinuteCandle>,
  startMinuteMoscow: number,
): FiveMinuteBar | null {
  const candles: PreparedMinuteCandle[] = [];
  for (let offset = 0; offset < 5; offset += 1) {
    const candle = byMinute.get(startMinuteMoscow + offset);
    if (!candle) return null;
    if (candles.length > 0 && candle.epochMs !== candles.at(-1)!.epochMs + MINUTE_MS) return null;
    candles.push(candle);
  }
  const first = candles[0]!;
  const last = candles.at(-1)!;
  return {
    startMinuteMoscow,
    startAt: first.time,
    endAt: last.time,
    open: first.open,
    high: Math.max(...candles.map((candle) => candle.high)),
    low: Math.min(...candles.map((candle) => candle.low)),
    close: last.close,
  };
}

function isCompleteMinuteRange(
  byMinute: ReadonlyMap<number, PreparedMinuteCandle>,
  startMinuteMoscow: number,
  length: number,
): boolean {
  let previous: PreparedMinuteCandle | null = null;
  for (let offset = 0; offset < length; offset += 1) {
    const candle = byMinute.get(startMinuteMoscow + offset);
    if (!candle) return false;
    if (previous && candle.epochMs !== previous.epochMs + MINUTE_MS) return false;
    previous = candle;
  }
  return true;
}

function marketAndNetReturn(
  entryMarketPrice: number,
  exitMarketPrice: number,
  commissionRate: number,
  slippageRate: number,
): { marketReturnPct: number; netReturnPct: number } {
  const entryFillPrice = entryMarketPrice * (1 + slippageRate);
  const exitFillPrice = exitMarketPrice * (1 - slippageRate);
  const entryCommission = entryFillPrice * commissionRate;
  const exitCommission = exitFillPrice * commissionRate;
  const netPerUnit = exitFillPrice - entryFillPrice - entryCommission - exitCommission;
  return {
    marketReturnPct: (exitMarketPrice / entryMarketPrice - 1) * 100,
    netReturnPct: (netPerUnit / entryMarketPrice) * 100,
  };
}

function findNextObservableCandle(
  orderedSession: readonly PreparedMinuteCandle[],
  expectedMinuteMoscow: number,
  endMinuteMoscow: number,
): PreparedMinuteCandle | null {
  return (
    orderedSession.find(
      (candle) =>
        candle.minuteOfDayMoscow >= expectedMinuteMoscow && candle.minuteOfDayMoscow <= endMinuteMoscow,
    ) ?? null
  );
}

function simulateStrategyExit(input: {
  orderedSession: readonly PreparedMinuteCandle[];
  byMinute: ReadonlyMap<number, PreparedMinuteCandle>;
  entryMinuteMoscow: number;
  endMinuteMoscow: number;
  entryMarketPrice: number;
  stopPrice: number;
  targetPrice: number;
  parameters: OrbRvolParameters;
}): OrbRvolStrategyExit {
  const endHoldingMinute = Math.min(
    input.endMinuteMoscow,
    input.entryMinuteMoscow + input.parameters.maxHoldingMinutes - 1,
  );
  for (let offset = 0; offset <= endHoldingMinute - input.entryMinuteMoscow; offset += 1) {
    const expectedMinute = input.entryMinuteMoscow + offset;
    const candle = input.byMinute.get(expectedMinute);
    if (!candle) {
      const next = findNextObservableCandle(input.orderedSession, expectedMinute, input.endMinuteMoscow);
      if (!next) {
        return {
          reason: 'incomplete_data',
          exitAt: null,
          exitMarketPrice: null,
          marketReturnPct: null,
          netReturnPct: null,
        };
      }
      const returns = marketAndNetReturn(
        input.entryMarketPrice,
        next.open,
        input.parameters.commissionRate,
        input.parameters.slippageRate,
      );
      return {
        reason: 'data_gap',
        exitAt: next.time,
        exitMarketPrice: next.open,
        ...returns,
      };
    }

    if (candle.open >= input.targetPrice) {
      const returns = marketAndNetReturn(
        input.entryMarketPrice,
        input.targetPrice,
        input.parameters.commissionRate,
        input.parameters.slippageRate,
      );
      return { reason: 'target', exitAt: candle.time, exitMarketPrice: input.targetPrice, ...returns };
    }
    if (candle.open <= input.stopPrice) {
      const returns = marketAndNetReturn(
        input.entryMarketPrice,
        candle.open,
        input.parameters.commissionRate,
        input.parameters.slippageRate,
      );
      return { reason: 'stop', exitAt: candle.time, exitMarketPrice: candle.open, ...returns };
    }

    const stopTouched = candle.low <= input.stopPrice;
    const targetTouched = candle.high >= input.targetPrice;
    if (stopTouched) {
      const returns = marketAndNetReturn(
        input.entryMarketPrice,
        input.stopPrice,
        input.parameters.commissionRate,
        input.parameters.slippageRate,
      );
      return { reason: 'stop', exitAt: candle.time, exitMarketPrice: input.stopPrice, ...returns };
    }
    if (targetTouched) {
      const returns = marketAndNetReturn(
        input.entryMarketPrice,
        input.targetPrice,
        input.parameters.commissionRate,
        input.parameters.slippageRate,
      );
      return { reason: 'target', exitAt: candle.time, exitMarketPrice: input.targetPrice, ...returns };
    }

    if (expectedMinute === endHoldingMinute) {
      const returns = marketAndNetReturn(
        input.entryMarketPrice,
        candle.close,
        input.parameters.commissionRate,
        input.parameters.slippageRate,
      );
      return { reason: 'time_exit', exitAt: candle.time, exitMarketPrice: candle.close, ...returns };
    }
  }

  return {
    reason: 'incomplete_data',
    exitAt: null,
    exitMarketPrice: null,
    marketReturnPct: null,
    netReturnPct: null,
  };
}

function forwardReturn(
  byMinute: ReadonlyMap<number, PreparedMinuteCandle>,
  entryMinuteMoscow: number,
  endMinuteMoscow: number,
  entryMarketPrice: number,
  horizonMinutes: number,
  parameters: OrbRvolParameters,
): OrbRvolForwardReturn {
  const terminalMinute = entryMinuteMoscow + horizonMinutes - 1;
  if (terminalMinute > endMinuteMoscow) {
    return {
      horizonMinutes,
      terminalAt: null,
      marketReturnPct: null,
      netReturnPct: null,
      status: 'outside_session',
    };
  }
  let previous: PreparedMinuteCandle | null = null;
  for (let minute = entryMinuteMoscow; minute <= terminalMinute; minute += 1) {
    const candle = byMinute.get(minute);
    if (!candle || (previous && candle.epochMs !== previous.epochMs + MINUTE_MS)) {
      return {
        horizonMinutes,
        terminalAt: null,
        marketReturnPct: null,
        netReturnPct: null,
        status: 'data_gap',
      };
    }
    previous = candle;
  }
  const terminal = byMinute.get(terminalMinute)!;
  const returns = marketAndNetReturn(
    entryMarketPrice,
    terminal.close,
    parameters.commissionRate,
    parameters.slippageRate,
  );
  return {
    horizonMinutes,
    terminalAt: terminal.time,
    ...returns,
    status: 'complete',
  };
}

function emptyDataQuality(): OrbRvolDataQuality {
  return {
    sessionCount: 0,
    calendarRejectedSessionCount: 0,
    completeOpeningRangeSessionCount: 0,
    noMainSessionDataCount: 0,
    incompleteOpeningRangeSessionCount: 0,
    insufficientRvolHistorySessionCount: 0,
    signalWindowGapSessionCount: 0,
    breakoutCount: 0,
    entryDataGapCount: 0,
    entryOpenRejectedCount: 0,
    strategyIncompleteDataCount: 0,
    forwardReturnGapCount: 0,
  };
}

function sortedReturns(values: readonly number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

function summarizeGroup(
  group: OrbRvolGroupName,
  events: readonly OrbRvolEvent[],
  horizons: readonly number[],
): OrbRvolGroupSummary {
  const average = (values: readonly number[]): number | null =>
    values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
  return {
    group,
    eventCount: events.length,
    horizons: horizons.map((horizonMinutes) => {
      const returns = events
        .map((event) => event.forwardReturns.find((item) => item.horizonMinutes === horizonMinutes))
        .filter((item): item is OrbRvolForwardReturn => item !== undefined);
      const netReturns = returns
        .map((item) => item.netReturnPct)
        .filter((value): value is number => value !== null);
      const marketReturns = returns
        .map((item) => item.marketReturnPct)
        .filter((value): value is number => value !== null);
      const ordered = sortedReturns(netReturns);
      const middle = Math.floor(ordered.length / 2);
      return {
        horizonMinutes,
        availableCount: netReturns.length,
        missingCount: events.length - netReturns.length,
        averageMarketReturnPct: average(marketReturns),
        averageNetReturnPct: average(netReturns),
        medianNetReturnPct:
          ordered.length === 0
            ? null
            : ordered.length % 2 === 0
              ? (ordered[middle - 1]! + ordered[middle]!) / 2
              : ordered[middle]!,
        positiveNetRate: netReturns.length === 0 ? null : netReturns.filter((value) => value > 0).length / netReturns.length,
      };
    }),
  };
}

export function collectOrbRvolResearch(input: OrbRvolInput): OrbRvolReport {
  validateParameters(input.parameters);
  const events: OrbRvolEvent[] = [];
  const rejections: OrbRvolRejection[] = [];
  const data: OrbRvolReport['data'] = [];
  const dataQuality = emptyDataQuality();
  const warnings: string[] = [];

  for (const { instrument, candles } of input.instruments) {
    validateInstrument(instrument);
    const prepared = prepareMinutes(candles, instrument.instrumentId);
    data.push({
      ticker: instrument.ticker,
      instrumentId: instrument.instrumentId,
      lotSize: instrument.lotSize,
      priceStep: instrument.priceStep,
      minuteCandleCount: candles.length,
      firstCandleAt: prepared[0]?.time ?? null,
      lastCandleAt: prepared.at(-1)?.time ?? null,
    });

    const sessions = groupBySession(prepared);
    const previousOpeningRangeVolumes: number[] = [];
    for (const [sessionDate, session] of sessions) {
      dataQuality.sessionCount += 1;
      const schedule = input.scheduleForSession({
        ticker: instrument.ticker,
        instrumentId: instrument.instrumentId,
        sessionDate,
      });
      if (!schedule) {
        dataQuality.calendarRejectedSessionCount += 1;
        rejections.push({
          ticker: instrument.ticker,
          instrumentId: instrument.instrumentId,
          sessionDate,
          reason: 'outside_trading_calendar',
          detail: 'The session date is outside the configured historical trading calendar',
        });
        continue;
      }
      validateSchedule(schedule);
      const byMinute = new Map(session.map((candle) => [candle.minuteOfDayMoscow, candle]));
      const hasAnyMainSessionCandle = session.some(
        (candle) =>
          candle.minuteOfDayMoscow >= schedule.startMinuteMoscow &&
          candle.minuteOfDayMoscow <= schedule.endMinuteMoscow,
      );
      if (!hasAnyMainSessionCandle) {
        dataQuality.noMainSessionDataCount += 1;
        rejections.push({
          ticker: instrument.ticker,
          instrumentId: instrument.instrumentId,
          sessionDate,
          reason: 'no_main_session_data',
          detail: 'The archive has no candle inside the configured main-session window',
        });
        continue;
      }
      const rangeComplete = isCompleteMinuteRange(
        byMinute,
        schedule.startMinuteMoscow,
        input.parameters.openingRangeMinutes,
      );
      if (!rangeComplete) {
        dataQuality.incompleteOpeningRangeSessionCount += 1;
        rejections.push({
          ticker: instrument.ticker,
          instrumentId: instrument.instrumentId,
          sessionDate,
          reason: 'incomplete_opening_range',
          detail: `Missing one or more minutes in ${input.parameters.openingRangeMinutes}-minute opening range`,
        });
        continue;
      }
      dataQuality.completeOpeningRangeSessionCount += 1;
      const rangeCandles = Array.from(
        { length: input.parameters.openingRangeMinutes },
        (_, offset) => byMinute.get(schedule.startMinuteMoscow + offset)!,
      );
      const openingRangeHigh = Math.max(...rangeCandles.map((candle) => candle.high));
      const openingRangeLow = Math.min(...rangeCandles.map((candle) => candle.low));
      const openingRangeVolume = rangeCandles.reduce((total, candle) => total + candle.volume, 0);
      const referenceVolumes = previousOpeningRangeVolumes.slice(-input.parameters.rvolLookbackSessions);
      const previousOpeningRangeMedianVolume = median(referenceVolumes);
      previousOpeningRangeVolumes.push(openingRangeVolume);

      if (previousOpeningRangeMedianVolume === null || previousOpeningRangeMedianVolume <= 0) {
        dataQuality.insufficientRvolHistorySessionCount += 1;
        continue;
      }

      for (
        let signalStartMinute = schedule.startMinuteMoscow + input.parameters.openingRangeMinutes;
        signalStartMinute < schedule.startMinuteMoscow + input.parameters.signalWindowEndOffsetMinutes;
        signalStartMinute += 5
      ) {
        const signalBar = buildCompleteFiveMinuteBar(byMinute, signalStartMinute);
        if (!signalBar) {
          dataQuality.signalWindowGapSessionCount += 1;
          break;
        }
        if (
          signalBar.open > openingRangeHigh ||
          signalBar.close <= openingRangeHigh ||
          signalBar.low < openingRangeLow
        ) {
          continue;
        }

        dataQuality.breakoutCount += 1;
        const entryMinuteMoscow = signalStartMinute + 5;
        const entryCandle = byMinute.get(entryMinuteMoscow);
        if (!entryCandle) {
          dataQuality.entryDataGapCount += 1;
          rejections.push({
            ticker: instrument.ticker,
            instrumentId: instrument.instrumentId,
            sessionDate,
            reason: 'entry_data_gap',
            detail: `The minute after the first completed breakout bar is missing`,
          });
          break;
        }
        if (entryCandle.open <= openingRangeHigh) {
          dataQuality.entryOpenRejectedCount += 1;
          rejections.push({
            ticker: instrument.ticker,
            instrumentId: instrument.instrumentId,
            sessionDate,
            reason: 'entry_open_not_above_range',
            detail: 'The next-minute open did not remain above the opening-range high',
          });
          break;
        }

        const stopPrice = roundDownToStep(
          openingRangeLow - instrument.priceStep * input.parameters.stopBufferTicks,
          instrument.priceStep,
        );
        const riskPerUnit = entryCandle.open - stopPrice;
        if (riskPerUnit <= 0) throw new Error(`ORB RVOL risk is non-positive for ${instrument.ticker} ${sessionDate}`);
        const targetPrice = roundUpToStep(
          entryCandle.open + riskPerUnit * input.parameters.targetRiskMultiple,
          instrument.priceStep,
        );
        const riskPct = riskPerUnit / entryCandle.open;
        const estimatedRoundTripCostPct = 2 * (input.parameters.commissionRate + input.parameters.slippageRate);
        const passesRelativeVolume = openingRangeVolume / previousOpeningRangeMedianVolume >= input.parameters.minRelativeVolume;
        const passesCostFilter = riskPct >= estimatedRoundTripCostPct * input.parameters.minStopDistanceToRoundTripCost;
        const strategyExit = simulateStrategyExit({
          orderedSession: session,
          byMinute,
          entryMinuteMoscow,
          endMinuteMoscow: schedule.endMinuteMoscow,
          entryMarketPrice: entryCandle.open,
          stopPrice,
          targetPrice,
          parameters: input.parameters,
        });
        if (strategyExit.reason === 'incomplete_data') dataQuality.strategyIncompleteDataCount += 1;
        const forwardReturns = input.parameters.forwardHorizonsMinutes.map((horizonMinutes) =>
          forwardReturn(
            byMinute,
            entryMinuteMoscow,
            schedule.endMinuteMoscow,
            entryCandle.open,
            horizonMinutes,
            input.parameters,
          ),
        );
        if (forwardReturns.some((item) => item.status === 'data_gap')) dataQuality.forwardReturnGapCount += 1;
        events.push({
          ticker: instrument.ticker,
          instrumentId: instrument.instrumentId,
          sessionDate,
          scheduleSource: schedule.source,
          sessionStartMinuteMoscow: schedule.startMinuteMoscow,
          sessionEndMinuteMoscow: schedule.endMinuteMoscow,
          openingRangeStartAt: rangeCandles[0]!.time,
          openingRangeEndAt: rangeCandles.at(-1)!.time,
          openingRangeHigh,
          openingRangeLow,
          openingRangeVolume,
          previousOpeningRangeMedianVolume,
          relativeVolume: openingRangeVolume / previousOpeningRangeMedianVolume,
          signalAt: signalBar.endAt,
          signalBarOpen: signalBar.open,
          signalBarHigh: signalBar.high,
          signalBarLow: signalBar.low,
          signalBarClose: signalBar.close,
          entryAt: entryCandle.time,
          entryMarketPrice: entryCandle.open,
          stopPrice,
          targetPrice,
          riskPerUnit,
          riskPct,
          estimatedRoundTripCostPct,
          passesRelativeVolume,
          passesCostFilter,
          eligible: passesRelativeVolume && passesCostFilter,
          forwardReturns,
          strategyExit,
        });
        break;
      }
      // A complete session with no qualifying breakout is valid data, not a rejection.
    }
  }

  const allEntryEvents = events;
  const costEligibleLowRvol = events.filter((event) => event.passesCostFilter && !event.passesRelativeVolume);
  const costEligibleHighRvol = events.filter((event) => event.passesCostFilter && event.passesRelativeVolume);
  return {
    strategyId: ORB_RVOL_STRATEGY_ID,
    parameters: input.parameters,
    data,
    dataQuality,
    events,
    rejections,
    summaries: [
      summarizeGroup('all_entry_events', allEntryEvents, input.parameters.forwardHorizonsMinutes),
      summarizeGroup('cost_eligible_low_rvol', costEligibleLowRvol, input.parameters.forwardHorizonsMinutes),
      summarizeGroup('cost_eligible_high_rvol', costEligibleHighRvol, input.parameters.forwardHorizonsMinutes),
    ],
    warnings,
  };
}

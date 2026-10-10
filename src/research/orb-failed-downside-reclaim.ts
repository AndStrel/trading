import type { HistoricalMinuteCandle } from '../history/market-data-store.js';
import type { OrbRvolSessionSchedule } from '../backtest/orb-rvol.js';

export const ORB_FAILED_DOWNSIDE_RECLAIM_ID = 'orb-failed-downside-reclaim-sber-2026-v1' as const;

export const FAILED_DOWNSIDE_RECLAIM_COSTS = {
  investor: { commissionRate: 0.003, slippageRate: 0.0005 },
  traderLike: { commissionRate: 0.0005, slippageRate: 0.0005 },
} as const;

export type FailedDownsideReclaimExit = {
  reason: 'target' | 'stop' | 'time_exit' | 'incomplete_data';
  exitAt: string | null;
  marketReturnPct: number | null;
  netReturnPct: number | null;
};

export type FailedDownsideReclaimEvent = {
  sessionDate: string;
  sessionScheduleSource: string;
  openingRangeLow: number;
  breakdownAt: string;
  breakdownClose: number;
  reclaimAt: string;
  reclaimClose: number;
  entryAt: string;
  entryMarketPrice: number;
  stopPrice: number;
  targetPrice: number;
  riskPct: number;
  estimatedRoundTripCostPct: { investor: number; traderLike: number };
  eligible: { investor: boolean; traderLike: boolean };
  exit: { investor: FailedDownsideReclaimExit; traderLike: FailedDownsideReclaimExit };
};

export type FailedDownsideReclaimReport = {
  strategyId: typeof ORB_FAILED_DOWNSIDE_RECLAIM_ID;
  parameters: {
    openingRangeMinutes: 30;
    signalWindowEndOffsetMinutes: 120;
    maxReclaimWaitMinutes: 5;
    maxHoldingMinutes: 120;
    targetRiskMultiple: 2;
    stopBufferTicks: 1;
    maxRoundTripCostToRisk: number;
  };
  dataQuality: {
    sessionDates: number;
    calendarRejectedDates: number;
    incompleteWindows: number;
    completeWindows: number;
    breakdowns: number;
    failedBreakdowns: number;
    reclaimSignals: number;
    rejectedEntries: number;
    unresolvedExits: number;
  };
  events: FailedDownsideReclaimEvent[];
};

type SessionScheduleResolver = (input: { ticker: string; instrumentId: string; sessionDate: string }) =>
  | OrbRvolSessionSchedule
  | null;

type Input = {
  ticker: string;
  instrumentId: string;
  candles: HistoricalMinuteCandle[];
  priceStep: number;
  scheduleForSession: SessionScheduleResolver;
};

type TimedCandle = HistoricalMinuteCandle & { sessionDate: string; minuteOfDay: number };

const OPENING_RANGE_MINUTES = 30;
const SIGNAL_WINDOW_END_MINUTES = 120;
const MAX_RECLAIM_WAIT_MINUTES = 5;
const MAX_HOLD_MINUTES = 120;
const TARGET_R = 2;
const STOP_BUFFER_TICKS = 1;
const COST_TO_RISK_LIMIT = 1 / 3;

function toMoscowCandle(candle: HistoricalMinuteCandle): TimedCandle {
  const timestamp = new Date(candle.time);
  if (Number.isNaN(timestamp.getTime())) throw new Error('Invalid candle timestamp');
  const moscowEpoch = timestamp.getTime() + 180 * 60_000;
  const moscowDate = new Date(moscowEpoch);
  return {
    ...candle,
    sessionDate: moscowDate.toISOString().slice(0, 10),
    minuteOfDay: moscowDate.getUTCHours() * 60 + moscowDate.getUTCMinutes(),
  };
}

function roundDownToStep(value: number, step: number): number {
  return Math.floor(value / step + 1e-9) * step;
}

function roundUpToStep(value: number, step: number): number {
  return Math.ceil(value / step - 1e-9) * step;
}

function evaluateExit(input: {
  bars: TimedCandle[];
  entryIndex: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  costs: { commissionRate: number; slippageRate: number };
}): FailedDownsideReclaimExit {
  const exitIndex = input.entryIndex + MAX_HOLD_MINUTES;
  const timeExit = input.bars[exitIndex];
  if (!timeExit) return { reason: 'incomplete_data', exitAt: null, marketReturnPct: null, netReturnPct: null };

  let exitPrice: number | null = null;
  let exitBar: TimedCandle | null = null;
  let reason: FailedDownsideReclaimExit['reason'] = 'time_exit';
  for (let index = input.entryIndex; index < exitIndex; index += 1) {
    const bar = input.bars[index];
    if (!bar) return { reason: 'incomplete_data', exitAt: null, marketReturnPct: null, netReturnPct: null };
    if (bar.low <= input.stopPrice) {
      exitPrice = bar.open <= input.stopPrice ? bar.open : input.stopPrice;
      exitBar = bar;
      reason = 'stop';
      break;
    }
    if (bar.high >= input.targetPrice) {
      exitPrice = input.targetPrice;
      exitBar = bar;
      reason = 'target';
      break;
    }
  }
  if (exitPrice === null) {
    exitPrice = timeExit.open;
    exitBar = timeExit;
  }

  const entryFill = input.entryPrice * (1 + input.costs.slippageRate);
  const exitFill = exitPrice * (1 - input.costs.slippageRate);
  const netFactor = (exitFill * (1 - input.costs.commissionRate)) /
    (entryFill * (1 + input.costs.commissionRate));
  return {
    reason,
    exitAt: exitBar!.time,
    marketReturnPct: ((exitPrice / input.entryPrice) - 1) * 100,
    netReturnPct: (netFactor - 1) * 100,
  };
}

export function collectFailedDownsideReclaims(input: Input): FailedDownsideReclaimReport {
  if (!Number.isFinite(input.priceStep) || input.priceStep <= 0) throw new Error('priceStep must be positive');
  const grouped = new Map<string, TimedCandle[]>();
  for (const candle of input.candles) {
    if (candle.instrumentId !== input.instrumentId) throw new Error('Candle instrumentId mismatch');
    const timed = toMoscowCandle(candle);
    const day = grouped.get(timed.sessionDate) ?? [];
    day.push(timed);
    grouped.set(timed.sessionDate, day);
  }

  const report: FailedDownsideReclaimReport = {
    strategyId: ORB_FAILED_DOWNSIDE_RECLAIM_ID,
    parameters: {
      openingRangeMinutes: OPENING_RANGE_MINUTES,
      signalWindowEndOffsetMinutes: SIGNAL_WINDOW_END_MINUTES,
      maxReclaimWaitMinutes: MAX_RECLAIM_WAIT_MINUTES,
      maxHoldingMinutes: MAX_HOLD_MINUTES,
      targetRiskMultiple: TARGET_R,
      stopBufferTicks: STOP_BUFFER_TICKS,
      maxRoundTripCostToRisk: COST_TO_RISK_LIMIT,
    },
    dataQuality: {
      sessionDates: grouped.size,
      calendarRejectedDates: 0,
      incompleteWindows: 0,
      completeWindows: 0,
      breakdowns: 0,
      failedBreakdowns: 0,
      reclaimSignals: 0,
      rejectedEntries: 0,
      unresolvedExits: 0,
    },
    events: [],
  };

  for (const [sessionDate, unsorted] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const schedule = input.scheduleForSession({ ticker: input.ticker, instrumentId: input.instrumentId, sessionDate });
    if (!schedule) {
      report.dataQuality.calendarRejectedDates += 1;
      continue;
    }
    const bars = unsorted
      .filter((bar) => bar.minuteOfDay >= schedule.startMinuteMoscow && bar.minuteOfDay < schedule.endMinuteMoscow)
      .sort((a, b) => a.minuteOfDay - b.minuteOfDay);
    const requiredWindowLength = OPENING_RANGE_MINUTES + SIGNAL_WINDOW_END_MINUTES + MAX_HOLD_MINUTES + 1;
    const requiredEndMinute = schedule.startMinuteMoscow + requiredWindowLength;
    const requiredBars = bars.filter((bar) => bar.minuteOfDay < requiredEndMinute);
    const completeWindow = requiredBars.length === requiredWindowLength && requiredBars.every(
      (bar, index) => bar.minuteOfDay === schedule.startMinuteMoscow + index,
    );
    if (!completeWindow) {
      report.dataQuality.incompleteWindows += 1;
      continue;
    }
    report.dataQuality.completeWindows += 1;

    const rangeBars = requiredBars.slice(0, OPENING_RANGE_MINUTES);
    const rangeLow = Math.min(...rangeBars.map((bar) => bar.low));
    let breakdownIndex = -1;
    const signalEndIndex = OPENING_RANGE_MINUTES + SIGNAL_WINDOW_END_MINUTES;
    for (let index = OPENING_RANGE_MINUTES; index < signalEndIndex; index += 1) {
      if (requiredBars[index]!.close < rangeLow) {
        breakdownIndex = index;
        break;
      }
    }
    if (breakdownIndex < 0) continue;
    report.dataQuality.breakdowns += 1;

    let reclaimIndex = -1;
    for (let offset = 1; offset <= MAX_RECLAIM_WAIT_MINUTES; offset += 1) {
      const index = breakdownIndex + offset;
      if (index >= signalEndIndex) break;
      if (requiredBars[index]!.close >= rangeLow) {
        reclaimIndex = index;
        break;
      }
    }
    if (reclaimIndex < 0) continue;
    report.dataQuality.failedBreakdowns += 1;
    const entryIndex = reclaimIndex + 1;
    const entryBar = requiredBars[entryIndex];
    if (!entryBar || entryBar.open < rangeLow) {
      report.dataQuality.rejectedEntries += 1;
      continue;
    }
    report.dataQuality.reclaimSignals += 1;

    const troughLow = Math.min(...requiredBars.slice(breakdownIndex, reclaimIndex + 1).map((bar) => bar.low));
    const stopPrice = roundDownToStep(troughLow - STOP_BUFFER_TICKS * input.priceStep, input.priceStep);
    const riskPerShare = entryBar.open - stopPrice;
    if (riskPerShare <= 0) {
      report.dataQuality.rejectedEntries += 1;
      continue;
    }
    const targetPrice = roundUpToStep(entryBar.open + TARGET_R * riskPerShare, input.priceStep);
    const riskPct = (riskPerShare / entryBar.open) * 100;
    const costFor = (costs: { commissionRate: number; slippageRate: number }): number =>
      2 * (costs.commissionRate + costs.slippageRate) * 100;
    const investorCostPct = costFor(FAILED_DOWNSIDE_RECLAIM_COSTS.investor);
    const traderLikeCostPct = costFor(FAILED_DOWNSIDE_RECLAIM_COSTS.traderLike);
    const investorExit = evaluateExit({
      bars: requiredBars,
      entryIndex,
      entryPrice: entryBar.open,
      stopPrice,
      targetPrice,
      costs: FAILED_DOWNSIDE_RECLAIM_COSTS.investor,
    });
    const traderLikeExit = evaluateExit({
      bars: requiredBars,
      entryIndex,
      entryPrice: entryBar.open,
      stopPrice,
      targetPrice,
      costs: FAILED_DOWNSIDE_RECLAIM_COSTS.traderLike,
    });
    if (investorExit.reason === 'incomplete_data' || traderLikeExit.reason === 'incomplete_data') {
      report.dataQuality.unresolvedExits += 1;
    }
    report.events.push({
      sessionDate,
      sessionScheduleSource: schedule.source,
      openingRangeLow: rangeLow,
      breakdownAt: requiredBars[breakdownIndex]!.time,
      breakdownClose: requiredBars[breakdownIndex]!.close,
      reclaimAt: requiredBars[reclaimIndex]!.time,
      reclaimClose: requiredBars[reclaimIndex]!.close,
      entryAt: entryBar.time,
      entryMarketPrice: entryBar.open,
      stopPrice,
      targetPrice,
      riskPct,
      estimatedRoundTripCostPct: { investor: investorCostPct, traderLike: traderLikeCostPct },
      eligible: {
        investor: investorCostPct / riskPct <= COST_TO_RISK_LIMIT,
        traderLike: traderLikeCostPct / riskPct <= COST_TO_RISK_LIMIT,
      },
      exit: { investor: investorExit, traderLike: traderLikeExit },
    });
  }

  return report;
}

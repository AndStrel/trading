import { analyzeCandles } from '../domain/candle-analysis.js';
import type { IntradayLongProposal } from '../domain/intraday-proposal.js';
import { priceToNano } from '../domain/price-tick.js';
import { calculateTradePlan, type TradePlan } from '../domain/trade-plan.js';
import { assessLivePilotRisk, pilotPositionBudget } from '../execution/live-pilot-risk.js';
import { sandboxSessionEntryAllowed } from '../execution/sandbox-session-policy.js';
import type { HistoricalMinuteCandle } from '../history/market-data-store.js';
import { isTradingStrategyId, type TradingStrategyId } from '../strategies/catalog.js';
import { evaluateTradingSignal } from '../strategies/signal-engine.js';

const MINUTE = 60_000;
const BAR = 5 * MINUTE;
const MOSCOW = 3 * 60 * MINUTE;
const SCALE = 1_000_000_000n;
const KOPEK = 10_000_000n;
const INVALID = 'Invalid catalog parity replay input';
export const CATALOG_PARITY_PERIOD = { from: '2025-08-01', to: '2026-09-26' } as const;
const PERIOD_START = Date.parse(`${CATALOG_PARITY_PERIOD.from}T00:00:00Z`);
const PERIOD_END = Date.parse('2026-09-27T00:00:00Z');

export type CatalogReplayPolicy = {
  capitalRub: 500 | 1000;
  maxTradeRiskRub: 20;
  maxDailyRiskRub: 60;
  maxDailyLossRub: 60;
  commissionRate: 0.003 | 0.0005 | 0.0003;
  slippageRate: 0.0005 | 0.001;
  sessionStartMinutes: 550;
  lookbackMinutes: 360;
  minAverageCandleTurnoverRub: 1000000;
  maxOrdersPerDay: 3;
};
export const DEFAULT_CATALOG_REPLAY_POLICY: Readonly<CatalogReplayPolicy> = Object.freeze({
  capitalRub: 500, maxTradeRiskRub: 20, maxDailyRiskRub: 60, maxDailyLossRub: 60,
  commissionRate: 0.003, slippageRate: 0.0005, sessionStartMinutes: 550,
  lookbackMinutes: 360, minAverageCandleTurnoverRub: 1000000, maxOrdersPerDay: 3,
});
export type CatalogReplayInstrument = {
  instrumentId: string; ticker: string; lotSize: number; priceStep: number;
};
export type CatalogParityReplayInput = {
  strategyId: TradingStrategyId;
  instrument: CatalogReplayInstrument;
  minuteCandles: readonly HistoricalMinuteCandle[];
  policy: CatalogReplayPolicy;
};
export type CatalogReplayDecision = {
  observedAt: string;
  status: 'signal' | 'wait' | 'blocked';
  reasons: string[];
  proposal?: IntradayLongProposal;
  tradePlan?: TradePlan;
};
export type CatalogModeledTrade = {
  id: string; strategyId: TradingStrategyId; ticker: string; instrumentId: string;
  sessionDate: string; entryAt: string; exitAt: string | null; unresolvedAt: string | null;
  status: 'closed' | 'unresolved'; lots: number; units: number; lotSize: number;
  entryNano: string; stopNano: string; targetNano: string;
  entryGrossNano: string; entryCommissionNano: string; entrySlippageNano: string;
  exitNano: string | null; exitGrossNano: string | null;
  exitCommissionNano: string | null; exitSlippageNano: string | null;
  netNano: string | null; reservedRiskNano: string;
  exitReason: 'target-touch' | 'stop-touch' | 'session-close' | 'stop-limit-gap'
    | 'missing-minute' | 'missing-session-close' | 'end-of-history';
  ambiguousStopFirst: boolean;
  executableEvidence: false;
};
export type CatalogReplaySummary = {
  tradeCount: number; entryDateCount: number; netPositiveTradeCount: number;
  netWinRate: number | null; totalNetNano: string; totalNetRub: number;
  meanNetRub: number | null; profitFactor: number | null;
};
export type CatalogReplayMetrics = {
  attemptedTradeCount: number; closedTradeCount: number; unresolvedTradeCount: number;
  entryDateCount: number; netPositiveTradeCount: number; netWinRate: number | null;
  totalGrossNano: string; totalCommissionNano: string; totalSlippageNano: string;
  totalNetNano: string; totalNetRub: number; meanNetRub: number | null; profitFactor: number | null;
  periods: Record<'2025' | '2026', CatalogReplaySummary>;
  months: Record<string, CatalogReplaySummary>;
  withoutFiveBest: CatalogReplaySummary;
};
export type CatalogReplayCoverage = {
  inputMinuteCount: number; validMinuteCount: number;
  completeFiveMinuteCount: number; incompleteFiveMinuteCount: number;
  sessionDateCount: number; from: string | null; to: string | null;
  missingEntryMinuteCount: number; unresolvedTradeCount: number;
};
export type CatalogParityReplayResult = {
  strategyId: TradingStrategyId; instrument: CatalogReplayInstrument; policy: CatalogReplayPolicy;
  researchStatus: 'development-only'; productionCompatible: boolean;
  decisions: CatalogReplayDecision[]; modeledTrades: CatalogModeledTrade[];
  coverage: CatalogReplayCoverage; metrics: CatalogReplayMetrics;
  admission: { allowed: false; executableEvidence: false };
};
type Minute = HistoricalMinuteCandle & { timestamp: number };
type FiveMinute = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };
type Position = { trade: CatalogModeledTrade; nextMinute: number; forceClose: number };

function rubles(nano: bigint): number {
  const sign = nano < 0n ? '-' : '';
  const abs = nano < 0n ? -nano : nano;
  return Number(`${sign}${abs / SCALE}.${String(abs % SCALE).padStart(9, '0')}`);
}
function fee(gross: bigint, rate: number): bigint {
  const numerator = gross * priceToNano(rate);
  const denominator = SCALE * KOPEK;
  return (numerator + denominator - 1n) / denominator * KOPEK;
}
function quotation(price: number): { units: string; nano: number } {
  const value = priceToNano(price);
  return { units: String(value / SCALE), nano: Number(value % SCALE) };
}
function dateAt(timestamp: number): string { return new Date(timestamp + MOSCOW).toISOString().slice(0, 10); }
function midnight(timestamp: number): number { return Date.parse(`${dateAt(timestamp)}T00:00:00Z`) - MOSCOW; }
function iso(timestamp: number): string { return new Date(timestamp).toISOString(); }
function validate(input: CatalogParityReplayInput): void {
  const { policy: p, instrument: i } = input;
  if (!isTradingStrategyId(input.strategyId) || !p || !i || !Array.isArray(input.minuteCandles) || input.minuteCandles.length > 1_000_000
    || ![500, 1000].includes(p.capitalRub) || p.maxTradeRiskRub !== 20 || p.maxDailyRiskRub !== 60
    || p.maxDailyLossRub !== 60 || ![0.003, 0.0005, 0.0003].includes(p.commissionRate)
    || ![0.0005, 0.001].includes(p.slippageRate) || p.sessionStartMinutes !== 550
    || p.lookbackMinutes !== 360 || p.minAverageCandleTurnoverRub !== 1000000 || p.maxOrdersPerDay !== 3
    || typeof i.instrumentId !== 'string' || !i.instrumentId || !/^[A-Z][A-Z0-9]{0,11}$/.test(i.ticker)
    || !Number.isSafeInteger(i.lotSize) || i.lotSize <= 0 || i.lotSize > 1_000_000) throw new Error(INVALID);
  priceToNano(i.priceStep);
}
function normalizedMinutes(input: CatalogParityReplayInput): Minute[] {
  const tick = priceToNano(input.instrument.priceStep);
  const seen = new Set<number>();
  return Array.from(input.minuteCandles, candle => {
    const timestamp = Date.parse(candle.time);
    const prices = [candle.open, candle.high, candle.low, candle.close].map(priceToNano);
    if (candle.instrumentId !== input.instrument.instrumentId || !Number.isFinite(timestamp)
      || timestamp < PERIOD_START || timestamp >= PERIOD_END
      || timestamp % MINUTE !== 0 || seen.has(timestamp) || prices.some(price => price % tick !== 0n)
      || candle.low > candle.high || candle.open < candle.low || candle.open > candle.high
      || candle.close < candle.low || candle.close > candle.high
      || !Number.isSafeInteger(candle.volume) || candle.volume < 0) throw new Error(INVALID);
    seen.add(timestamp);
    return { ...candle, timestamp };
  }).sort((a, b) => a.timestamp - b.timestamp);
}
function aggregate(minutes: readonly Minute[]): { bars: FiveMinute[]; incomplete: number } {
  const buckets = new Map<number, Minute[]>();
  for (const minute of minutes) {
    const start = Math.floor(minute.timestamp / BAR) * BAR;
    const bucket = buckets.get(start) ?? [];
    bucket.push(minute);
    buckets.set(start, bucket);
  }
  const bars: FiveMinute[] = [];
  let incomplete = 0;
  for (const [timestamp, bucket] of buckets) {
    if (bucket.length !== 5 || bucket.some((minute, index) => minute.timestamp !== timestamp + index * MINUTE)) {
      incomplete += 1;
      continue;
    }
    const volume = bucket.reduce((sum, minute) => sum + minute.volume, 0);
    if (!Number.isSafeInteger(volume)) throw new Error(INVALID);
    bars.push({ timestamp, open: bucket[0]!.open, close: bucket[4]!.close,
      high: Math.max(...bucket.map(minute => minute.high)), low: Math.min(...bucket.map(minute => minute.low)), volume });
  }
  return { bars, incomplete };
}
function payload(bars: readonly FiveMinute[]): unknown {
  return { candles: bars.map(bar => ({ time: iso(bar.timestamp), isComplete: true,
    open: quotation(bar.open), high: quotation(bar.high), low: quotation(bar.low), close: quotation(bar.close), volume: bar.volume })) };
}
function summary(trades: readonly CatalogModeledTrade[]): CatalogReplaySummary {
  let total = 0n;
  let wins = 0n;
  let losses = 0n;
  let positive = 0;
  for (const trade of trades) {
    const net = BigInt(trade.netNano!);
    total += net;
    if (net > 0n) { positive += 1; wins += net; }
    if (net < 0n) losses -= net;
  }
  return { tradeCount: trades.length, entryDateCount: new Set(trades.map(trade => trade.sessionDate)).size,
    netPositiveTradeCount: positive, netWinRate: trades.length ? positive / trades.length : null,
    totalNetNano: String(total), totalNetRub: rubles(total), meanNetRub: trades.length ? rubles(total) / trades.length : null,
    profitFactor: losses > 0n ? Number(wins) / Number(losses) : null };
}
function metrics(trades: readonly CatalogModeledTrade[]): CatalogReplayMetrics {
  const closed = trades.filter(trade => trade.status === 'closed');
  const total = summary(closed);
  let gross = 0n;
  let commission = 0n;
  let slippage = 0n;
  for (const trade of closed) {
    gross += BigInt(trade.exitGrossNano!) - BigInt(trade.entryGrossNano);
    commission += BigInt(trade.entryCommissionNano) + BigInt(trade.exitCommissionNano!);
    slippage += BigInt(trade.entrySlippageNano) + BigInt(trade.exitSlippageNano!);
  }
  const months: Record<string, CatalogReplaySummary> = {};
  for (const month of [...new Set(trades.map(trade => trade.sessionDate.slice(0, 7)))].sort()) {
    months[month] = summary(closed.filter(trade => trade.sessionDate.startsWith(month)));
  }
  const ranked = [...closed].sort((a, b) => BigInt(a.netNano!) > BigInt(b.netNano!) ? -1 : BigInt(a.netNano!) < BigInt(b.netNano!) ? 1 : a.id.localeCompare(b.id));
  return { attemptedTradeCount: trades.length, closedTradeCount: closed.length,
    unresolvedTradeCount: trades.length - closed.length, entryDateCount: total.entryDateCount,
    netPositiveTradeCount: total.netPositiveTradeCount, netWinRate: total.netWinRate,
    totalGrossNano: String(gross), totalCommissionNano: String(commission), totalSlippageNano: String(slippage),
    totalNetNano: total.totalNetNano, totalNetRub: total.totalNetRub, meanNetRub: total.meanNetRub, profitFactor: total.profitFactor,
    periods: { '2025': summary(closed.filter(trade => trade.sessionDate.startsWith('2025'))),
      '2026': summary(closed.filter(trade => trade.sessionDate.startsWith('2026'))) },
    months, withoutFiveBest: summary(ranked.slice(5)) };
}

/** Pure candle model. Synthetic OPEN quotes and OHLC touches NEVER authorize execution. */
export function replayCatalogStrategy(input: CatalogParityReplayInput): CatalogParityReplayResult {
  let minutes: Minute[];
  try { validate(input); minutes = normalizedMinutes(input); }
  catch { throw new Error(INVALID); }
  const { policy, instrument, strategyId } = input;
  const { bars, incomplete } = aggregate(minutes);
  const byTime = new Map(minutes.map(minute => [minute.timestamp, minute]));
  const dates = [...new Set(minutes.filter(minute => minute.timestamp >= PERIOD_START && minute.timestamp < PERIOD_END)
    .map(minute => dateAt(minute.timestamp)))];
  const decisionsAt = new Set<number>();
  const events = new Set(minutes.filter(minute => minute.timestamp >= PERIOD_START && minute.timestamp < PERIOD_END).map(minute => minute.timestamp));
  for (const date of dates) {
    const start = Date.parse(`${date}T00:00:00Z`) - MOSCOW;
    if ([0, 6].includes(new Date(start + MOSCOW).getUTCDay())) continue;
    for (let minute = policy.sessionStartMinutes; minute < 16 * 60 + 40; minute += 5) {
      const time = start + minute * MINUTE;
      if (time >= PERIOD_START && time < PERIOD_END) { decisionsAt.add(time); events.add(time); }
    }
    const forceClose = start + (18 * 60 + 30) * MINUTE;
    if (forceClose >= PERIOD_START && forceClose < PERIOD_END) events.add(forceClose);
  }
  const decisions: CatalogReplayDecision[] = [];
  const modeledTrades: CatalogModeledTrade[] = [];
  const capital = priceToNano(policy.capitalRub);
  let cash = capital;
  let reserved = 0n;
  let realizedLoss = 0n;
  let dayOrders = 0;
  let ledgerDate = '';
  let position: Position | null = null;
  let unresolved = false;
  let missingEntry = 0;
  let availableBarCount = 0;
  const finishUnresolved = (at: number, reason: CatalogModeledTrade['exitReason']): void => {
    const trade = position!.trade;
    trade.status = 'unresolved'; trade.exitReason = reason; trade.unresolvedAt = iso(at);
    position = null; unresolved = true;
  };
  const close = (at: number, price: bigint, reason: CatalogModeledTrade['exitReason'], ambiguous = false): void => {
    const trade = position!.trade;
    const gross = price * BigInt(trade.units);
    const commission = fee(gross, policy.commissionRate);
    const slippage = fee(gross, policy.slippageRate);
    const net = gross - commission - slippage - BigInt(trade.entryGrossNano)
      - BigInt(trade.entryCommissionNano) - BigInt(trade.entrySlippageNano);
    Object.assign(trade, { status: 'closed', exitAt: iso(at), exitNano: String(price), exitGrossNano: String(gross),
      exitCommissionNano: String(commission), exitSlippageNano: String(slippage), netNano: String(net),
      exitReason: reason, ambiguousStopFirst: ambiguous });
    cash += gross - commission - slippage;
    if (net < 0n) realizedLoss -= net;
    position = null;
  };
  for (const at of [...events].sort((a, b) => a - b)) {
    const date = dateAt(at);
    if (date !== ledgerDate && !unresolved && !position) { ledgerDate = date; reserved = 0n; realizedLoss = 0n; dayOrders = 0; }
    const minute = byTime.get(at);
    // A missing minute after entry is never replaced by a later OPEN or previous CLOSE.
    if (position && (at > position.nextMinute || (at === position.nextMinute && !minute))) {
      const missingAt = position.nextMinute;
      finishUnresolved(missingAt, missingAt === position.forceClose ? 'missing-session-close' : 'missing-minute');
    }
    while (availableBarCount < bars.length && bars[availableBarCount]!.timestamp + BAR <= at) availableBarCount += 1;
    if (decisionsAt.has(at)) {
      const decision: CatalogReplayDecision = { observedAt: iso(at), status: 'blocked', reasons: [] };
      decisions.push(decision);
      if (unresolved) decision.reasons.push('unresolved-position-risk-remains-reserved');
      else if (position) decision.reasons.push('one-open-position-limit');
      else if (!sandboxSessionEntryAllowed(new Date(at))) { decision.status = 'wait'; decision.reasons.push('outside-pilot-session-entry-window'); }
      else if (dayOrders >= policy.maxOrdersPerDay) decision.reasons.push('max-orders-per-day');
      else if (!minute) { missingEntry += 1; decision.reasons.push('missing-entry-minute'); }
      else {
        const reference = midnight(at) + policy.sessionStartMinutes * MINUTE;
        const from = Math.min(at - policy.lookbackMinutes * MINUTE,
          strategyId === 'trend-momentum-v1' ? at : reference - 250 * MINUTE);
        let first = availableBarCount;
        while (first > 0 && bars[first - 1]!.timestamp >= from) first -= 1;
        const candlesPayload = payload(bars.slice(first, availableBarCount));
        const analysis = analyzeCandles(candlesPayload);
        const turnover = (analysis.averageVolume20 ?? 0) * (analysis.latestClose ?? 0) * instrument.lotSize;
        if (turnover < policy.minAverageCandleTurnoverRub) decision.reasons.push('average-candle-turnover-below-minimum');
        else {
          const evaluated = evaluateTradingSignal({ strategyId, candlesPayload, candleAnalysis: analysis,
            orderBookPayload: { asks: [{ price: quotation(minute.open), quantity: 1 }] },
            priceStep: instrument.priceStep, commissionRate: policy.commissionRate,
            slippageRate: policy.slippageRate, sessionStartMinutes: policy.sessionStartMinutes, now: new Date(at) });
          decision.reasons = [...evaluated.reasons];
          if (!evaluated.proposal) decision.status = !evaluated.dataValid || evaluated.reasons.some(reason => /расход|стакан|отношение/.test(reason)) ? 'blocked' : 'wait';
          else {
            const proposal = evaluated.proposal;
            const plan = calculateTradePlan({ side: 'long', ...proposal, lotSize: instrument.lotSize,
              maxRiskRub: policy.maxTradeRiskRub, maxPositionRub: pilotPositionBudget(policy.capitalRub, policy.commissionRate, policy.slippageRate),
              commissionRate: policy.commissionRate, slippageRate: policy.slippageRate });
            decision.proposal = proposal; decision.tradePlan = plan;
            if (plan.lots > 0 && plan.lots <= 1_000_000) {
              const units = BigInt(plan.lots) * BigInt(instrument.lotSize);
              const entry = priceToNano(proposal.entryPrice); const stop = priceToNano(proposal.stopPrice); const target = priceToNano(proposal.targetPrice);
              const entryGross = entry * units; const stopGross = stop * units; const targetGross = target * units;
              const commission = fee(entryGross, policy.commissionRate); const slippage = fee(entryGross, policy.slippageRate);
              const cashRequired = entryGross + commission + slippage;
              const risk = entryGross - stopGross + commission + slippage + fee(stopGross, policy.commissionRate) + fee(stopGross, policy.slippageRate);
              const reward = targetGross - entryGross - commission - slippage - fee(targetGross, policy.commissionRate) - fee(targetGross, policy.slippageRate);
              // Trader sensitivities reuse the exact cash/risk formula but do not alter the production floor.
              const blockers: string[] = [];
              if (cashRequired > capital || cashRequired > cash) blockers.push('Cash including entry costs is insufficient');
              if (risk > priceToNano(policy.maxTradeRiskRub)) blockers.push('Trade risk including round-trip expenses exceeds the limit');
              if (reserved + risk > priceToNano(policy.maxDailyRiskRub)) blockers.push('Daily reserved risk budget would be exceeded');
              if (realizedLoss >= priceToNano(policy.maxDailyLossRub) || realizedLoss + risk > priceToNano(policy.maxDailyLossRub)) blockers.push('Daily loss allowance would be exceeded');
              if (reward <= 0n || reward < 2n * risk) blockers.push('Net reward-to-risk is below 2.0');
              if (policy.commissionRate === 0.003) {
                const pilot = assessLivePilotRisk({ prepare: true, capitalRub: policy.capitalRub,
                  maxTradeRiskRub: policy.maxTradeRiskRub, maxDailyRiskRub: policy.maxDailyRiskRub, maxDailyLossRub: policy.maxDailyLossRub },
                { side: 'long', ...proposal, lots: plan.lots, lotSize: instrument.lotSize,
                  commissionRate: policy.commissionRate, slippageRate: policy.slippageRate,
                  availableCashRub: rubles(cash < capital ? cash : capital), reservedDailyRiskRub: rubles(reserved),
                  realizedDailyLossRub: rubles(realizedLoss), markedOpenLossRub: 0 });
                blockers.push(...pilot.blockers);
              }
              plan.allowed = plan.allowed && blockers.length === 0;
              plan.reasons = [...new Set([...plan.reasons, ...blockers])];
              plan.totalRiskRub = Math.max(plan.totalRiskRub, rubles(risk));
              plan.netRewardRub = Math.min(plan.netRewardRub, rubles(reward));
              plan.rewardToRisk = plan.totalRiskRub > 0 ? plan.netRewardRub / plan.totalRiskRub : 0;
              if (plan.allowed) {
                const trade: CatalogModeledTrade = { id: `${strategyId}:${iso(at)}`, strategyId,
                  ticker: instrument.ticker, instrumentId: instrument.instrumentId, sessionDate: date,
                  entryAt: iso(at), exitAt: null, unresolvedAt: null, status: 'unresolved', lots: plan.lots,
                  units: plan.units, lotSize: instrument.lotSize, entryNano: String(entry), stopNano: String(stop), targetNano: String(target),
                  entryGrossNano: String(entryGross), entryCommissionNano: String(commission), entrySlippageNano: String(slippage),
                  exitNano: null, exitGrossNano: null, exitCommissionNano: null, exitSlippageNano: null, netNano: null,
                  reservedRiskNano: String(risk), exitReason: 'end-of-history', ambiguousStopFirst: false, executableEvidence: false };
                modeledTrades.push(trade); cash -= cashRequired; reserved += risk; dayOrders += 1;
                position = { trade, nextMinute: at, forceClose: midnight(at) + (18 * 60 + 30) * MINUTE };
                decision.status = 'signal';
              }
            } else if (plan.lots > 1_000_000) { plan.allowed = false; plan.reasons.push('bounded-whole-lot-quantity-required'); }
            if (decision.status !== 'signal') decision.reasons.push(...plan.reasons);
          }
        }
      }
    }
    // Only after this instant's decision may the current minute's future HIGH/LOW affect a modeled exit.
    if (position && minute) {
      const stop = BigInt(position.trade.stopNano); const target = BigInt(position.trade.targetNano);
      const open = priceToNano(minute.open);
      if (open < stop) finishUnresolved(at, 'stop-limit-gap');
      else if (at === position.forceClose) close(at, open > target ? target : open, open >= target ? 'target-touch' : 'session-close');
      else if (priceToNano(minute.low) <= stop) close(at, stop, 'stop-touch', priceToNano(minute.high) >= target);
      else if (priceToNano(minute.high) >= target) close(at, target, 'target-touch');
      else position.nextMinute = at + MINUTE;
    }
  }
  if (position) finishUnresolved(position.nextMinute, 'end-of-history');
  const measured = minutes.filter(minute => minute.timestamp >= PERIOD_START && minute.timestamp < PERIOD_END);
  return { strategyId, instrument: { ...instrument }, policy: { ...policy }, researchStatus: 'development-only',
    productionCompatible: policy.commissionRate === 0.003, decisions, modeledTrades,
    coverage: { inputMinuteCount: minutes.length, validMinuteCount: measured.length,
      completeFiveMinuteCount: bars.filter(bar => bar.timestamp >= PERIOD_START && bar.timestamp < PERIOD_END).length,
      incompleteFiveMinuteCount: incomplete, sessionDateCount: dates.length,
      from: measured[0]?.time ?? null, to: measured.at(-1)?.time ?? null,
      missingEntryMinuteCount: missingEntry, unresolvedTradeCount: modeledTrades.filter(trade => trade.status === 'unresolved').length },
    metrics: metrics(modeledTrades), admission: { allowed: false, executableEvidence: false } };
}

/** Cost sensitivity on the SAME original attempts; never reselect signals or claim cash feasibility. */
export function repriceCatalogTrades(trades: readonly CatalogModeledTrade[], costs: {
  commissionRate: CatalogReplayPolicy['commissionRate']; slippageRate: CatalogReplayPolicy['slippageRate'];
}): { modeledTrades: CatalogModeledTrade[]; metrics: CatalogReplayMetrics; productionCompatible: boolean;
  cohort: 'fixed-original-attempts'; cashFeasibilityProven: false; riskLimitsProven: false;
  admission: { allowed: false; executableEvidence: false } } {
  try {
    if (!Array.isArray(trades) || trades.length > 1_000_000 || !costs
      || ![0.003, 0.0005, 0.0003].includes(costs.commissionRate) || ![0.0005, 0.001].includes(costs.slippageRate)) throw new Error(INVALID);
    for (const trade of trades) validateModeledTrade(trade);
  } catch { throw new Error(INVALID); }
  const modeledTrades = trades.map(trade => {
    const entryGross = BigInt(trade.entryGrossNano);
    const entryCommission = fee(entryGross, costs.commissionRate); const entrySlippage = fee(entryGross, costs.slippageRate);
    const copy = { ...trade, entryCommissionNano: String(entryCommission), entrySlippageNano: String(entrySlippage) };
    if (trade.status === 'closed') {
      const exitGross = BigInt(trade.exitGrossNano!);
      const exitCommission = fee(exitGross, costs.commissionRate); const exitSlippage = fee(exitGross, costs.slippageRate);
      copy.exitCommissionNano = String(exitCommission); copy.exitSlippageNano = String(exitSlippage);
      copy.netNano = String(exitGross - entryGross - entryCommission - entrySlippage - exitCommission - exitSlippage);
    }
    return copy;
  });
  return { modeledTrades, metrics: metrics(modeledTrades), productionCompatible: costs.commissionRate === 0.003,
    cohort: 'fixed-original-attempts', cashFeasibilityProven: false, riskLimitsProven: false,
    admission: { allowed: false, executableEvidence: false } };
}

function validateModeledTrade(trade: CatalogModeledTrade): void {
  const nano = (value: unknown, signed = false): bigint => {
    if (typeof value !== 'string' || !(signed ? /^-?(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)$/).test(value)
      || value.length > 30 || value === '-0') throw new Error(INVALID);
    return BigInt(value);
  };
  if (!trade || !isTradingStrategyId(trade.strategyId) || trade.executableEvidence !== false
    || !['closed', 'unresolved'].includes(trade.status)
    || [trade.lots, trade.lotSize, trade.units].some(value => !Number.isSafeInteger(value) || value <= 0)
    || trade.lots > 1_000_000 || trade.lotSize > 1_000_000 || trade.units !== trade.lots * trade.lotSize
    || !Number.isFinite(Date.parse(trade.entryAt)) || dateAt(Date.parse(trade.entryAt)) !== trade.sessionDate) throw new Error(INVALID);
  const entry = nano(trade.entryNano); const stop = nano(trade.stopNano); const target = nano(trade.targetNano);
  const entryGross = nano(trade.entryGrossNano);
  const entryCosts = nano(trade.entryCommissionNano) + nano(trade.entrySlippageNano);
  if (!(target > entry && entry > stop && stop > 0n) || target > 1_000_000n * SCALE
    || entryGross !== entry * BigInt(trade.units) || nano(trade.reservedRiskNano) <= 0n) throw new Error(INVALID);
  if (trade.status === 'closed') {
    const exit = nano(trade.exitNano); const gross = nano(trade.exitGrossNano);
    const costs = nano(trade.exitCommissionNano) + nano(trade.exitSlippageNano);
    if (exit <= 0n || exit > 1_000_000n * SCALE || gross !== exit * BigInt(trade.units)
      || nano(trade.netNano, true) !== gross - costs - entryGross - entryCosts
      || trade.exitAt === null || !Number.isFinite(Date.parse(trade.exitAt)) || Date.parse(trade.exitAt) < Date.parse(trade.entryAt)
      || trade.unresolvedAt !== null || !['target-touch', 'stop-touch', 'session-close'].includes(trade.exitReason)) throw new Error(INVALID);
  } else if ([trade.exitAt, trade.exitNano, trade.exitGrossNano, trade.exitCommissionNano, trade.exitSlippageNano, trade.netNano]
    .some(value => value !== null) || !['stop-limit-gap', 'missing-minute', 'missing-session-close', 'end-of-history'].includes(trade.exitReason)) throw new Error(INVALID);
}

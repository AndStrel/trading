import { describe, expect, it } from 'vitest';
import { analyzeCandles } from '../domain/candle-analysis.js';
import { calculateTradePlan } from '../domain/trade-plan.js';
import { assessLivePilotRisk, pilotPositionBudget } from '../execution/live-pilot-risk.js';
import type { HistoricalMinuteCandle } from '../history/market-data-store.js';
import { TRADING_STRATEGY_IDS, type TradingStrategyId } from '../strategies/catalog.js';
import { evaluateTradingSignal } from '../strategies/signal-engine.js';
import {
  DEFAULT_CATALOG_REPLAY_POLICY, replayCatalogStrategy, repriceCatalogTrades,
  type CatalogModeledTrade, type CatalogReplayPolicy,
} from './catalog-parity-replay.js';

const instrument = { instrumentId: 'synthetic-instrument', ticker: 'TEST', lotSize: 1, priceStep: 0.01 };
const date = '2025-08-04';
const MINUTE = 60_000;
const at = (minute: number, day = date) => new Date(Date.parse(`${day}T00:00:00Z`) + (minute - 180) * MINUTE).toISOString();
const decimal = (number: number) => Number(number.toFixed(2));
type Bar = { minute: number; open: number; high: number; low: number; close: number; volume: number };
function append(candles: HistoricalMinuteCandle[], bar: Bar, day = date): void {
  for (let offset = 0; offset < 5; offset += 1) candles.push({ instrumentId: instrument.instrumentId,
    time: at(bar.minute + offset, day), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume / 5 });
}
function one(minute: number, price: number, overrides: Partial<HistoricalMinuteCandle> = {}, day = date): HistoricalMinuteCandle {
  return { instrumentId: instrument.instrumentId, time: at(minute, day), open: price, high: price, low: price, close: price, volume: 200_000, ...overrides };
}
function trend(day = date): HistoricalMinuteCandle[] {
  const candles: HistoricalMinuteCandle[] = [];
  for (let index = 0; index < 50; index += 1) {
    const base = decimal(280 + index * 0.2);
    append(candles, { minute: 360 + index * 5, open: base, high: decimal(base + 5), low: decimal(base - 5), close: base, volume: 1_000_000 }, day);
  }
  candles.push(one(610, 290, {}, day), one(611, 290, { high: 330 }, day));
  return candles;
}
function fixedStrategy(strategyId: TradingStrategyId): { candles: HistoricalMinuteCandle[]; entryMinute: number } {
  if (strategyId === 'trend-momentum-v1') return { candles: trend(), entryMinute: 610 };
  const candles: HistoricalMinuteCandle[] = [];
  const start = strategyId === 'opening-range-breakout-v1' ? 450 : 550;
  const count = strategyId === 'opening-range-breakout-v1' ? 31 : 21;
  for (let index = 0; index < count; index += 1) append(candles, {
    minute: start + index * 5, open: 300, high: index === count - 1 ? 311 : 305,
    low: 295, close: index === count - 1 ? 306 : 300, volume: 1_000_000,
  });
  const entryMinute = start + count * 5;
  candles.push(one(entryMinute, 306), one(entryMinute + 1, 306, { high: 350 }));
  return { candles, entryMinute };
}
function replay(candles = trend(), policy: CatalogReplayPolicy = { ...DEFAULT_CATALOG_REPLAY_POLICY }) {
  return replayCatalogStrategy({ strategyId: 'trend-momentum-v1', instrument, minuteCandles: candles, policy });
}
function quote(price: number) {
  return { units: String(Math.floor(price)), nano: Math.round((price - Math.floor(price)) * 1e9) };
}
function pastPayload(candles: HistoricalMinuteCandle[], minute: number) {
  const closed = candles.filter(candle => candle.time < at(minute));
  const bars = [];
  for (let index = 0; index < closed.length; index += 5) {
    const group = closed.slice(index, index + 5);
    bars.push({ time: group[0]!.time, isComplete: true, open: quote(group[0]!.open),
      high: quote(Math.max(...group.map(candle => candle.high))), low: quote(Math.min(...group.map(candle => candle.low))),
      close: quote(group[4]!.close), volume: group.reduce((sum, candle) => sum + candle.volume, 0) });
  }
  return { candles: bars };
}

describe('catalog parity replay: shared signal and fixed safety gates', () => {
  for (const strategyId of TRADING_STRATEGY_IDS) it(`uses the exact shared ${strategyId} signal, sizing and Investor gate`, () => {
    const { candles, entryMinute } = fixedStrategy(strategyId);
    const policy = { ...DEFAULT_CATALOG_REPLAY_POLICY };
    const candlesPayload = pastPayload(candles, entryMinute);
    const engine = evaluateTradingSignal({ strategyId, candlesPayload, candleAnalysis: analyzeCandles(candlesPayload),
      orderBookPayload: { asks: [{ price: quote(candles.find(candle => candle.time === at(entryMinute))!.open), quantity: 1 }] },
      priceStep: instrument.priceStep, commissionRate: policy.commissionRate, slippageRate: policy.slippageRate,
      sessionStartMinutes: policy.sessionStartMinutes, now: new Date(at(entryMinute)) });
    expect(engine.proposal).not.toBeNull();
    const plan = calculateTradePlan({ side: 'long', ...engine.proposal!, lotSize: 1, maxRiskRub: 20,
      maxPositionRub: pilotPositionBudget(500, 0.003, 0.0005), commissionRate: 0.003, slippageRate: 0.0005 });
    const pilot = assessLivePilotRisk({ prepare: true, capitalRub: 500, maxTradeRiskRub: 20, maxDailyRiskRub: 60, maxDailyLossRub: 60 },
      { side: 'long', ...engine.proposal!, lots: plan.lots, lotSize: 1, commissionRate: 0.003, slippageRate: 0.0005,
        availableCashRub: 500, reservedDailyRiskRub: 0, realizedDailyLossRub: 0, markedOpenLossRub: 0 });
    expect(pilot.allowed).toBe(true);
    const report = replayCatalogStrategy({ strategyId, instrument, minuteCandles: candles, policy });
    const decision = report.decisions.find(item => item.observedAt === at(entryMinute))!;
    expect(decision.status).toBe('signal');
    expect(decision.proposal).toEqual(engine.proposal);
    expect(decision.tradePlan?.lots).toBe(plan.lots);
    expect(decision.tradePlan?.totalRiskRub).toBe(Math.max(plan.totalRiskRub, pilot.totalRiskRub));
    expect(decision.tradePlan?.netRewardRub).toBe(Math.min(plan.netRewardRub, pilot.netRewardRub));
    expect(report.modeledTrades).toHaveLength(1);
    expect(report.productionCompatible).toBe(true);
    expect(report.researchStatus).toBe('development-only');
    expect(report.admission).toEqual({ allowed: false, executableEvidence: false });
  });

  it('matches an independent whole-kopeck monetary oracle, not a gross winner label', () => {
    const report = replay();
    const trade = report.modeledTrades[0]!;
    // 1 share: entry290, stop275, target327.50; fees .87/.99, slip .15/.17.
    expect(trade).toMatchObject({ lots: 1, units: 1, entryAt: at(610), exitAt: at(611), status: 'closed',
      entryNano: '290000000000', stopNano: '275000000000', targetNano: '327500000000',
      entryGrossNano: '290000000000', entryCommissionNano: '870000000', entrySlippageNano: '150000000',
      exitGrossNano: '327500000000', exitCommissionNano: '990000000', exitSlippageNano: '170000000',
      netNano: '35320000000', reservedRiskNano: '16990000000', exitReason: 'target-touch', executableEvidence: false });
    expect(report.metrics).toMatchObject({ closedTradeCount: 1, entryDateCount: 1, netPositiveTradeCount: 1,
      netWinRate: 1, totalGrossNano: '37500000000', totalCommissionNano: '1860000000', totalSlippageNano: '320000000',
      totalNetNano: '35320000000', meanNetRub: 35.32, profitFactor: null });
    expect(report.metrics.withoutFiveBest.tradeCount).toBe(0);
    expect(report.admission.allowed).toBe(false);
  });

  it('never changes a signal using current-minute or future HIGH/LOW/CLOSE/VOLUME', () => {
    const original = trend();
    const future = original.map(candle => candle.time >= at(610)
      ? { ...candle, high: 500, low: 100, close: 400, volume: 0 } : candle);
    const first = replay(original).decisions.find(item => item.observedAt === at(610));
    const changed = replay(future).decisions.find(item => item.observedAt === at(610));
    expect(changed).toEqual(first);
    expect(replay(future).modeledTrades[0]!.exitReason).toBe('stop-touch');
  });

  it('does not use later quotes or a signal-bar close when the exact entry minute is missing', () => {
    const report = replay(trend().filter(candle => candle.time !== at(610)));
    expect(report.decisions.find(item => item.observedAt === at(610))).toMatchObject({ status: 'blocked', reasons: ['missing-entry-minute'] });
    expect(report.modeledTrades).toHaveLength(0);
    expect(report.coverage.missingEntryMinuteCount).toBeGreaterThan(0);
  });

  it('does not aggregate four minutes into a five-minute signal candle', () => {
    const report = replay(trend().filter(candle => candle.time !== at(609)));
    expect(report.coverage.completeFiveMinuteCount).toBe(49);
    expect(report.coverage.incompleteFiveMinuteCount).toBe(2);
    expect(report.modeledTrades).toHaveLength(0);
    expect(report.decisions.find(item => item.observedAt === at(610))?.reasons.join(' ')).toContain('50');
  });

  it('requires the exact opening-window beginning for ORB instead of shifting six available bars', () => {
    const { candles } = fixedStrategy('opening-range-breakout-v1');
    const report = replayCatalogStrategy({ strategyId: 'opening-range-breakout-v1', instrument,
      minuteCandles: candles.filter(candle => candle.time !== at(550)), policy: { ...DEFAULT_CATALOG_REPLAY_POLICY } });
    expect(report.modeledTrades).toHaveLength(0);
    expect(report.decisions.find(item => item.observedAt === at(605))?.reasons.join(' ')).toContain('Начало');
  });

  it('retains the production liquidity floor, whole-lot sizing, and 10:05 session boundary', () => {
    const lowVolume = trend().map(candle => ({ ...candle, volume: 1 }));
    expect(replay(lowVolume).modeledTrades).toHaveLength(0);
    expect(replay(lowVolume).decisions.find(item => item.observedAt === at(610))?.reasons).toContain('average-candle-turnover-below-minimum');
    const expensiveLot = replayCatalogStrategy({ strategyId: 'trend-momentum-v1', instrument: { ...instrument, lotSize: 10 },
      minuteCandles: trend(), policy: { ...DEFAULT_CATALOG_REPLAY_POLICY } });
    expect(expensiveLot.modeledTrades).toHaveLength(0);
    expect(expensiveLot.decisions.find(item => item.observedAt === at(610))?.tradePlan?.lots).toBe(0);
    expect(replay().decisions.find(item => item.observedAt === at(600))?.reasons).toContain('outside-pilot-session-entry-window');
  });

  it('keeps input immutable and produces stable sorted decisions for reversed input', () => {
    const candles = trend(); const snapshot = structuredClone(candles);
    const report = replay(candles);
    expect(candles).toEqual(snapshot);
    expect(replay([...candles].reverse())).toEqual(report);
  });

  it('labels cheaper commission scenarios research-only without changing the production floor', () => {
    for (const commissionRate of [0.0005, 0.0003] as const) {
      const report = replay(trend(), { ...DEFAULT_CATALOG_REPLAY_POLICY, commissionRate });
      expect(report.modeledTrades[0]?.status).toBe('closed');
      expect(report.productionCompatible).toBe(false);
      expect(report.admission.allowed).toBe(false);
    }
  });
});

describe('catalog parity replay: conservative modeled execution', () => {
  it('chooses the stop first when a single minute touches stop and target', () => {
    const candles = trend(); candles[251] = one(611, 290, { high: 340, low: 270 });
    const trade = replay(candles).modeledTrades[0]!;
    expect(trade).toMatchObject({ exitNano: '275000000000', exitReason: 'stop-touch', ambiguousStopFirst: true,
      exitCommissionNano: '830000000', exitSlippageNano: '140000000', netNano: '-16990000000' });
  });
  it('does not treat an OPEN below STOP_LIMIT as a guaranteed fill at the stop', () => {
    const candles = trend(); candles[251] = one(611, 274, { high: 340, low: 270, close: 290 });
    const report = replay(candles);
    expect(report.modeledTrades[0]).toMatchObject({ status: 'unresolved', exitReason: 'stop-limit-gap',
      unresolvedAt: at(611), exitNano: null, netNano: null, reservedRiskNano: '16990000000' });
    expect(report.metrics.closedTradeCount).toBe(0);
    expect(report.metrics.unresolvedTradeCount).toBe(1);
    expect(report.decisions.find(item => item.observedAt === at(615))?.reasons).toContain('unresolved-position-risk-remains-reserved');
  });
  it('never substitutes a later observation after a missing minute, even on a later day', () => {
    const candles = trend().filter(candle => candle.time !== at(611));
    candles.push(one(612, 400), ...trend('2025-08-05'));
    const report = replay(candles);
    expect(report.modeledTrades).toHaveLength(1);
    expect(report.modeledTrades[0]).toMatchObject({ status: 'unresolved', exitReason: 'missing-minute', unresolvedAt: at(611), netNano: null });
    expect(report.decisions.find(item => item.observedAt === at(610, '2025-08-05'))?.reasons).toContain('unresolved-position-risk-remains-reserved');
  });
  it('does not fund an entry at a minute OPEN with profit from its later intraminute target touch', () => {
    const candles = trend().slice(0, 251);
    for (let minute = 611; minute <= 615; minute += 1) candles.push(one(minute, 290, minute === 615 ? { high: 330 } : {}));
    const report = replay(candles);
    expect(report.modeledTrades).toHaveLength(1);
    expect(report.modeledTrades[0]!.exitAt).toBe(at(615));
    expect(report.decisions.find(item => item.observedAt === at(615))?.reasons).toContain('one-open-position-limit');
  });
  it('closes only at the exact 18:30 OPEN, not later HIGH/LOW or an old 90-minute timeout', () => {
    const candles = trend().slice(0, 251);
    for (let minute = 611; minute <= 1110; minute += 1) candles.push(one(minute, 290));
    candles[candles.length - 1] = one(1110, 295, { high: 340, low: 270, close: 310 });
    const trade = replay(candles).modeledTrades[0]!;
    expect(trade).toMatchObject({ entryAt: at(610), exitAt: at(1110), exitReason: 'session-close',
      exitNano: '295000000000', netNano: '2940000000' });
  });
  it('caps an 18:30 OPEN above the immutable target, without favorable gap profit', () => {
    const candles = trend().slice(0, 251);
    for (let minute = 611; minute < 1110; minute += 1) candles.push(one(minute, 290));
    candles.push(one(1110, 350));
    expect(replay(candles).modeledTrades[0]).toMatchObject({ status: 'closed', exitAt: at(1110),
      exitReason: 'target-touch', targetNano: '327500000000', exitNano: '327500000000', netNano: '35320000000' });
  });
  it('does not replace a missing 18:30 OPEN by 18:29 CLOSE or the next date', () => {
    const candles = trend().slice(0, 251);
    for (let minute = 611; minute < 1110; minute += 1) candles.push(one(minute, 290));
    const trade = replay(candles).modeledTrades[0]!;
    expect(trade).toMatchObject({ status: 'unresolved', exitReason: 'missing-session-close', unresolvedAt: at(1110), netNano: null });
  });
  it('allows at most three entries per day, without increasing lots using profitable exits', () => {
    const candles = trend().slice(0, 250);
    for (let minute = 610; minute <= 1000; minute += 1) {
      const base = decimal(280 + Math.floor((minute - 360) / 5) * 0.2);
      candles.push(one(minute, base, { high: [611, 720, 840].includes(minute) ? 400 : decimal(base + 5), low: decimal(base - 5) }));
    }
    const report = replay(candles);
    expect(report.modeledTrades).toHaveLength(3);
    expect(report.modeledTrades.every(trade => trade.lots === 1 && trade.status === 'closed')).toBe(true);
    expect(report.decisions.some(decision => decision.reasons.includes('max-orders-per-day'))).toBe(true);
    expect(report.modeledTrades.reduce((sum, trade) => sum + BigInt(trade.reservedRiskNano), 0n)).toBeLessThanOrEqual(60_000_000_000n);
  });
  it('resets the day ledger only after flat, keeps both fixed yearly summaries, and never declares OOS', () => {
    const report = replay([...trend(), ...trend('2026-08-03')]);
    expect(report.modeledTrades).toHaveLength(2);
    expect(report.metrics.periods['2025'].tradeCount).toBe(1);
    expect(report.metrics.periods['2026'].tradeCount).toBe(1);
    expect(report.metrics.months['2025-08']?.totalNetNano).toBe('35320000000');
    expect(report.researchStatus).toBe('development-only');
    expect(report.admission.allowed).toBe(false);
  });
});

describe('catalog parity replay: frozen cohort sensitivity and input bounds', () => {
  it('reprices costs on exactly the original attempts, with no cash/risk viability claim', () => {
    const report = replay(); const snapshot = structuredClone(report.modeledTrades);
    const stress = repriceCatalogTrades(report.modeledTrades, { commissionRate: 0.003, slippageRate: 0.001 });
    expect(stress.modeledTrades[0]).toMatchObject({ entryAt: at(610), exitAt: at(611), lots: 1,
      entryNano: '290000000000', targetNano: '327500000000', stopNano: '275000000000',
      entrySlippageNano: '290000000', exitSlippageNano: '330000000', netNano: '35020000000',
      reservedRiskNano: '16990000000' });
    expect(stress).toMatchObject({ cohort: 'fixed-original-attempts', cashFeasibilityProven: false, riskLimitsProven: false,
      admission: { allowed: false, executableEvidence: false } });
    expect(report.modeledTrades).toEqual(snapshot);
    expect(repriceCatalogTrades(report.modeledTrades, { commissionRate: 0.0005, slippageRate: 0.0005 }).metrics.totalNetNano).toBe('36860000000');
    expect(repriceCatalogTrades(report.modeledTrades, { commissionRate: 0.0003, slippageRate: 0.0005 }).metrics.totalNetNano).toBe('36990000000');
  });
  it('does not transform unresolved attempts into completed or winning trades under cheaper costs', () => {
    const candles = trend().slice(0, 251);
    const repriced = repriceCatalogTrades(replay(candles).modeledTrades, { commissionRate: 0.0003, slippageRate: 0.0005 });
    expect(repriced.modeledTrades[0]?.netNano).toBeNull();
    expect(repriced.metrics.closedTradeCount).toBe(0);
    expect(repriced.metrics.unresolvedTradeCount).toBe(1);
  });
  it('reports independently known win rate, profit factor, mean, and net after removing five best', () => {
    const template = replay().modeledTrades[0]!;
    const trades: CatalogModeledTrade[] = [110, 110, 110, 110, 110, 90].map((exit, index) => ({ ...template,
      id: `oracle-${index}`, sessionDate: `2025-08-${String(index + 4).padStart(2, '0')}`, entryAt: at(610, `2025-08-${String(index + 4).padStart(2, '0')}`),
      exitAt: at(611, `2025-08-${String(index + 4).padStart(2, '0')}`), entryNano: '100000000000', stopNano: '90000000000', targetNano: '120000000000',
      entryGrossNano: '100000000000', entryCommissionNano: '300000000', entrySlippageNano: '50000000',
      exitNano: String(exit * 1e9), exitGrossNano: String(exit * 1e9),
      exitCommissionNano: String((exit === 110 ? 33 : 27) * 10_000_000), exitSlippageNano: String((exit === 110 ? 6 : 5) * 10_000_000),
      netNano: String((exit === 110 ? 926 : -1067) * 10_000_000), exitReason: 'session-close' }));
    const metrics = repriceCatalogTrades(trades, { commissionRate: 0.003, slippageRate: 0.0005 }).metrics;
    expect(metrics.netPositiveTradeCount).toBe(5);
    expect(metrics.netWinRate).toBe(5 / 6);
    expect(metrics.totalNetNano).toBe('35630000000');
    expect(metrics.meanNetRub).toBeCloseTo(35.63 / 6, 10);
    expect(metrics.profitFactor).toBeCloseTo(46.3 / 10.67, 10);
    expect(metrics.withoutFiveBest).toMatchObject({ tradeCount: 1, netPositiveTradeCount: 0, totalNetNano: '-10670000000' });
  });
  it.each([
    ['duplicate timestamp', (candles: HistoricalMinuteCandle[]) => [...candles, candles[0]!]],
    ['non-minute time', (candles: HistoricalMinuteCandle[]) => [{ ...candles[0]!, time: '2025-08-04T03:00:01Z' }, ...candles.slice(1)]],
    ['malformed OHLC', (candles: HistoricalMinuteCandle[]) => [{ ...candles[0]!, high: 1 }, ...candles.slice(1)]],
    ['fractional volume', (candles: HistoricalMinuteCandle[]) => [{ ...candles[0]!, volume: 0.5 }, ...candles.slice(1)]],
    ['off-tick price', (candles: HistoricalMinuteCandle[]) => [{ ...candles[0]!, open: 280.001 }, ...candles.slice(1)]],
    ['wrong instrument', (candles: HistoricalMinuteCandle[]) => [{ ...candles[0]!, instrumentId: 'private-marker' }, ...candles.slice(1)]],
  ])('refuses %s with a fixed error', (_label, change) => {
    expect(() => replay(change(trend()))).toThrowError('Invalid catalog parity replay input');
  });
  it('refuses altered gates and excessively large arrays before reading their contents', () => {
    expect(() => replay(trend(), { ...DEFAULT_CATALOG_REPLAY_POLICY, maxTradeRiskRub: 21 } as unknown as CatalogReplayPolicy)).toThrowError('Invalid catalog parity replay input');
    expect(() => replay(new Array<HistoricalMinuteCandle>(1_000_001))).toThrowError('Invalid catalog parity replay input');
    expect(() => replay(new Array<HistoricalMinuteCandle>(1))).toThrowError('Invalid catalog parity replay input');
  });
  it('refuses pre-lot-change warmup or data outside the fixed UTC research period', () => {
    expect(() => replay([...trend(), one(610, 290, {}, '2025-07-31')])).toThrowError('Invalid catalog parity replay input');
    expect(() => replay([...trend(), one(610, 290, {}, '2026-09-27')])).toThrowError('Invalid catalog parity replay input');
  });
  it.each(['entryGrossNano', 'exitGrossNano', 'netNano', 'units', 'status'])('refuses malformed fixed-cohort %s', field => {
    const trade = { ...replay().modeledTrades[0]!, [field]: field === 'units' ? 2 : 'private-secret-marker' };
    expect(() => repriceCatalogTrades([trade] as CatalogModeledTrade[], { commissionRate: 0.003, slippageRate: 0.001 })).toThrowError('Invalid catalog parity replay input');
  });
});

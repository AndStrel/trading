import { priceToNano } from '../domain/price-tick.js';
import { assessLivePilotRisk } from '../execution/live-pilot-risk.js';
import { sandboxSessionEntryAllowed } from '../execution/sandbox-session-policy.js';
import { strategyEntryWindow } from '../strategies/entry-window.js';
import { repriceCatalogTrades, type CatalogModeledTrade, type CatalogReplayPolicy } from './catalog-parity-replay.js';

const RUB = 1_000_000_000n;
const KOPEK = 10_000_000n;
const MINUTE = 60_000;
const MOSCOW = 180 * MINUTE;
const FROM = Date.parse('2025-08-01T00:00:00.000Z');
const UNTIL = Date.parse('2026-09-27T00:00:00.000Z');

export type CatalogCohortPolicy = {
  capitalRub: 500 | 1000;
  commissionRate: CatalogReplayPolicy['commissionRate'];
  slippageRate: CatalogReplayPolicy['slippageRate'];
  maxTradeRiskRub: 20; maxDailyRiskRub: 60; maxDailyLossRub: 60; maxOrdersPerDay: 3;
  monthlyFeeRub?: 0 | 390;
};
export type CatalogCohortViabilityInput = {
  originalTrades: readonly CatalogModeledTrade[];
  repricedTrades: readonly CatalogModeledTrade[];
  policy: CatalogCohortPolicy;
};
export type CatalogCohortBlockerCode = 'invalid-input' | 'cohort-mismatch' | 'empty-cohort' | 'unresolved-attempt'
  | 'overlapping-position' | 'cash-insufficient' | 'exit-expenses-insufficient' | 'monthly-fee-insufficient' | 'trade-risk-limit'
  | 'daily-risk-limit' | 'daily-loss-limit' | 'max-orders-per-day' | 'net-reward-to-risk' | 'production-risk-gate';
export type CatalogCohortBlocker = { code: CatalogCohortBlockerCode; tradeIndex: number | null; observedAt: string | null };
export type CatalogCohortLedgerEntry = {
  kind: 'entry' | 'exit' | 'monthly-fee'; tradeIndex: number; observedAt: string; accepted: boolean;
  cashBeforeNano: string; cashChangeNano: string; cashAfterNano: string;
  cashRequiredNano: string; tradeRiskNano: string; netTargetNano: string;
  reservedDailyRiskNano: string; realizedDailyLossNano: string; ordersForDay: number;
};
export type CatalogCohortViabilityResult = {
  pathProven: boolean; allowed: boolean; cashFeasibilityProven: boolean; riskLimitsProven: boolean;
  productionCompatible: boolean; researchStatus: 'development-only'; executableEvidence: false;
  cohort: 'fixed-original-attempts'; dailyLossScope: 'negative-realized-trades-only';
  monthlyFeeModel: 'calendar-first-entry-before-entry-not-actual-billing';
  timing: 'entries-before-same-instant-exit-observations';
  blockers: CatalogCohortBlocker[]; accountLedger: CatalogCohortLedgerEntry[];
  endingCashNano: string | null; openEntryGrossNano: string; monthlyFeesNano: string;
  modeledEntryCount: number; modeledExitCount: number;
  admission: { allowed: false; executableEvidence: false };
};
type PreparedTrade = { trade: CatalogModeledTrade; index: number; entryAt: number; exitKnownAt: number | null };
const IMMUTABLE = ['id', 'strategyId', 'ticker', 'instrumentId', 'sessionDate', 'entryAt', 'exitAt', 'unresolvedAt',
  'status', 'lots', 'units', 'lotSize', 'entryNano', 'stopNano', 'targetNano', 'entryGrossNano', 'exitNano',
  'exitGrossNano', 'reservedRiskNano', 'exitReason', 'ambiguousStopFirst', 'executableEvidence'] as const;
const REPRICED = ['entryCommissionNano', 'entrySlippageNano', 'exitCommissionNano', 'exitSlippageNano', 'netNano'] as const;

function iso(at: number): string { return new Date(at).toISOString(); }
function day(at: number): string { return new Date(at + MOSCOW).toISOString().slice(0, 10); }
function clock(at: number): number {
  const date = new Date(at + MOSCOW);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}
function canonicalTime(value: unknown): number {
  if (typeof value !== 'string') throw new Error('invalid-input');
  const at = Date.parse(value);
  if (!Number.isFinite(at) || at < FROM || at >= UNTIL || at % MINUTE !== 0 || iso(at) !== value) throw new Error('invalid-input');
  return at;
}
function rubles(nano: bigint): number {
  if (nano < 0n) throw new Error('invalid-input');
  return Number(`${nano / RUB}.${String(nano % RUB).padStart(9, '0')}`);
}
function expense(gross: bigint, rate: number): bigint {
  const denominator = RUB * KOPEK;
  return (gross * priceToNano(rate) + denominator - 1n) / denominator * KOPEK;
}
function prepare(input: CatalogCohortViabilityInput): PreparedTrade[] {
  const { policy: p, originalTrades: original, repricedTrades: repriced } = input;
  if (!p || ![500, 1000].includes(p.capitalRub) || p.maxTradeRiskRub !== 20 || p.maxDailyRiskRub !== 60
    || p.maxDailyLossRub !== 60 || p.maxOrdersPerDay !== 3 || ![0.003, 0.0005, 0.0003].includes(p.commissionRate)
    || ![0.0005, 0.001].includes(p.slippageRate) || ![0, 390].includes(p.monthlyFeeRub ?? 0)
    || !Array.isArray(original) || !Array.isArray(repriced) || original.length > 1_000_000 || repriced.length > 1_000_000) throw new Error('invalid-input');
  if (original.length !== repriced.length) throw new Error('cohort-mismatch');
  // This existing pure validator checks whole units, gross and net conservation, and complete exits.
  const expected = repriceCatalogTrades(original, p).modeledTrades;
  repriceCatalogTrades(repriced, p);
  const seen = new Set<string>();
  let cohortIdentity: string | null = null;
  return Array.from(original, (base, index) => {
    const trade = repriced[index]!;
    if (IMMUTABLE.some(key => base[key] !== trade[key]) || REPRICED.some(key => trade[key] !== expected[index]![key])) throw new Error('cohort-mismatch');
    if (typeof trade.id !== 'string' || !trade.id || seen.has(trade.id) || typeof trade.instrumentId !== 'string'
      || !trade.instrumentId || !/^[A-Z][A-Z0-9]{0,11}$/.test(trade.ticker) || typeof trade.ambiguousStopFirst !== 'boolean') throw new Error('invalid-input');
    seen.add(trade.id);
    const identity = JSON.stringify([trade.strategyId, trade.instrumentId, trade.ticker, trade.lotSize]);
    if (cohortIdentity !== null && cohortIdentity !== identity) throw new Error('cohort-mismatch');
    cohortIdentity = identity;
    const entryAt = canonicalTime(trade.entryAt);
    const window = strategyEntryWindow(trade.strategyId, 550, new Date(entryAt));
    if (!window || entryAt % (5 * MINUTE) !== 0 || day(entryAt) !== trade.sessionDate
      || !sandboxSessionEntryAllowed(new Date(entryAt)) || entryAt < window.entryStartMs || entryAt >= window.entryEndMs) throw new Error('invalid-input');
    const entry = BigInt(trade.entryNano); const stop = BigInt(trade.stopNano); const target = BigInt(trade.targetNano);
    if (entry <= 0n || !(target > entry && entry > stop && stop > 0n)) throw new Error('invalid-input');
    let exitKnownAt: number | null = null;
    if (trade.status === 'closed') {
      const exitAt = canonicalTime(trade.exitAt);
      const exit = BigInt(trade.exitNano!);
      if (exitAt < entryAt || day(exitAt) !== trade.sessionDate || clock(exitAt) > 1110
        || (trade.ambiguousStopFirst && trade.exitReason !== 'stop-touch')
        || (trade.exitReason === 'stop-touch' && (exit !== stop || clock(exitAt) === 1110))
        || (trade.exitReason === 'target-touch' && exit !== target)
        || (trade.exitReason === 'session-close' && (clock(exitAt) !== 1110 || exit < stop || exit >= target))) throw new Error('invalid-input');
      // The explicit 18:30 immutable-target cap is determined by that minute's OPEN, not its future HIGH.
      exitKnownAt = trade.exitReason === 'session-close' || (trade.exitReason === 'target-touch' && clock(exitAt) === 1110)
        ? exitAt : exitAt + MINUTE;
    } else {
      const unresolvedAt = canonicalTime(trade.unresolvedAt);
      if (unresolvedAt < entryAt || (trade.exitReason === 'missing-session-close' && clock(unresolvedAt) !== 1110)) throw new Error('invalid-input');
    }
    return { trade, index, entryAt, exitKnownAt };
  });
}

/** Same-cohort cash/risk model only; NEVER bid/ask, actual-fill or trading-admission evidence. */
export function validateCatalogCohortViability(input: CatalogCohortViabilityInput): CatalogCohortViabilityResult {
  const blockers: CatalogCohortBlocker[] = [];
  const accountLedger: CatalogCohortLedgerEntry[] = [];
  let cash: bigint | null = null;
  let open: PreparedTrade | null = null;
  let serviceFees = 0n;
  let reserved = 0n;
  let loss = 0n;
  let orders = 0;
  let ledgerDay = '';
  let entries = 0;
  let exits = 0;
  let compatible = false;
  const result = (): CatalogCohortViabilityResult => {
    const proven = blockers.length === 0 && entries > 0 && entries === exits && open === null;
    return { pathProven: proven, allowed: proven, cashFeasibilityProven: proven, riskLimitsProven: proven,
      productionCompatible: compatible, researchStatus: 'development-only', executableEvidence: false,
      cohort: 'fixed-original-attempts', dailyLossScope: 'negative-realized-trades-only',
      monthlyFeeModel: 'calendar-first-entry-before-entry-not-actual-billing', timing: 'entries-before-same-instant-exit-observations',
      blockers, accountLedger, endingCashNano: cash === null ? null : String(cash),
      openEntryGrossNano: open?.trade.entryGrossNano ?? '0', monthlyFeesNano: String(serviceFees),
      modeledEntryCount: entries, modeledExitCount: exits, admission: { allowed: false, executableEvidence: false } };
  };
  let trades: PreparedTrade[];
  try { trades = prepare(input); }
  catch (error) {
    blockers.push({ code: error instanceof Error && error.message === 'cohort-mismatch' ? 'cohort-mismatch' : 'invalid-input',
      tradeIndex: null, observedAt: null });
    return result();
  }
  const policy = input.policy;
  const capital = priceToNano(policy.capitalRub);
  cash = capital;
  compatible = policy.commissionRate === 0.003;
  if (trades.length === 0) { blockers.push({ code: 'empty-cohort', tradeIndex: null, observedAt: null }); return result(); }
  for (const item of trades) if (item.trade.status === 'unresolved') {
    blockers.push({ code: 'unresolved-attempt', tradeIndex: item.index, observedAt: item.trade.unresolvedAt });
  }
  const events = trades.flatMap(item => [
    { at: item.entryAt, kind: 'entry' as const, item },
    ...(item.exitKnownAt === null ? [] : [{ at: item.exitKnownAt, kind: 'exit' as const, item }]),
  ]).sort((a, b) => a.at - b.at || (a.kind === b.kind ? a.item.index - b.item.index : a.kind === 'entry' ? -1 : 1));
  const paidMonths = new Set<string>();
  const write = (kind: CatalogCohortLedgerEntry['kind'], item: PreparedTrade, at: number, before: bigint,
    change: bigint, accepted: boolean, required = 0n, risk = 0n, targetNet = 0n) => {
    accountLedger.push({ kind, tradeIndex: item.index, observedAt: iso(at), accepted,
      cashBeforeNano: String(before), cashChangeNano: String(change), cashAfterNano: String(cash),
      cashRequiredNano: String(required), tradeRiskNano: String(risk), netTargetNano: String(targetNet),
      reservedDailyRiskNano: String(reserved), realizedDailyLossNano: String(loss), ordersForDay: orders });
  };
  for (const event of events) {
    const { item, at, kind } = event;
    const trade = item.trade;
    if (day(at) !== ledgerDay && open === null) { ledgerDay = day(at); reserved = 0n; loss = 0n; orders = 0; }
    if (kind === 'exit') {
      if (open?.index !== item.index) { blockers.push({ code: 'invalid-input', tradeIndex: item.index, observedAt: iso(at) }); return result(); }
      const proceeds = BigInt(trade.exitGrossNano!) - BigInt(trade.exitCommissionNano!) - BigInt(trade.exitSlippageNano!);
      const before = cash;
      // Whole-kopeck floors can exceed a very small stop's gross proceeds. No model credit is allowed.
      if (before + proceeds < 0n) {
        write('exit', item, at, before, 0n, false, -proceeds);
        blockers.push({ code: 'exit-expenses-insufficient', tradeIndex: item.index, observedAt: iso(at) });
        return result();
      }
      cash += proceeds;
      const net = BigInt(trade.netNano!);
      if (net < 0n) loss -= net;
      open = null; exits += 1;
      write('exit', item, at, before, proceeds, true);
      continue;
    }
    const month = day(at).slice(0, 7);
    if (!paidMonths.has(month)) {
      const charge = BigInt(policy.monthlyFeeRub ?? 0) * RUB;
      if (charge > 0n) {
        const before = cash;
        if (charge > cash) {
          write('monthly-fee', item, at, before, 0n, false, charge);
          blockers.push({ code: 'monthly-fee-insufficient', tradeIndex: item.index, observedAt: iso(at) });
          return result();
        }
        cash -= charge; serviceFees += charge;
        write('monthly-fee', item, at, before, -charge, true, charge);
      }
      paidMonths.add(month);
    }
    const entryGross = BigInt(trade.entryGrossNano);
    const stopGross = BigInt(trade.stopNano) * BigInt(trade.units);
    const targetGross = BigInt(trade.targetNano) * BigInt(trade.units);
    const entryCosts = BigInt(trade.entryCommissionNano) + BigInt(trade.entrySlippageNano);
    const required = entryGross + entryCosts;
    const risk = entryGross - stopGross + entryCosts + expense(stopGross, policy.commissionRate) + expense(stopGross, policy.slippageRate);
    const targetNet = targetGross - entryGross - entryCosts - expense(targetGross, policy.commissionRate) - expense(targetGross, policy.slippageRate);
    const failed: CatalogCohortBlockerCode[] = [];
    if (open !== null) failed.push('overlapping-position');
    if (required > capital || required > cash) failed.push('cash-insufficient');
    if (risk > priceToNano(policy.maxTradeRiskRub)) failed.push('trade-risk-limit');
    if (reserved + risk > priceToNano(policy.maxDailyRiskRub)) failed.push('daily-risk-limit');
    if (loss >= priceToNano(policy.maxDailyLossRub) || loss + risk > priceToNano(policy.maxDailyLossRub)) failed.push('daily-loss-limit');
    if (orders >= policy.maxOrdersPerDay) failed.push('max-orders-per-day');
    if (targetNet <= 0n || targetNet < 2n * risk) failed.push('net-reward-to-risk');
    if (compatible) {
      try {
        const pilot = assessLivePilotRisk({ prepare: true, capitalRub: policy.capitalRub, maxTradeRiskRub: 20, maxDailyRiskRub: 60, maxDailyLossRub: 60 },
          { side: 'long', entryPrice: rubles(BigInt(trade.entryNano)), stopPrice: rubles(BigInt(trade.stopNano)), targetPrice: rubles(BigInt(trade.targetNano)),
            lots: trade.lots, lotSize: trade.lotSize, commissionRate: policy.commissionRate, slippageRate: policy.slippageRate,
            availableCashRub: rubles(cash < capital ? cash : capital), reservedDailyRiskRub: rubles(reserved),
            realizedDailyLossRub: rubles(loss), markedOpenLossRub: 0 });
        if (!pilot.allowed) failed.push('production-risk-gate');
      } catch { failed.push('production-risk-gate'); }
    }
    if (failed.length > 0) {
      write('entry', item, at, cash, 0n, false, required, risk, targetNet);
      blockers.push(...failed.map(code => ({ code, tradeIndex: item.index, observedAt: iso(at) })));
      return result();
    }
    const before = cash;
    cash -= required; reserved += risk; orders += 1; entries += 1; open = item;
    write('entry', item, at, before, -required, true, required, risk, targetNet);
  }
  return result();
}

import type { LivePilotConfig } from '../config.js';

const scale = 1_000_000_000n;
const kopek = 10_000_000n;

// Convert decimal numbers without floating point monetary arithmetic. Round up any
// sub-nanoruble tail; costs are subsequently rounded up to a whole kopek.
function fixed(value: number): bigint {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new Error('Pilot amounts must be finite, non-negative and bounded');
  }
  const [mantissa = '', exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole = '', fraction = ''] = mantissa.split('.');
  const digits = BigInt(whole + fraction);
  const shift = 9 + Number(exponent) - fraction.length;
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  return ceilDivide(digits, 10n ** BigInt(-shift));
}

function ceilDivide(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

function cost(notional: bigint, rate: bigint): bigint {
  return ceilDivide(notional * rate, scale * kopek) * kopek;
}

function entryCashRequired(notional: bigint, commission: bigint, slippage: bigint): bigint {
  return notional + cost(notional, commission) + cost(notional, slippage);
}

/** Same exact Investor entry-cost calculation as the pilot gate, not a new gate. */
export function pilotEntryCashRequiredNano(input: {
  entryPrice: number; lots: number; lotSize: number; commissionRate: number; slippageRate: number;
}): string {
  if (![input.lots, input.lotSize].every(value => Number.isSafeInteger(value) && value > 0 && value <= 1_000_000)) {
    throw new Error('A positive bounded whole-lot quantity is required');
  }
  const entry = fixed(input.entryPrice), commission = fixed(input.commissionRate), slippage = fixed(input.slippageRate);
  if (entry <= 0n || commission < fixed(0.003) || commission > fixed(0.1) || slippage > fixed(0.02)) {
    throw new Error('Investor commission floor or bounded entry price and slippage is not satisfied');
  }
  return String(entryCashRequired(entry * BigInt(input.lots) * BigInt(input.lotSize), commission, slippage));
}

function rubles(value: bigint): number {
  return Number(value) / Number(scale);
}

export function pilotPositionBudget(capitalRub: number, commissionRate: number, slippageRate: number): number {
  const budget = fixed(capitalRub) * scale / (scale + fixed(commissionRate) + fixed(slippageRate));
  return Number(budget / kopek) / 100;
}

export function riskBudgetFits(reserved: number[], nextRiskRub: number, limitRub: number): boolean {
  return reserved.reduce((sum, value) => sum + fixed(value), 0n) + fixed(nextRiskRub) <= fixed(limitRub);
}

export type LivePilotRiskInput = {
  side: 'long' | 'short';
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  lots: number;
  lotSize: number;
  commissionRate: number;
  slippageRate: number;
  availableCashRub: number;
  reservedDailyRiskRub: number;
  realizedDailyLossRub: number;
  markedOpenLossRub: number;
};

export type LivePilotRiskResult = {
  allowed: boolean;
  positionRub: number;
  cashRequiredRub: number;
  totalRiskRub: number;
  netRewardRub: number;
  blockers: string[];
};

// This pure gate is a prerequisite, NOT live execution or an actual-loss monitor.
// A future executor must reserve risk transactionally and supply reconciled losses.
export function assessLivePilotRisk(policy: LivePilotConfig, input: LivePilotRiskInput): LivePilotRiskResult {
  for (const value of [input.lots, input.lotSize]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) {
      throw new Error('A positive bounded whole-lot quantity is required');
    }
  }
  const capital = fixed(policy.capitalRub);
  const tradeLimit = fixed(policy.maxTradeRiskRub);
  const dayRiskLimit = fixed(policy.maxDailyRiskRub);
  const dayLossLimit = fixed(policy.maxDailyLossRub);
  if (capital <= 0n || capital > fixed(1_000) || tradeLimit <= 0n || tradeLimit > fixed(20)
    || dayRiskLimit <= 0n || dayRiskLimit > fixed(60) || dayLossLimit <= 0n || dayLossLimit > fixed(60)) {
    throw new Error('Pilot policy exceeds the approved limits');
  }
  const entry = fixed(input.entryPrice);
  const stop = fixed(input.stopPrice);
  const target = fixed(input.targetPrice);
  if (!(entry > stop && stop > 0n && target > entry)) {
    throw new Error('Pilot requires a positive long entry, stop below and target above');
  }
  const commission = fixed(input.commissionRate);
  const slippage = fixed(input.slippageRate);
  if (commission < fixed(0.003) || commission > fixed(0.1) || slippage > fixed(0.02)) {
    throw new Error('Investor commission floor or bounded slippage is not satisfied');
  }
  const units = BigInt(input.lots) * BigInt(input.lotSize);
  const entryValue = entry * units;
  const stopValue = stop * units;
  const targetValue = target * units;
  const entryCosts = cost(entryValue, commission) + cost(entryValue, slippage);
  const risk = entryValue - stopValue + entryCosts + cost(stopValue, commission) + cost(stopValue, slippage);
  const reward = targetValue - entryValue - entryCosts - cost(targetValue, commission) - cost(targetValue, slippage);
  const cashRequired = entryCashRequired(entryValue, commission, slippage);
  const reservedRisk = fixed(input.reservedDailyRiskRub);
  const actualLoss = fixed(input.realizedDailyLossRub) + fixed(input.markedOpenLossRub);
  const blockers: string[] = [];
  if (!policy.prepare) blockers.push('Daily pilot preparation is disabled');
  if (input.side !== 'long') blockers.push('Short and margin trading are forbidden');
  if (cashRequired > capital || cashRequired > fixed(input.availableCashRub)) blockers.push('Cash including entry costs is insufficient');
  if (risk > tradeLimit) blockers.push('Trade risk including round-trip expenses exceeds the limit');
  if (reservedRisk + risk > dayRiskLimit) blockers.push('Daily reserved risk budget would be exceeded');
  if (actualLoss >= dayLossLimit || actualLoss + risk > dayLossLimit) blockers.push('Daily loss allowance would be exceeded');
  if (reward <= 0n || reward < 2n * risk) blockers.push('Net reward-to-risk is below 2.0');
  return { allowed: blockers.length === 0, positionRub: rubles(entryValue), cashRequiredRub: rubles(cashRequired), totalRiskRub: rubles(risk), netRewardRub: rubles(reward), blockers };
}

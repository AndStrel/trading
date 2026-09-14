import { roundMoney } from './money.js';

export type TradePlanInput = {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  lotSize: number;
  maxRiskRub: number;
  maxPositionRub: number;
  commissionRate: number;
  slippageRate: number;
};

export type TradePlan = {
  allowed: boolean;
  lots: number;
  units: number;
  positionRub: number;
  grossRiskRub: number;
  estimatedCommissionRub: number;
  estimatedSlippageRub: number;
  totalRiskRub: number;
  grossRewardRub: number;
  netRewardRub: number;
  rewardToRisk: number;
  reasons: string[];
};

export function calculateTradePlan(input: TradePlanInput): TradePlan {
  const { entryPrice, stopPrice, targetPrice, lotSize, maxRiskRub, maxPositionRub } = input;
  const values = Object.values(input);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('All numeric values must be finite and non-negative');
  }
  if (entryPrice <= 0 || lotSize < 1 || maxRiskRub <= 0 || maxPositionRub <= 0) {
    throw new Error('Entry, lot size and limits must be greater than zero');
  }
  if (!Number.isInteger(lotSize)) throw new Error('Lot size must be an integer');

  const priceRiskPerUnit = Math.abs(entryPrice - stopPrice);
  const rewardPerUnit = Math.abs(targetPrice - entryPrice);
  if (priceRiskPerUnit === 0) throw new Error('Stop price must differ from entry price');

  const roundTripCostRate = input.commissionRate * 2 + input.slippageRate * 2;
  const estimatedCostPerUnit = entryPrice * roundTripCostRate;
  const totalRiskPerLot = (priceRiskPerUnit + estimatedCostPerUnit) * lotSize;
  const lotsByRisk = Math.floor(maxRiskRub / totalRiskPerLot);
  const lotsByPosition = Math.floor(maxPositionRub / (entryPrice * lotSize));
  const lots = Math.max(0, Math.min(lotsByRisk, lotsByPosition));
  const units = lots * lotSize;
  const positionRub = entryPrice * units;
  const grossRiskRub = priceRiskPerUnit * units;
  const estimatedCommissionRub = positionRub * input.commissionRate * 2;
  const estimatedSlippageRub = positionRub * input.slippageRate * 2;
  const totalRiskRub = grossRiskRub + estimatedCommissionRub + estimatedSlippageRub;
  const grossRewardRub = rewardPerUnit * units;
  const netRewardRub = grossRewardRub - estimatedCommissionRub - estimatedSlippageRub;
  const rewardToRisk = totalRiskRub > 0 ? netRewardRub / totalRiskRub : 0;
  const reasons: string[] = [];

  if (lots === 0) reasons.push('No whole lot fits the configured risk and position limits');
  if (rewardToRisk < 2) reasons.push('Net reward-to-risk is below 2.0');
  if (netRewardRub <= 0) reasons.push('Expected costs consume the potential reward');

  return {
    allowed: reasons.length === 0,
    lots,
    units,
    positionRub: roundMoney(positionRub),
    grossRiskRub: roundMoney(grossRiskRub),
    estimatedCommissionRub: roundMoney(estimatedCommissionRub),
    estimatedSlippageRub: roundMoney(estimatedSlippageRub),
    totalRiskRub: roundMoney(totalRiskRub),
    grossRewardRub: roundMoney(grossRewardRub),
    netRewardRub: roundMoney(netRewardRub),
    rewardToRisk: Math.round(rewardToRisk * 100) / 100,
    reasons,
  };
}

import { roundMoney } from './money.js';

export type PaperTradeSide = 'long' | 'short';

export type PaperEntry = {
  entryMarketPrice: number;
  entryFillPrice: number;
  entryCommissionRub: number;
  entrySlippageRub: number;
};

export type PaperExit = {
  exitMarketPrice: number;
  exitFillPrice: number;
  exitCommissionRub: number;
  exitSlippageRub: number;
  grossPnlRub: number;
  totalCommissionRub: number;
  totalSlippageRub: number;
  netPnlRub: number;
};

function assertFinitePositive(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(name + ' must be a finite number greater than zero');
  }
}

function assertRate(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 0.1) {
    throw new Error(name + ' must be a finite rate from 0 to 0.1');
  }
}

function fillPrice(side: PaperTradeSide, marketPrice: number, slippageRate: number, opening: boolean) {
  const adverseMove =
    (side === 'long' && opening) || (side === 'short' && !opening) ? 1 + slippageRate : 1 - slippageRate;
  return marketPrice * adverseMove;
}

export function calculatePaperEntry(input: {
  side: PaperTradeSide;
  units: number;
  marketPrice: number;
  commissionRate: number;
  slippageRate: number;
}): PaperEntry {
  assertFinitePositive('units', input.units);
  assertFinitePositive('marketPrice', input.marketPrice);
  assertRate('commissionRate', input.commissionRate);
  assertRate('slippageRate', input.slippageRate);

  const entryFillPrice = fillPrice(input.side, input.marketPrice, input.slippageRate, true);
  return {
    entryMarketPrice: roundMoney(input.marketPrice),
    entryFillPrice: roundMoney(entryFillPrice),
    entryCommissionRub: roundMoney(entryFillPrice * input.units * input.commissionRate),
    entrySlippageRub: roundMoney(Math.abs(entryFillPrice - input.marketPrice) * input.units),
  };
}

export function calculatePaperExit(input: {
  side: PaperTradeSide;
  units: number;
  entryFillPrice: number;
  entryCommissionRub: number;
  entrySlippageRub: number;
  marketPrice: number;
  commissionRate: number;
  slippageRate: number;
}): PaperExit {
  assertFinitePositive('units', input.units);
  assertFinitePositive('entryFillPrice', input.entryFillPrice);
  assertFinitePositive('marketPrice', input.marketPrice);
  assertRate('commissionRate', input.commissionRate);
  assertRate('slippageRate', input.slippageRate);

  const exitFillPrice = fillPrice(input.side, input.marketPrice, input.slippageRate, false);
  const grossPnlRub =
    input.side === 'long'
      ? (exitFillPrice - input.entryFillPrice) * input.units
      : (input.entryFillPrice - exitFillPrice) * input.units;
  const exitCommissionRub = exitFillPrice * input.units * input.commissionRate;
  const totalCommissionRub = input.entryCommissionRub + exitCommissionRub;
  const exitSlippageRub = Math.abs(exitFillPrice - input.marketPrice) * input.units;
  const totalSlippageRub = input.entrySlippageRub + exitSlippageRub;

  return {
    exitMarketPrice: roundMoney(input.marketPrice),
    exitFillPrice: roundMoney(exitFillPrice),
    exitCommissionRub: roundMoney(exitCommissionRub),
    exitSlippageRub: roundMoney(exitSlippageRub),
    grossPnlRub: roundMoney(grossPnlRub),
    totalCommissionRub: roundMoney(totalCommissionRub),
    totalSlippageRub: roundMoney(totalSlippageRub),
    netPnlRub: roundMoney(grossPnlRub - totalCommissionRub),
  };
}

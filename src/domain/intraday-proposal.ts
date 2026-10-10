import type { CandleAnalysis } from './candle-analysis.js';
import { quotationToNumber } from './money.js';
import { MAX_SUPPORTED_PRICE, priceToNano, roundPriceToTick } from './price-tick.js';

export type IntradayLongProposal = {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  reasons: string[];
};

function bestAsk(orderBookPayload: unknown): number | null {
  if (typeof orderBookPayload !== 'object' || orderBookPayload === null) return null;
  const asks = (orderBookPayload as { asks?: unknown }).asks;
  if (!Array.isArray(asks) || asks.length === 0) return null;

  const prices = asks
    .filter((item): item is { price?: { units?: string | number; nano?: number } } =>
      typeof item === 'object' && item !== null,
    )
    .map((item) => quotationToNumber(item.price))
    .filter((price): price is number => price !== null && price > 0);

  return prices.length === 0 ? null : Math.min(...prices);
}

export function proposeIntradayLong(input: {
  candleAnalysis: CandleAnalysis;
  orderBookPayload: unknown;
  priceStep: number;
  commissionRate: number;
  slippageRate: number;
}): IntradayLongProposal | null {
  const { candleAnalysis, priceStep } = input;
  if (!Number.isFinite(priceStep) || priceStep <= 0) {
    throw new Error('priceStep must be a finite number greater than zero');
  }
  priceToNano(priceStep);
  if (
    !Number.isFinite(input.commissionRate) ||
    !Number.isFinite(input.slippageRate) ||
    input.commissionRate < 0 ||
    input.slippageRate < 0
  ) {
    throw new Error('commissionRate and slippageRate must be finite non-negative values');
  }
  if (candleAnalysis.status !== 'ok') return null;
  if (candleAnalysis.trend !== 'up') return null;
  if (candleAnalysis.relativeVolume === null || candleAnalysis.relativeVolume < 1) return null;
  if (candleAnalysis.averageTrueRange14 === null || candleAnalysis.averageTrueRange14 <= 0) return null;

  const bestAskPrice = bestAsk(input.orderBookPayload);
  if (bestAskPrice === null || bestAskPrice > MAX_SUPPORTED_PRICE) return null;

  const entryPrice = roundPriceToTick(bestAskPrice, priceStep, 'ceil');
  const riskPerUnit = Math.max(candleAnalysis.averageTrueRange14 * 1.5, entryPrice * 0.001);
  const roundTripCostPerUnit = entryPrice * (input.commissionRate * 2 + input.slippageRate * 2);
  const targetDistance = Math.max(
    riskPerUnit * 2.5,
    riskPerUnit * 2 + roundTripCostPerUnit * 3,
  );
  if (targetDistance > candleAnalysis.averageTrueRange14 * 5) return null;

  if (entryPrice - riskPerUnit <= 0 || entryPrice + targetDistance > MAX_SUPPORTED_PRICE) return null;
  const stopPrice = roundPriceToTick(entryPrice - riskPerUnit, priceStep, 'floor');
  const targetPrice = roundPriceToTick(entryPrice + targetDistance, priceStep, 'ceil');
  if (stopPrice <= 0 || stopPrice >= entryPrice || targetPrice <= entryPrice) return null;

  return {
    entryPrice,
    stopPrice,
    targetPrice,
    reasons: [
      'Five-minute trend is up',
      'Relative volume is at least 1.0',
      'Stop uses the larger of 1.5 ATR and 0.1% of entry',
      'Target is a model estimate; whole-lot sizing and exact rounded-expense checks are required',
    ],
  };
}

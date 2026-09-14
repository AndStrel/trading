import type { CandleAnalysis } from './candle-analysis.js';
import { quotationToNumber } from './money.js';

export type IntradayLongProposal = {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  reasons: string[];
};

function roundDownToStep(value: number, step: number) {
  return Math.floor((value + Number.EPSILON) / step) * step;
}

function roundUpToStep(value: number, step: number) {
  return Math.ceil((value - Number.EPSILON) / step) * step;
}

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
}): IntradayLongProposal | null {
  const { candleAnalysis, priceStep } = input;
  if (!Number.isFinite(priceStep) || priceStep <= 0) {
    throw new Error('priceStep must be a finite number greater than zero');
  }
  if (candleAnalysis.status !== 'ok') return null;
  if (candleAnalysis.trend !== 'up') return null;
  if (candleAnalysis.relativeVolume === null || candleAnalysis.relativeVolume < 1) return null;
  if (candleAnalysis.averageTrueRange14 === null || candleAnalysis.averageTrueRange14 <= 0) return null;

  const entryPrice = bestAsk(input.orderBookPayload);
  if (entryPrice === null) return null;

  const riskPerUnit = Math.max(candleAnalysis.averageTrueRange14 * 1.5, entryPrice * 0.001);
  const stopPrice = roundDownToStep(entryPrice - riskPerUnit, priceStep);
  const targetPrice = roundUpToStep(entryPrice + riskPerUnit * 2.5, priceStep);
  if (stopPrice <= 0 || stopPrice >= entryPrice || targetPrice <= entryPrice) return null;

  return {
    entryPrice,
    stopPrice,
    targetPrice,
    reasons: [
      'Five-minute trend is up',
      'Relative volume is at least 1.0',
      'Stop uses the larger of 1.5 ATR and 0.1% of entry',
      'Target is 2.5 times the planned price risk before costs',
    ],
  };
}

import { type CandleAnalysis } from './candle-analysis.js';
import { quotationToNumber, roundMoney, type Quotation } from './money.js';
import { type TradePlan } from './trade-plan.js';

type ApiRecord = Record<string, unknown>;

type PriceLevel = {
  price: number;
  quantity: number | null;
};

export type ScenarioDecision = 'candidate' | 'review' | 'blocked';

export type TradeScenarioInput = {
  side: 'long' | 'short';
  entryPrice: number;
  maxSpreadPct: number;
  maxEntryDeviationPct: number;
  allowShort: boolean;
  tradePlan: TradePlan;
  candleAnalysis: CandleAnalysis;
  lastPricesPayload: unknown;
  orderBookPayload: unknown;
  tradingStatusPayload: unknown;
};

export type TradeScenarioAssessment = {
  decision: ScenarioDecision;
  blockers: string[];
  warnings: string[];
  market: {
    lastPrice: number | null;
    bestBid: number | null;
    bestAsk: number | null;
    bestBidQuantity: number | null;
    bestAskQuantity: number | null;
    spreadRub: number | null;
    spreadPct: number | null;
    orderBookConsistent: boolean | null;
    tradingStatus: string | null;
    apiTradeAvailable: boolean | null;
    limitOrderAvailable: boolean | null;
    marketOrderAvailable: boolean | null;
    entryDeviationPct: number | null;
  };
};

function asRecord(value: unknown): ApiRecord | null {
  return typeof value === 'object' && value !== null ? (value as ApiRecord) : null;
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asPriceLevel(value: unknown): PriceLevel | null {
  const record = asRecord(value);
  if (!record) return null;

  const price = quotationToNumber(record.price as Quotation | undefined);
  if (price === null || price <= 0) return null;

  const quantity = asFiniteNumber(record.quantity);
  return { price, quantity: quantity !== null && quantity >= 0 ? quantity : null };
}

function readPriceLevels(payload: unknown, key: 'bids' | 'asks'): PriceLevel[] {
  const record = asRecord(payload);
  const value = record?.[key];
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const level = asPriceLevel(item);
    return level ? [level] : [];
  });
}

function selectBest(levels: PriceLevel[], side: 'bid' | 'ask'): PriceLevel | null {
  if (levels.length === 0) return null;
  return levels.reduce((best, level) => {
    if (side === 'bid') return level.price > best.price ? level : best;
    return level.price < best.price ? level : best;
  });
}

function readLastPrice(payload: unknown): number | null {
  const record = asRecord(payload);
  const prices = record?.lastPrices;
  if (!Array.isArray(prices)) return null;

  for (const price of prices) {
    const priceRecord = asRecord(price);
    const value = quotationToNumber(priceRecord?.price as Quotation | undefined);
    if (value !== null && value > 0) return value;
  }
  return null;
}

function roundPercent(value: number | null): number | null {
  return value === null ? null : Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function assessTradeScenario(input: TradeScenarioInput): TradeScenarioAssessment {
  const bids = readPriceLevels(input.orderBookPayload, 'bids');
  const asks = readPriceLevels(input.orderBookPayload, 'asks');
  const bestBid = selectBest(bids, 'bid');
  const bestAsk = selectBest(asks, 'ask');
  const orderBook = asRecord(input.orderBookPayload);
  const tradingStatus = asRecord(input.tradingStatusPayload);
  const lastPrice = readLastPrice(input.lastPricesPayload);

  const spreadRub =
    bestBid && bestAsk && bestAsk.price >= bestBid.price ? bestAsk.price - bestBid.price : null;
  const spreadPct =
    spreadRub !== null && bestBid && bestAsk
      ? (spreadRub / ((bestAsk.price + bestBid.price) / 2)) * 100
      : null;
  const entryDeviationPct =
    lastPrice !== null && lastPrice > 0 ? (Math.abs(input.entryPrice - lastPrice) / lastPrice) * 100 : null;

  const orderBookConsistent = asBoolean(orderBook?.isConsistent);
  const apiTradeAvailable = asBoolean(tradingStatus?.apiTradeAvailable);
  const limitOrderAvailable = asBoolean(tradingStatus?.limitOrderAvailable);
  const marketOrderAvailable = asBoolean(tradingStatus?.marketOrderAvailable);
  const tradingStatusValue = asString(tradingStatus?.tradingStatus);

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!input.tradePlan.allowed) {
    blockers.push(...input.tradePlan.reasons);
  }
  if (input.side === 'short' && !input.allowShort) {
    blockers.push('Short scenarios are disabled by configuration');
  }
  if (apiTradeAvailable !== true) {
    blockers.push('API trading availability is not confirmed');
  }
  if (limitOrderAvailable !== true) {
    blockers.push('Limit order availability is not confirmed');
  }
  if (tradingStatusValue !== 'SECURITY_TRADING_STATUS_NORMAL_TRADING') {
    blockers.push('Instrument is not in normal trading status');
  }
  if (orderBookConsistent !== true) {
    blockers.push('Order book consistency is not confirmed');
  }
  if (spreadPct === null) {
    blockers.push('A valid bid/ask spread is unavailable');
  } else if (spreadPct > input.maxSpreadPct) {
    blockers.push(
      `Bid/ask spread ${roundPercent(spreadPct)}% exceeds the ${input.maxSpreadPct}% strategy limit`,
    );
  }

  if (lastPrice === null) {
    warnings.push('Latest exchange price is unavailable');
  } else if (
    entryDeviationPct !== null &&
    entryDeviationPct > input.maxEntryDeviationPct
  ) {
    warnings.push(
      `Planned entry differs from the latest price by ${roundPercent(entryDeviationPct)}%, above the ${input.maxEntryDeviationPct}% review threshold`,
    );
  }
  if (input.candleAnalysis.status !== 'ok') {
    warnings.push('Candle history is insufficient for a complete trend assessment');
  } else if (
    (input.side === 'long' && input.candleAnalysis.trend === 'down') ||
    (input.side === 'short' && input.candleAnalysis.trend === 'up')
  ) {
    warnings.push('Candle trend opposes the planned trade direction');
  } else if (
    input.candleAnalysis.trend === 'flat' ||
    input.candleAnalysis.trend === 'insufficient_data'
  ) {
    warnings.push('Candle trend does not confirm the planned trade direction');
  }
  if (
    input.candleAnalysis.relativeVolume !== null &&
    input.candleAnalysis.relativeVolume < 0.7
  ) {
    warnings.push('Relative volume is below 0.7 of the previous 20 complete candles');
  }

  return {
    decision: blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'review' : 'candidate',
    blockers,
    warnings,
    market: {
      lastPrice: lastPrice === null ? null : roundMoney(lastPrice),
      bestBid: bestBid ? roundMoney(bestBid.price) : null,
      bestAsk: bestAsk ? roundMoney(bestAsk.price) : null,
      bestBidQuantity: bestBid?.quantity ?? null,
      bestAskQuantity: bestAsk?.quantity ?? null,
      spreadRub: spreadRub === null ? null : roundMoney(spreadRub),
      spreadPct: roundPercent(spreadPct),
      orderBookConsistent,
      tradingStatus: tradingStatusValue,
      apiTradeAvailable,
      limitOrderAvailable,
      marketOrderAvailable,
      entryDeviationPct: roundPercent(entryDeviationPct),
    },
  };
}

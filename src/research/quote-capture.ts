import { quotationToNumber, type Quotation } from '../domain/money.js';

export type QuoteSample = {
  observedAt: string;
  bookAt: string;
  instrumentId: string;
  bid: number;
  ask: number;
  bidQuantity: number;
  askQuantity: number;
  spreadPct: number;
};

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null ? value as RecordValue : null;
}

function bestLevel(value: unknown, side: 'bid' | 'ask'): { price: number; quantity: number } | null {
  if (!Array.isArray(value)) return null;
  let best: { price: number; quantity: number } | null = null;
  for (const item of value) {
    const level = asRecord(item);
    const price = quotationToNumber(level?.price as Quotation | undefined);
    const quantity = Number(level?.quantity);
    if (price === null || price <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0) continue;
    if (best === null || (side === 'bid' ? price > best.price : price < best.price)) {
      best = { price, quantity };
    }
  }
  return best;
}

export function parseQuoteSample(input: {
  instrumentId: string;
  observedAt: string;
  payload: unknown;
  maxAgeMs?: number;
}): QuoteSample | null {
  const book = asRecord(input.payload);
  if (!book || book.isConsistent !== true) return null;
  const bookAt = typeof book.time === 'string' ? book.time : null;
  const observedMs = Date.parse(input.observedAt);
  const bookMs = bookAt === null ? NaN : Date.parse(bookAt);
  const maxAgeMs = input.maxAgeMs ?? 10_000;
  if (!Number.isFinite(observedMs) || !Number.isFinite(bookMs) ||
      !Number.isFinite(maxAgeMs) || maxAgeMs < 0 ||
      bookMs > observedMs + 1_000 || observedMs - bookMs > maxAgeMs) return null;
  const bid = bestLevel(book.bids, 'bid');
  const ask = bestLevel(book.asks, 'ask');
  if (!bid || !ask || bid.price >= ask.price) return null;
  return {
    observedAt: input.observedAt,
    bookAt: bookAt!,
    instrumentId: input.instrumentId,
    bid: bid.price,
    ask: ask.price,
    bidQuantity: bid.quantity,
    askQuantity: ask.quantity,
    spreadPct: ((ask.price - bid.price) / ((ask.price + bid.price) / 2)) * 100,
  };
}

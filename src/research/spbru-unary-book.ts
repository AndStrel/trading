import { quotationToNumber, type Quotation } from '../domain/money.js';

const expectedUid = '498ec3ff-ef27-4729-9703-a5aac48d5789';
type RecordValue = Record<string, unknown>;
export type SpbruBookLevel = { price: number; quantity: number };
export type SpbruBookSample = { instrumentId: string; observedAtUtc: string; bookAtUtc: string;
  bids: SpbruBookLevel[]; asks: SpbruBookLevel[]; bid: number; ask: number;
  bidQuantity: number; askQuantity: number; spreadBps: number; ageMs: number };

function asRecord(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}

function levels(value: unknown, side: 'bid' | 'ask'): SpbruBookLevel[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) return null;
  const parsed = value.map((item) => {
    const row = asRecord(item);
    const price = quotationToNumber(row?.price as Quotation | undefined);
    const quantity = Number(row?.quantity);
    return price !== null && Number.isFinite(price) && price > 0 && Number.isSafeInteger(quantity) && quantity > 0
      ? { price, quantity } : null;
  });
  if (parsed.some((row) => row === null)) return null;
  const rows = parsed as SpbruBookLevel[];
  for (let index = 1; index < rows.length; index += 1) {
    if (side === 'bid' ? rows[index]!.price >= rows[index - 1]!.price : rows[index]!.price <= rows[index - 1]!.price) {
      return null;
    }
  }
  return rows;
}

export function parseSpbruUnaryBook(input: { observedAtUtc: string; payload: unknown; maxAgeMs?: number }): SpbruBookSample | null {
  const book = asRecord(input.payload);
  if (!book || book.instrumentUid !== expectedUid ||
      (book.priceCurrency !== undefined && book.priceCurrency !== 'RUB')) return null;
  const bookAtUtc = typeof book.orderbookTs === 'string' ? book.orderbookTs : null;
  const observedMs = Date.parse(input.observedAtUtc);
  const bookMs = bookAtUtc ? Date.parse(bookAtUtc) : NaN;
  const maxAgeMs = input.maxAgeMs ?? 15_000;
  const ageMs = observedMs - bookMs;
  if (!Number.isFinite(observedMs) || !Number.isFinite(bookMs) || !Number.isFinite(maxAgeMs) ||
      maxAgeMs < 0 || ageMs < -1_000 || ageMs > maxAgeMs) return null;
  const bids = levels(book.bids, 'bid');
  const asks = levels(book.asks, 'ask');
  if (!bids || !asks || bids[0]!.price >= asks[0]!.price) return null;
  const bid = bids[0]!.price;
  const ask = asks[0]!.price;
  return { instrumentId: expectedUid, observedAtUtc: input.observedAtUtc, bookAtUtc: bookAtUtc!,
    bids, asks, bid, ask, bidQuantity: bids[0]!.quantity, askQuantity: asks[0]!.quantity,
    spreadBps: 10_000 * (ask - bid) / ((ask + bid) / 2), ageMs };
}

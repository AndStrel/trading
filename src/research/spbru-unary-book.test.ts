import { describe, expect, it } from 'vitest';
import { parseSpbruUnaryBook } from './spbru-unary-book.js';

const uid = '498ec3ff-ef27-4729-9703-a5aac48d5789';
const book = { instrumentUid: uid, priceCurrency: 'RUB', orderbookTs: '2026-09-28T17:09:07Z',
  bids: [{ price: { units: '165', nano: 60_000_000 }, quantity: '20783919' }],
  asks: [{ price: { units: '165', nano: 70_000_000 }, quantity: '19005531' }] };

describe('SPBRU unary order book', () => {
  it('parses only fresh, same-UID and uncrossed prices', () => {
    const sample = parseSpbruUnaryBook({ observedAtUtc: '2026-09-28T17:09:11Z', payload: book });
    expect(sample).toMatchObject({ instrumentId: uid, bid: 165.06, ask: 165.07,
      bidQuantity: 20783919, askQuantity: 19005531, ageMs: 4000 });
    expect(parseSpbruUnaryBook({ observedAtUtc: '2026-09-28T17:10:00Z', payload: book })).toBeNull();
    expect(parseSpbruUnaryBook({ observedAtUtc: '2026-09-28T17:09:11Z',
      payload: { ...book, instrumentUid: 'other' } })).toBeNull();
    expect(parseSpbruUnaryBook({ observedAtUtc: '2026-09-28T17:09:11Z',
      payload: { ...book, asks: book.bids } })).toBeNull();
  });
});

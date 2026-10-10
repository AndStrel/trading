import { describe, expect, it } from 'vitest';
import { analyzeSpbruQuoteAttempts } from './spbru-quote-quality.js';
import { parseSpbruUnaryBook } from './spbru-unary-book.js';

const payload = { instrumentUid: '498ec3ff-ef27-4729-9703-a5aac48d5789', priceCurrency: 'RUB',
  orderbookTs: '2026-09-28T17:10:07Z',
  bids: [{ price: { units: '165', nano: 60_000_000 }, quantity: '100' }],
  asks: [{ price: { units: '165', nano: 70_000_000 }, quantity: '100' }] };
const sample = parseSpbruUnaryBook({ observedAtUtc: '2026-09-28T17:10:11Z', payload });
if (!sample) throw new Error('Invalid quote fixture');
const sample2 = parseSpbruUnaryBook({ observedAtUtc: '2026-09-28T17:15:11Z',
  payload: { ...payload, orderbookTs: '2026-09-28T17:15:07Z' } });
if (!sample2) throw new Error('Invalid second quote fixture');

describe('SPBRU quote quality', () => {
  it('counts requests separately from unique order-book events', () => {
    const rows = [
      { slot: '2026-09-28T20:10+03:00', startedAtUtc: '2026-09-28T17:10:10Z',
        observedAtUtc: '2026-09-28T17:10:11Z', result: 'accepted', sample },
      { slot: '2026-09-28T20:15+03:00', startedAtUtc: '2026-09-28T17:15:10Z',
        observedAtUtc: '2026-09-28T17:15:11Z', result: 'accepted', sample: sample2 },
      { slot: '2026-09-28T20:20+03:00', startedAtUtc: '2026-09-28T17:20:00Z',
        observedAtUtc: '2026-09-28T17:20:01Z', result: 'rejected', reason: 'not_normal_trading' },
    ];
    const result = analyzeSpbruQuoteAttempts(rows.map((row) => JSON.stringify(row)));
    expect(result).toMatchObject({ attempts: 3, accepted: 2, rejected: 1,
      uniqueBooks: 2, repeatedBooks: 0, distinctTopLevels: 1, repeatedTopLevels: 1,
      bookAgeMs: { median: 4000 } });
    expect(() => analyzeSpbruQuoteAttempts([JSON.stringify(rows[0]), JSON.stringify(rows[0])])).toThrow('Duplicate');
  });
});

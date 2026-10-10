import { describe, expect, it } from 'vitest';
import { parseBrLatePage } from './research-br-2026-late-source.js';

describe('BR late source', () => {
  it('accepts valid late-session rows and rejects other times', () => {
    const columns = ['open', 'close', 'high', 'low', 'volume', 'begin'];
    expect(parseBrLatePage({ candles: { columns, data: [[105, 106, 107, 104, 3, '2026-09-25 17:00:00']] } }, '2026-09-25')).toHaveLength(1);
    expect(() => parseBrLatePage({ candles: { columns, data: [[105, 106, 107, 104, 3, '2026-09-25 19:00:00']] } }, '2026-09-25')).toThrow();
  });
});

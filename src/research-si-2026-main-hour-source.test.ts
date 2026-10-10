import { describe, expect, it } from 'vitest';
import { parseMainHourPage } from './research-si-2026-main-hour-source.js';

describe('Si 2026 main-hour source', () => {
  it('accepts valid 09:00 candles and rejects later session rows', () => {
    const columns = ['open', 'close', 'high', 'low', 'volume', 'begin'];
    expect(parseMainHourPage({ candles: { columns, data: [[100, 101, 102, 99, 12, '2026-09-25 09:00:00']] } }, '2026-09-25')).toHaveLength(1);
    expect(() => parseMainHourPage({ candles: { columns, data: [[100, 101, 102, 99, 12, '2026-09-25 10:00:00']] } }, '2026-09-25')).toThrow();
  });
});

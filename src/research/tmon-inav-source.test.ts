import { describe, expect, it } from 'vitest';
import { parseInavPage } from './tmon-inav-source.js';

describe('TMONA source parsing', () => {
  it('keeps the published minute and rejects cross-date rows', () => {
    const payload = { candles: { columns: ['open', 'close', 'high', 'low', 'begin'],
      data: [[164, 164.01, 164.01, 164, '2026-07-01 10:00:00']] } };
    expect(parseInavPage(payload, '2026-07-01')[0]?.close).toBe(164.01);
    expect(() => parseInavPage(payload, '2026-07-02')).toThrow();
  });
});

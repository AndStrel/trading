import { describe, expect, it } from 'vitest';
import { siEntryOracleCeilingDay } from './si-entry-oracle-ceiling.js';
import type { SiCandle } from './si-first-hour.js';

const spec = { date: '2026-04-06', contract: 'SiM6' } as const;
const candles: SiCandle[] = Array.from({ length: 421 }, (_, index) => {
  const minute = 10 * 60 + index;
  const hhmm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return { time: `${spec.date} ${hhmm}:00`, open: index < 60 ? 100 : 100.5,
    close: index < 60 ? 100.1 : 100.5, high: index === 200 ? 102 : 101,
    low: index === 300 ? 99 : 100, volume: 1 };
});

describe('Si 11:01 oracle ceiling', () => {
  it('chooses later extremes, not the fixed exit or entry minute', () => {
    const result = siEntryOracleCeilingDay(spec, candles);
    expect(result.status).toBe('complete');
    expect(result.continuation?.exit).toBe(102);
    expect(result.reversal?.exit).toBe(99);
  });
  it('refuses a missing candidate minute', () => {
    expect(siEntryOracleCeilingDay(spec, candles.filter((row) => !row.time.includes('12:30'))).status).toBe('missing');
  });
});

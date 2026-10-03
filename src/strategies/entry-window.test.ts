import { describe, expect, it } from 'vitest';
import { strategyEntryWindow } from './entry-window.js';

describe('shared strategy entry windows', () => {
  it.each(['trend-momentum-v1', 'vwap-reclaim-v1'] as const)('%s ends exclusively at 16:40 Moscow', id => {
    expect(strategyEntryWindow(id, 550, new Date('2026-10-03T13:39:59Z'))).toEqual({
      referenceStartMs: Date.parse('2026-10-03T06:10:00Z'),
      entryStartMs: Date.parse('2026-10-03T06:10:00Z'),
      entryEndMs: Date.parse('2026-10-03T13:40:00Z'),
    });
  });
  it('restricts ORB to reference plus 30 through 150 minutes, never past the common cutoff', () => {
    expect(strategyEntryWindow('opening-range-breakout-v1', 550, new Date('2026-10-03T08:39:59Z'))).toEqual({
      referenceStartMs: Date.parse('2026-10-03T06:10:00Z'),
      entryStartMs: Date.parse('2026-10-03T06:40:00Z'),
      entryEndMs: Date.parse('2026-10-03T08:40:00Z'),
    });
    expect(strategyEntryWindow('opening-range-breakout-v1', 900, new Date('2026-10-03T12:00:00Z'))!.entryEndMs)
      .toBe(Date.parse('2026-10-03T13:40:00Z'));
  });
  it('uses the Moscow date rather than the UTC date', () => {
    expect(strategyEntryWindow('trend-momentum-v1', 550, new Date('2026-10-02T21:30:00Z'))!.referenceStartMs)
      .toBe(Date.parse('2026-10-03T06:10:00Z'));
  });
  it.each([-5, 551, 1000, 1440, NaN, Infinity])('rejects an invalid immutable reference %s', reference => {
    expect(strategyEntryWindow('trend-momentum-v1', reference, new Date('2026-10-03T07:00:00Z'))).toBeNull();
  });
  it('rejects an invalid clock', () => {
    expect(strategyEntryWindow('trend-momentum-v1', 550, new Date(NaN))).toBeNull();
  });
});

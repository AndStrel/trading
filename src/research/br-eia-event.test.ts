import { describe, expect, it } from 'vitest';
import type { SiCandle } from './si-first-hour.js';
import { evaluateBrEiaEvent, summarizeBrEiaEvents } from './br-eia-event.js';

const date = '2025-05-07';
const spec = { date, contract: 'BRK5', signalStartMinute: 1050, releaseEastern: '10:30' };
function candle(minute: number, open = 100, high = open, low = open, close = open): SiCandle {
  return { time: `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`, open, high, low, close, volume: 1 };
}
function path(): SiCandle[] {
  return Array.from({ length: 66 }, (_, offset) => {
    const minute = spec.signalStartMinute + offset;
    if (offset < 5) return candle(minute, 100, 100.2, 99.9, 100.1);
    return candle(minute);
  });
}

describe('BR EIA release reaction', () => {
  it('trades the first post-release five-minute direction and resolves a target', () => {
    const rows = path();
    rows[6] = candle(1056, 100, 102, 100, 101.8);
    const result = evaluateBrEiaEvent(spec, rows);
    expect(result).toMatchObject({ status: 'trade', side: 'long', entry: 100, exitReason: 'target' });
    expect(result.stop).toBeCloseTo(99.2);
    expect(result.target).toBeCloseTo(101.5);
    expect(result.exit).toBeCloseTo(101.5);
  });

  it('gives the stop precedence for same-candle barrier touches and uses the worse gap open', () => {
    const rows = path();
    rows[6] = candle(1056, 99, 102, 98.5, 100);
    expect(evaluateBrEiaEvent(spec, rows)).toMatchObject({ status: 'trade', exitReason: 'stop', exit: 99 });
  });

  it('preserves missing signal, missing entry, and unresolved holding separately', () => {
    const full = path();
    expect(evaluateBrEiaEvent(spec, full.filter((row) => row.time.slice(11, 16) !== '17:32')).status).toBe('missing_signal');
    expect(evaluateBrEiaEvent(spec, full.filter((row) => row.time.slice(11, 16) !== '17:35')).status).toBe('cancelled_entry');
    expect(evaluateBrEiaEvent(spec, full.filter((row) => row.time.slice(11, 16) !== '17:36')).status).toBe('unresolved');
  });

  it('keeps exact-flat event responses in cash and does not count zero-net outcomes as wins', () => {
    const rows = path().map((row, index) => index < 5 ? candle(1050 + index) : row);
    expect(evaluateBrEiaEvent(spec, rows).status).toBe('no_signal');
    expect(summarizeBrEiaEvents([{ ...spec, status: 'trade', baseNet: 0, stressNet: 0, gross: 0 }])).toMatchObject({
      trades: 1, winners: 0, winRate: 0,
    });
  });
});

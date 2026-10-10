import { describe, expect, it } from 'vitest';
import type { DaySpec } from '../research-si-2026-source.js';
import type { SiCandle } from './si-first-hour.js';
import { evaluateSiClearingBreakGapFade, summarizeSiClearingGap } from './si-clearing-break-gap-fade.js';

const spec: DaySpec = { date: '2026-04-06', contract: 'SiM6' };

function candle(time: string, open: number, high = open, low = open, close = open): SiCandle {
  return { time: `${spec.date} ${time}:00`, open, high, low, close, volume: 1 };
}

function session(): SiCandle[] {
  const rows = [candle('13:59', 100, 100, 100, 100), candle('14:05', 101, 101, 101, 101)];
  for (let minute = 14 * 60 + 6; minute <= 16 * 60 + 55; minute += 1) {
    const key = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    rows.push(candle(key, 101));
  }
  return rows;
}

describe('Si post-clearing gap fade', () => {
  it('fades an upward gap from the next-minute open and takes the fixed target', () => {
    const rows = session();
    rows[3] = candle('14:07', 101, 101.1, 99.4, 100);
    expect(evaluateSiClearingBreakGapFade(spec, rows)).toMatchObject({
      status: 'trade', side: 'short', entry: 101, exitReason: 'target', exit: 101 * 0.985,
    });
  });

  it('fades a downward gap and resolves a same-minute stop/target touch as a stop', () => {
    const rows = [candle('13:59', 100), candle('14:05', 99)];
    for (let minute = 14 * 60 + 6; minute <= 16 * 60 + 55; minute += 1) {
      const key = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      rows.push(candle(key, 99));
    }
    rows[2] = candle('14:06', 99, 100.6, 97.4, 99);
    expect(evaluateSiClearingBreakGapFade(spec, rows)).toMatchObject({
      status: 'trade', side: 'long', exitReason: 'stop', exit: 99 * 0.995,
    });
  });

  it('does not require bars after an already-triggered exit, but preserves a later gap as unresolved', () => {
    const rows = session().slice(0, 4);
    rows[3] = candle('14:07', 101, 101.1, 99.4, 100);
    expect(evaluateSiClearingBreakGapFade(spec, rows).status).toBe('trade');
    expect(evaluateSiClearingBreakGapFade(spec, session().filter((row) => row.time.slice(11, 16) !== '14:07')))
      .toMatchObject({ status: 'unresolved_holding' });
  });

  it('reports exact-zero gaps as cash and missing anchors as missing signal', () => {
    expect(evaluateSiClearingBreakGapFade(spec, [candle('13:59', 100), candle('14:05', 100)]))
      .toMatchObject({ status: 'cash', gapReturn: 0 });
    expect(evaluateSiClearingBreakGapFade(spec, [candle('13:59', 100)])).toMatchObject({ status: 'missing_signal' });
  });

  it('counts special sessions separately and uses strict-positive wins', () => {
    const result = evaluateSiClearingBreakGapFade(spec, []);
    expect(summarizeSiClearingGap([{ ...spec, status: 'special_session' }, result])).toMatchObject({
      dates: 2, excludedSpecialSessions: 1, trades: 0,
    });
  });
});

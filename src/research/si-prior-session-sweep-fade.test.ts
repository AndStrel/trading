import { describe, expect, it } from 'vitest';
import type { SiCandle } from './si-first-hour.js';
import { evaluateSiPriorSessionSweepFade } from './si-prior-session-sweep-fade.js';

const date = '2024-08-05';
const spec = { date, contract: 'SiU4', prevHigh: 101, prevLow: 99 };
function candle(minute: number, open = 100, high = open, low = open, close = open): SiCandle {
  const hh = String(Math.floor(minute / 60)).padStart(2, '0');
  const mm = String(minute % 60).padStart(2, '0');
  return { time: `${date} ${hh}:${mm}:00`, open, high, low, close, volume: 1 };
}
function day(signalAt = 610): SiCandle[] {
  const rows: SiCandle[] = [];
  for (let minute = 600; minute <= 1015; minute += 1) {
    if (minute >= 840 && minute <= 844) continue;
    rows.push(candle(minute));
  }
  if (signalAt >= 600 && signalAt <= 930) {
    const index = rows.findIndex((row) => row.time.slice(11, 16) === `${String(Math.floor(signalAt / 60)).padStart(2, '0')}:${String(signalAt % 60).padStart(2, '0')}`);
    rows[index] = candle(signalAt, 100, 102, 100, 100);
  }
  return rows;
}

describe('Si prior-session sweep fade', () => {
  it('fades the first high sweep and counts a 2R target', () => {
    const rows = day();
    rows[11] = candle(611, 100, 100, 100, 100);
    rows[12] = candle(612, 100, 100, 93, 100);
    expect(evaluateSiPriorSessionSweepFade(spec, rows)).toMatchObject({
      status: 'trade', side: 'short', signalTime: `${date} 10:10:00`, entry: 100,
      stop: 103, target: 94, exitReason: 'target', exit: 94,
    });
  });

  it('skips the scheduled clearing break for a 13:59 signal entry', () => {
    const rows = day(839);
    const signalIndex = rows.findIndex((row) => row.time.slice(11, 16) === '13:59');
    rows[signalIndex] = candle(839, 100, 102, 100, 100);
    expect(evaluateSiPriorSessionSweepFade(spec, rows)).toMatchObject({ status: 'trade', signalTime: `${date} 13:59:00` });
  });

  it('marks a same-minute double sweep ambiguous and a pre-signal gap missing', () => {
    const rows = day();
    rows[10] = candle(610, 100, 102, 98, 100);
    expect(evaluateSiPriorSessionSweepFade(spec, rows).status).toBe('ambiguous_signal');
    expect(evaluateSiPriorSessionSweepFade(spec, rows.filter((row) => row.time.slice(11, 16) !== '10:05')).status)
      .toBe('missing_signal');
  });

  it('gives stop precedence when both barriers trade within one minute', () => {
    const rows = day();
    rows[12] = candle(612, 100, 104, 93, 100);
    expect(evaluateSiPriorSessionSweepFade(spec, rows)).toMatchObject({ status: 'trade', exitReason: 'stop', exit: 103 });
  });
});

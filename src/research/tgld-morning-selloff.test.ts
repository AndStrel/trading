import { describe, expect, it } from 'vitest';
import { evaluateTgldMorningSelloff, summarizeTgldMorningSelloff } from './tgld-morning-selloff.js';
import type { SiCandle } from './si-first-hour.js';

const date = '2025-02-03';
function candle(minute: string, open: number, close = open): SiCandle {
  return { time: `${date} ${minute}:00`, open, close, high: Math.max(open, close), low: Math.min(open, close), volume: 1 };
}

describe('TGLD morning selloff', () => {
  it('uses the completed 10:30 signal and subsequent entry, with adverse tick-rounded costs', () => {
    const decision = evaluateTgldMorningSelloff(date, [candle('10:00', 10), candle('10:30', 9.97),
      candle('10:31', 9.96), candle('16:55', 10.04)]);
    expect(decision.status).toBe('trade');
    expect(decision.entryTime).toBe(`${date} 10:31:00`);
    expect(decision.gross).toBeGreaterThan(decision.baseNet!);
    expect(decision.baseNet).toBeGreaterThan(decision.stressNet!);
  });

  it('stays in cash without a qualifying selloff and cancels when the entry print is late', () => {
    expect(evaluateTgldMorningSelloff(date, [candle('10:00', 10), candle('10:30', 9.99)]).status).toBe('cash');
    expect(evaluateTgldMorningSelloff(date, [candle('10:00', 10), candle('10:30', 9.97),
      candle('10:34', 9.96), candle('16:55', 10)]).status).toBe('cancelled_entry');
  });

  it('treats an absent same-day exit as unresolved rather than a win', () => {
    const decision = evaluateTgldMorningSelloff(date, [candle('10:00', 10), candle('10:30', 9.97), candle('10:31', 9.96)]);
    expect(decision.status).toBe('unresolved_exit');
    expect(summarizeTgldMorningSelloff([decision]).trades).toBe(0);
    expect(summarizeTgldMorningSelloff([decision]).unresolvedExit).toBe(1);
  });
});

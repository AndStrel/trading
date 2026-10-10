import { describe, expect, it } from 'vitest';
import { evaluateBrFirstHourReversal } from './br-first-hour-reversal.js';
import type { SiCandle } from './si-first-hour.js';

const date = '2024-04-01';
function candles(signal: 'up' | 'down' = 'up'): SiCandle[] {
  return Array.from({ length: 421 }, (_, index) => {
    const minute = 600 + index;
    const time = `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
    const open = signal === 'up' && index < 60 ? 100 : signal === 'down' && index < 60 ? 101 : 100;
    const close = index === 59 ? signal === 'up' ? 101 : signal === 'down' ? 100 : 100 : open;
    return { time, open, close, high: Math.max(open, close) + 0.1, low: Math.min(open, close) - 0.1, volume: 1 };
  });
}

describe('BR first-hour reversal', () => {
  it('fades a positive first-hour return and records the time exit', () => {
    const result = evaluateBrFirstHourReversal(date, 'BRM4', candles());
    expect(result.status).toBe('trade');
    expect(result.side).toBe('short');
    expect(result.entry).toBe(100);
    expect(result.exitReason).toBe('time');
  });
  it('fades a negative first-hour return', () => {
    expect(evaluateBrFirstHourReversal(date, 'BRM4', candles('down')).side).toBe('long');
  });
  it('treats the clearing break as absent and missing required bars as unresolved', () => {
    const incomplete = candles().filter((c) => !c.time.includes('13:58'));
    expect(evaluateBrFirstHourReversal(date, 'BRM4', incomplete).status).toBe('unresolved_holding');
  });
  it('marks special and official no-session dates without inferring trades', () => {
    expect(evaluateBrFirstHourReversal('2024-04-27', 'BRK4', []).status).toBe('special_session');
    expect(evaluateBrFirstHourReversal('2024-05-01', 'BRM4', []).status).toBe('no_session');
  });
  it('stops first and applies adverse gap execution', () => {
    const bars = candles();
    const i = 62;
    bars[i] = { ...bars[i]!, open: 102, close: 102, high: 102.1, low: 101.9 };
    const result = evaluateBrFirstHourReversal(date, 'BRM4', bars);
    expect(result.exitReason).toBe('stop');
    expect(result.exit).toBe(102);
  });
});

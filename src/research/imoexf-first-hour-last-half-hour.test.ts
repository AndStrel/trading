import { describe, expect, it } from 'vitest';
import {
  isWeekday, parseMoexCandles, scoreTrade, sessionWindows, validateWindow,
  type MoexMinuteCandle,
} from './imoexf-first-hour-last-half-hour.js';

function bars(date: string, start: string, count: number, open: number, close: number): MoexMinuteCandle[] {
  const [hour, minute] = start.split(':').map(Number);
  const first = hour! * 60 + minute!;
  return Array.from({ length: count }, (_, index) => {
    const time = first + index;
    const hh = String(Math.floor(time / 60)).padStart(2, '0');
    const mm = String(time % 60).padStart(2, '0');
    const price = index === count - 1 ? close : open;
    return { open, close: price, high: Math.max(open, price), low: Math.min(open, price), volume: 10,
      begin: `${date} ${hh}:${mm}:00` };
  });
}

describe('IMOEXF first-hour to last-half-hour protocol', () => {
  it('uses fixed MOEX main-session windows across schedule changes', () => {
    expect(sessionWindows('2025-12-01')).toEqual({ signalStart: '10:00', signalEnd: '10:59', exitStart: '18:15', exitEnd: '18:44' });
    expect(sessionWindows('2026-03-23')).toEqual({ signalStart: '10:00', signalEnd: '10:59', exitStart: '18:30', exitEnd: '18:59' });
    expect(sessionWindows('2026-09-14')).toEqual({ signalStart: '09:00', signalEnd: '09:59', exitStart: '18:30', exitEnd: '18:59' });
  });

  it('accepts only complete, ordered, positive-volume tick-grid windows', () => {
    const complete = bars('2026-09-25', '09:00', 60, 100, 101);
    expect(validateWindow(complete, '2026-09-25', '09:00', '09:59')).toBe(true);
    expect(validateWindow(complete.slice(1), '2026-09-25', '09:00', '09:59')).toBe(false);
    expect(validateWindow([{ ...complete[0]!, volume: 0 }, ...complete.slice(1)], '2026-09-25', '09:00', '09:59')).toBe(false);
    expect(validateWindow([{ ...complete[0]!, open: 100.1 }, ...complete.slice(1)], '2026-09-25', '09:00', '09:59')).toBe(false);
  });

  it('parses the documented ISS candle columns without assuming column order', () => {
    const body = JSON.stringify({ candles: {
      columns: ['begin', 'volume', 'open', 'high', 'low', 'close', 'end', 'value'],
      data: [['2026-09-25 09:00:00', 15, 100, 101, 99.5, 100.5, '2026-09-25 09:00:59', 0]],
    } });
    expect(parseMoexCandles(body)).toEqual([{ begin: '2026-09-25 09:00:00', volume: 15, open: 100,
      high: 101, low: 99.5, close: 100.5 }]);
  });

  it('applies adverse ticks in the correct direction and both-side costs', () => {
    const upSignal = bars('2026-09-25', '09:00', 60, 100, 101);
    const downSignal = bars('2026-09-25', '09:00', 60, 100, 99);
    const upExit = bars('2026-09-25', '18:30', 30, 200, 201);
    const downExit = bars('2026-09-25', '18:30', 30, 200, 199);
    const long = scoreTrade(upSignal, upExit, 1);
    expect(long.direction).toBe('long');
    expect(long.entryExecution).toBe(200.5);
    expect(long.exitExecution).toBe(200.5);
    expect(long.netRub).toBeCloseTo(-7.01, 6);
    const short = scoreTrade(downSignal, downExit, 1);
    expect(short.direction).toBe('short');
    expect(short.entryExecution).toBe(199.5);
    expect(short.exitExecution).toBe(199.5);
    expect(short.netRub).toBeCloseTo(-6.99, 6);
  });

  it('does not interpret zero signal as a position and distinguishes weekdays', () => {
    const flat = bars('2026-09-25', '09:00', 60, 100, 100);
    const exit = bars('2026-09-25', '18:30', 30, 100, 100);
    expect(() => scoreTrade(flat, exit, 1)).toThrow('Zero signal');
    expect(isWeekday('2026-09-25')).toBe(true);
    expect(isWeekday('2026-09-26')).toBe(false);
  });
});

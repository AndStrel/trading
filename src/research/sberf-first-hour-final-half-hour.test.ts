import { describe, expect, it } from 'vitest';
import {
  scoreSberfTrade, sberfCostDisclosure, sessionWindows, validateWindow,
  type MoexMinuteCandle,
} from './sberf-first-hour-final-half-hour.js';

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

describe('SBERF first-hour to final-half-hour transfer', () => {
  it('reuses the same preregistered main-session windows', () => {
    expect(sessionWindows('2025-02-14')).toEqual({ signalStart: '10:00', signalEnd: '10:59', exitStart: '18:15', exitEnd: '18:44' });
    expect(sessionWindows('2026-04-02')).toEqual({ signalStart: '10:00', signalEnd: '10:59', exitStart: '18:30', exitEnd: '18:59' });
    expect(sessionWindows('2026-09-14')).toEqual({ signalStart: '09:00', signalEnd: '09:59', exitStart: '18:30', exitEnd: '18:59' });
  });

  it('validates SBERF minute bars on the 0.01 RUB price grid', () => {
    const window = bars('2026-09-25', '09:00', 60, 280.01, 281.02);
    expect(validateWindow(window, '2026-09-25', '09:00', '09:59', 0.01)).toBe(true);
    expect(validateWindow([{ ...window[0]!, open: 280.015 }, ...window.slice(1)], '2026-09-25', '09:00', '09:59', 0.01)).toBe(false);
    expect(validateWindow(window, '2026-09-25', '09:00', '09:59')).toBe(false);
  });

  it('converts one-cent ticks to RUB 1 per contract and charges both sides', () => {
    const signal = bars('2026-09-25', '09:00', 60, 280, 281);
    const exit = bars('2026-09-25', '18:30', 30, 280, 281);
    const trade = scoreSberfTrade(signal, exit, 1);
    expect(trade.direction).toBe('long');
    expect(trade.entryExecution).toBeCloseTo(280.01, 8);
    expect(trade.exitExecution).toBeCloseTo(280.99, 8);
    expect(trade.grossRub).toBeCloseTo(98, 8);
    expect(trade.brokerCommissionRub).toBeCloseTo(56.1, 8);
    expect(trade.exchangeFeeRub).toBeCloseTo(16.76, 8);
    expect(trade.netRub).toBeCloseTo(25.14, 8);
    expect(sberfCostDisclosure()).toEqual({ brokerCommissionRatePerSide: 0.001,
      exchangeFeeRubPerSide: 8.38, lotShares: 100, tickRubPerShare: 0.01, tickValueRubPerContract: 1 });
  });

  it('is adverse for both directions and keeps zero signals in cash', () => {
    const negativeSignal = bars('2026-09-25', '09:00', 60, 280, 279);
    const exit = bars('2026-09-25', '18:30', 30, 280, 279);
    const trade = scoreSberfTrade(negativeSignal, exit, 1);
    expect(trade.direction).toBe('short');
    expect(trade.entryExecution).toBeCloseTo(279.99, 8);
    expect(trade.exitExecution).toBeCloseTo(279.01, 8);
    expect(trade.grossRub).toBeCloseTo(98, 8);
    const flat = bars('2026-09-25', '09:00', 60, 280, 280);
    expect(() => scoreSberfTrade(flat, exit, 1)).toThrow('Zero signal');
  });
});

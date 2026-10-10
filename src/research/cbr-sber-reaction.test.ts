import { describe, expect, it } from 'vitest';
import {
  CBR_DECISION_DATES,
  CBR_WINDOWS,
  cbrSberAdmission,
  cbrWindowMinuteTimes,
  evaluateCbrSberWindow,
  summarizeCbrSberWindows,
  type CbrSberWindow,
} from './cbr-sber-reaction.js';

function windowCandles(date: string, startMinute: number, firstOpen: number, lastClose: number, entry: number, exit: number) {
  const times = cbrWindowMinuteTimes(startMinute);
  const prices = [firstOpen, firstOpen, firstOpen, firstOpen, lastClose, entry, exit];
  return new Map(times.map((time, index) => [`${date} ${time}`, {
    time: `${date} ${time}`, open: prices[index]!, close: index === 4 ? lastClose : prices[index]!,
    high: Math.max(prices[index]!, index === 4 ? lastClose : prices[index]!),
    low: Math.min(prices[index]!, index === 4 ? lastClose : prices[index]!), volume: 100,
  }]));
}

describe('CBR SBER reaction momentum v1', () => {
  it('freezes 94 official dates and two non-overlapping windows per decision date', () => {
    expect(CBR_DECISION_DATES).toHaveLength(94);
    expect(CBR_WINDOWS.map((window) => window.startMinute)).toEqual([810, 900]);
    expect(CBR_DECISION_DATES[0]).toBe('2015-01-30');
    expect(CBR_DECISION_DATES.at(-1)).toBe('2026-09-11');
  });

  it('uses the first five complete minutes for direction, then fixed 30-minute entry/exit', () => {
    const date = '2025-06-06';
    const candles = windowCandles(date, 810, 100, 101, 101, 102);
    const decision = evaluateCbrSberWindow(date, 'rate_release', 810, candles);
    expect(decision.status).toBe('trade');
    expect(decision.side).toBe('long');
    expect(decision.entry).toBe(101);
    expect(decision.exit).toBe(102);
    expect(decision.gross).toBeCloseTo(1 / 101);
    expect(decision.baseNet).toBeGreaterThan(decision.stressNet!);
    expect(summarizeCbrSberWindows([decision]).grossWinRate).toBe(1);
  });

  it('handles falling first reaction as a short and flat reaction as no trade', () => {
    const date = '2025-06-06';
    const short = evaluateCbrSberWindow(date, 'press_conference', 900, windowCandles(date, 900, 100, 99, 99, 98));
    const flat = evaluateCbrSberWindow(date, 'press_conference', 900, windowCandles(date, 900, 100, 100, 100, 101));
    expect(short.side).toBe('short');
    expect(short.gross).toBeCloseTo(1 / 99);
    expect(flat.status).toBe('flat');
    expect(flat.side).toBeUndefined();
  });

  it('marks any absent required signal, entry, or exit candle as unresolved data', () => {
    const date = '2025-06-06';
    const candles = windowCandles(date, 810, 100, 101, 101, 102);
    candles.delete(`${date} 14:05:00`);
    const decision = evaluateCbrSberWindow(date, 'rate_release', 810, candles);
    expect(decision.status).toBe('missing_candles');
    expect(decision.missingTimes).toEqual([`${date} 14:05:00`]);
    expect(decision.side).toBe('long');
    expect(decision.entryAvailable).toBe(true);
    expect(decision.exitAvailable).toBe(false);
  });

  it('requires the full net gate rather than a headline win rate', () => {
    const windows: CbrSberWindow[] = Array.from({ length: 100 }, (_, index) => ({
      date: `2025-${String(Math.floor(Math.floor(index / 2) / 28) + 1).padStart(2, '0')}-${String((Math.floor(index / 2) % 28) + 1).padStart(2, '0')}`,
      kind: index % 2 ? 'press_conference' : 'rate_release', status: 'trade', missingTimes: [], side: 'long',
      gross: 0.02, baseNet: 0.01, stressNet: 0.005,
    }));
    const summary = summarizeCbrSberWindows(windows);
    const passes = cbrSberAdmission({
      all: summary, byYear: { '2025': summary }, byBlock: { '2023-2026': summary },
      coverageByYear: { '2025': 1 }, unresolvedEntered: 0,
    });
    expect(summary.trades).toBe(100);
    expect(summary.dates).toBe(50);
    expect(passes).toBe(true);
    expect(cbrSberAdmission({
      all: { ...summary, meanStressNet: -0.001 }, byYear: { '2025': summary },
      byBlock: { '2023-2026': summary }, coverageByYear: { '2025': 1 }, unresolvedEntered: 0,
    })).toBe(false);
  });
});

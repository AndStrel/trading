import { describe, expect, it } from 'vitest';
import type { SiCandle } from './si-first-hour.js';
import { evaluateTMorningStrengthRisk } from './t-morning-strength-risk.js';

const date = '2024-04-02';
function candle(minute: string, open: number, low = open, high = open): SiCandle {
  return { time: `${date} ${minute}:00`, open, close: open, low, high, volume: 1 };
}
function holding(first: SiCandle): SiCandle[] {
  const candles: SiCandle[] = [candle('10:00', 3000), candle('10:30', 3010), first];
  for (let minute = 632; minute <= 1015; minute += 1) {
    const hh = String(Math.floor(minute / 60)).padStart(2, '0');
    const mm = String(minute % 60).padStart(2, '0');
    candles.push(candle(`${hh}:${mm}`, 3012));
  }
  return candles;
}

describe('T morning strength fixed risk exits', () => {
  it('counts stop before target if both are hit within the entry minute', () => {
    const decision = evaluateTMorningStrengthRisk({ date, ticker: 'TCSG',
      candles: holding(candle('10:31', 3012, 2980, 3070)) });
    expect(decision.status).toBe('trade');
    expect(decision.exitReason).toBe('stop');
    expect(decision.exit).toBeCloseTo(3012 * 0.992);
  });

  it('fills a gap through stop no better than the minute open', () => {
    const candles = holding(candle('10:31', 3012));
    candles[3] = candle('10:32', 2970, 2960, 2980);
    const decision = evaluateTMorningStrengthRisk({ date, ticker: 'TCSG', candles });
    expect(decision.exitReason).toBe('stop');
    expect(decision.exit).toBe(2970);
  });

  it('marks missing holding minutes unresolved before a later time exit', () => {
    const candles = holding(candle('10:31', 3012)).filter((item) => !item.time.endsWith('12:00:00'));
    const decision = evaluateTMorningStrengthRisk({ date, ticker: 'TCSG', candles });
    expect(decision.status).toBe('unresolved_exit');
    expect(decision.reason).toBe('holding_minute_missing');
  });
});

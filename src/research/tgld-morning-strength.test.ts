import { describe, expect, it } from 'vitest';
import type { SiCandle } from './si-first-hour.js';
import { evaluateTgldMorningStrength, summarizeTgldMorningStrength } from './tgld-morning-strength.js';

const date = '2024-02-06';
function candle(minute: string, price: number): SiCandle {
  return { time: `${date} ${minute}:00`, open: price, close: price, high: price, low: price, volume: 1 };
}

describe('TGLD morning strength', () => {
  it('waits for the completed positive 10:30 candle before entering', () => {
    const decision = evaluateTgldMorningStrength(date, [candle('10:00', 10), candle('10:30', 10.03),
      candle('10:31', 10.04), candle('16:55', 10.10)]);
    expect(decision.status).toBe('trade');
    expect(decision.entryTime).toBe(`${date} 10:31:00`);
    expect(decision.gross).toBeGreaterThan(decision.baseNet!);
    expect(decision.baseNet).toBeGreaterThan(decision.stressNet!);
  });

  it('does not fill late and does not count an absent exit as completed', () => {
    expect(evaluateTgldMorningStrength(date, [candle('10:00', 10), candle('10:30', 10.01)]).status).toBe('cash');
    expect(evaluateTgldMorningStrength(date, [candle('10:00', 10), candle('10:30', 10.03),
      candle('10:34', 10.04)]).status).toBe('cancelled_entry');
    const missingExit = evaluateTgldMorningStrength(date, [candle('10:00', 10), candle('10:30', 10.03), candle('10:31', 10.04)]);
    expect(missingExit.status).toBe('unresolved_exit');
    expect(summarizeTgldMorningStrength([missingExit]).trades).toBe(0);
  });
});

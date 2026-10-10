import { describe, expect, it } from 'vitest';
import {
  brWeeklyBreakEvenMove,
  buildBrWeekAnchors,
  evaluateBrWeeklyMomentum,
  isoWeekKey,
  summarizeBrWeeklyMomentum,
  type BrDaySnapshot,
} from './br-weekly-momentum.js';
import type { SiCandle } from './si-first-hour.js';

function candle(date: string, hhmm: string, price: number): SiCandle {
  return {
    time: `${date} ${hhmm}:00`,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  };
}

function day(date: string, contract: string, entry: number, exit: number): BrDaySnapshot {
  return {
    date,
    contract,
    candles: [candle(date, '11:01', entry), candle(date, '16:55', exit)],
  };
}

describe('br weekly momentum', () => {
  it('uses ISO weeks and requires prior move above futures break-even', () => {
    expect(isoWeekKey('2024-01-08')).toBe('2024-W02');
    expect(brWeeklyBreakEvenMove()).toBeGreaterThan(0.003);
    expect(brWeeklyBreakEvenMove()).toBeLessThan(0.004);

    // W02: Mon 8 – Fri 12, up > break-even → long next week
    // W03: Mon 15 – Fri 19, continues up
    const days = [
      day('2024-01-08', 'BRG4', 100, 100),
      day('2024-01-12', 'BRG4', 100, 101),
      day('2024-01-15', 'BRG4', 101, 101),
      day('2024-01-19', 'BRG4', 101, 102),
    ];
    const anchors = buildBrWeekAnchors(days);
    expect(anchors).toHaveLength(2);
    const decisions = evaluateBrWeeklyMomentum(anchors);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.status).toBe('trade');
    expect(decisions[0]?.side).toBe('long');
    expect(decisions[0]?.baseNet).toBeGreaterThan(0);
    const summary = summarizeBrWeeklyMomentum(decisions);
    expect(summary.trades).toBe(1);
    expect(summary.winners).toBe(1);
  });

  it('stays cash when prior week move is inside break-even band', () => {
    const tiny = brWeeklyBreakEvenMove() * 0.5;
    const days = [
      day('2024-01-08', 'BRG4', 100, 100),
      day('2024-01-12', 'BRG4', 100, 100 * (1 + tiny)),
      day('2024-01-15', 'BRG4', 100, 100),
      day('2024-01-19', 'BRG4', 100, 101),
    ];
    const decisions = evaluateBrWeeklyMomentum(buildBrWeekAnchors(days));
    expect(decisions[0]?.status).toBe('cash');
  });

  it('skips weeks that change contract mid-week', () => {
    const days = [
      day('2024-01-08', 'BRG4', 100, 100),
      day('2024-01-12', 'BRH4', 100, 102),
      day('2024-01-15', 'BRH4', 102, 102),
      day('2024-01-19', 'BRH4', 102, 103),
    ];
    expect(buildBrWeekAnchors(days)).toHaveLength(1);
  });
});

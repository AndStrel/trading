import { describe, expect, it } from 'vitest';

import type { HistoricalMinuteCandle } from '../history/market-data-store.js';
import { collectFailedDownsideReclaims } from './orb-failed-downside-reclaim.js';

const instrumentId = 'MOEX:TQBR:SBER';

function candlesForSession(options: { reclaim?: boolean; hitBoth?: boolean } = {}): HistoricalMinuteCandle[] {
  const result: HistoricalMinuteCandle[] = [];
  for (let index = 0; index <= 270; index += 1) {
    const moscowMinute = 10 * 60 + index;
    const utc = new Date(Date.UTC(2026, 0, 20, Math.floor(moscowMinute / 60), moscowMinute % 60) - 180 * 60_000);
    let open = 100;
    let close = 100;
    let high = 100.2;
    let low = 99.9;
    if (index === 30) {
      open = 99.9;
      close = 99.8;
      high = 100;
      low = 99;
    }
    if (index >= 31 && index <= 35) {
      open = 99.8;
      high = 99.9;
      low = 99.7;
      close = 99.8;
    }
    if (index === 32 && options.reclaim) {
      open = 99.8;
      close = 100;
      high = 100.1;
      low = 99.5;
    }
    if (index >= 33) {
      open = 100.4;
      close = 100.5;
      high = 100.7;
      low = 100.2;
    }
    if (!options.reclaim && index >= 31 && index <= 35) {
      open = 99.8;
      close = 99.8;
      high = 99.9;
      low = 99.7;
    }
    if (index === 153 && options.reclaim) {
      open = 101.2;
      close = 101.2;
      high = 101.2;
      low = 101.2;
    }
    if (index === 34 && options.hitBoth) {
      open = 100.4;
      high = 104;
      low = 98;
      close = 100;
    }
    result.push({
      instrumentId,
      time: utc.toISOString(),
      open,
      high,
      low,
      close,
      volume: 100,
    });
  }
  return result;
}

function collect(candles: HistoricalMinuteCandle[]) {
  return collectFailedDownsideReclaims({
    ticker: 'SBER',
    instrumentId,
    candles,
    priceStep: 0.01,
    scheduleForSession: () => ({
      startMinuteMoscow: 10 * 60,
      endMinuteMoscow: 18 * 60 + 55,
      source: 'test-calendar',
    }),
  });
}

describe('collectFailedDownsideReclaims', () => {
  it('detects a close-under then five-minute reclaim and calculates both fee scenarios', () => {
    const report = collect(candlesForSession({ reclaim: true }));
    expect(report.dataQuality).toMatchObject({
      sessionDates: 1,
      completeWindows: 1,
      breakdowns: 1,
      failedBreakdowns: 1,
      reclaimSignals: 1,
      unresolvedExits: 0,
    });
    expect(report.events).toHaveLength(1);
    expect(report.events[0]).toMatchObject({
      openingRangeLow: 99.9,
      breakdownClose: 99.8,
      reclaimClose: 100,
      eligible: { investor: false, traderLike: true },
      exit: {
        investor: { reason: 'time_exit' },
        traderLike: { reason: 'time_exit' },
      },
    });
    expect(report.events[0]!.exit.traderLike.netReturnPct).toBeGreaterThan(0);
  });

  it('does not call a breakdown failed when no close reclaims the range within five bars', () => {
    const report = collect(candlesForSession());
    expect(report.dataQuality).toMatchObject({ breakdowns: 1, failedBreakdowns: 0, reclaimSignals: 0 });
    expect(report.events).toHaveLength(0);
  });

  it('resolves a same-minute stop and target touch conservatively at the stop', () => {
    const report = collect(candlesForSession({ reclaim: true, hitBoth: true }));
    expect(report.events[0]!.exit.investor.reason).toBe('stop');
    expect(report.events[0]!.exit.traderLike.reason).toBe('stop');
  });

  it('rejects a missing minute in the measurement and time-exit window', () => {
    const candles = candlesForSession({ reclaim: true }).filter((_, index) => index !== 200);
    const report = collect(candles);
    expect(report.dataQuality).toMatchObject({ completeWindows: 0, incompleteWindows: 1 });
    expect(report.events).toHaveLength(0);
  });
});

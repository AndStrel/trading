import { describe, expect, it } from 'vitest';

import type { HistoricalMinuteCandle } from './history/market-data-store.js';
import { collectFailedDownsideReclaims } from './research/orb-failed-downside-reclaim.js';
import { getMoexNvtkOrdinaryWeekdaySchedule } from './research/nvtk-failed-break-calendar.js';

const instrumentId = 'MOEX:TQBR:NVTK';

function makeSession(date: string): HistoricalMinuteCandle[] {
  const [year, month, day] = date.split('-').map(Number);
  return Array.from({ length: 271 }, (_, index) => {
    const minute = 10 * 60 + index;
    const time = new Date(Date.UTC(year!, month! - 1, day!, Math.floor(minute / 60), minute % 60) - 180 * 60_000);
    let open = 100;
    let high = 100.2;
    let low = 99.9;
    let close = 100;
    if (index === 30) {
      open = 99.9;
      high = 100;
      low = 99;
      close = 99.8;
    }
    if (index >= 31 && index <= 35) {
      open = 99.8;
      high = 99.9;
      low = 99.7;
      close = 99.8;
    }
    if (index === 32) {
      open = 99.8;
      high = 100.1;
      low = 99.5;
      close = 100;
    }
    if (index >= 33) {
      open = 100.4;
      high = 100.7;
      low = 100.2;
      close = 100.5;
    }
    return { instrumentId, time: time.toISOString(), open, high, low, close, volume: 100 };
  });
}

describe('NVTK failed-break reclaim transfer', () => {
  it('uses the exact transfer signal and rejects special exchange dates', () => {
    const report = collectFailedDownsideReclaims({
      ticker: 'NVTK',
      instrumentId,
      candles: makeSession('2024-03-13'),
      priceStep: 0.1,
      scheduleForSession: ({ sessionDate }) => getMoexNvtkOrdinaryWeekdaySchedule({ sessionDate }),
    });
    expect(report.dataQuality).toMatchObject({ completeWindows: 1, breakdowns: 1, failedBreakdowns: 1, reclaimSignals: 1 });
    expect(report.events).toHaveLength(1);
    expect(
      getMoexNvtkOrdinaryWeekdaySchedule({ sessionDate: '2024-04-29' }),
    ).toBeNull();
    expect(
      getMoexNvtkOrdinaryWeekdaySchedule({ sessionDate: '2025-05-02' }),
    ).toBeNull();
  });

  it('does not calculate events on a rejected weekend session', () => {
    const report = collectFailedDownsideReclaims({
      ticker: 'NVTK',
      instrumentId,
      candles: makeSession('2023-03-11'),
      priceStep: 0.1,
      scheduleForSession: ({ sessionDate }) => getMoexNvtkOrdinaryWeekdaySchedule({ sessionDate }),
    });
    expect(report.dataQuality.calendarRejectedDates).toBe(1);
    expect(report.events).toHaveLength(0);
  });
});

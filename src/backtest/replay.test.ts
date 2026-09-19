import { describe, expect, it } from 'vitest';

import type { HistoricalMinuteCandle } from '../history/market-data-store.js';
import {
  DEFAULT_REPLAY_PARAMETERS,
  replayVwapPullback,
  type ReplayParameters,
} from './replay.js';

const instrument = {
  instrumentId: 'instrument-uid',
  ticker: 'TEST',
  lotSize: 1,
  priceStep: 0.01,
};

function atMoscow(date: string, hour: number, minute: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, hour - 3, minute)).toISOString();
}

function appendFiveMinuteBar(
  target: HistoricalMinuteCandle[],
  date: string,
  hour: number,
  minute: number,
  input: { open: number; high: number; low: number; close: number; volume: number },
): void {
  for (let offset = 0; offset < 5; offset += 1) {
    const isFirst = offset === 0;
    const isLast = offset === 4;
    const open = isFirst ? input.open : input.close;
    const close = isLast ? input.close : input.close;
    target.push({
      instrumentId: instrument.instrumentId,
      time: atMoscow(date, hour + Math.floor((minute + offset) / 60), (minute + offset) % 60),
      open,
      high: offset === 2 ? input.high : Math.max(open, close),
      low: offset === 1 ? input.low : Math.min(open, close),
      close,
      volume: input.volume,
    });
  }
}

function replayParameters(): ReplayParameters {
  return {
    ...DEFAULT_REPLAY_PARAMETERS,
    commissionRate: 0.0005,
    slippageRate: 0.001,
    startingCapitalRub: 100_000,
    maxPositionRub: 50_000,
    maxRiskRub: 500,
    maxConcurrentPositions: 2,
    minAverageCandleTurnoverRub: 1,
    minRelativeVolume: 1,
    minTrendDistance: 0.002,
    minSignalMinuteMoscow: 10 * 60,
    maxSignalMinuteMoscow: 18 * 60,
    forceExitMinuteMoscow: 18 * 60 + 40,
  };
}

function syntheticArchive(): HistoricalMinuteCandle[] {
  const candles: HistoricalMinuteCandle[] = [];
  for (let day = 1; day <= 21; day += 1) {
    const date = `2025-01-${String(day).padStart(2, '0')}`;
    for (let bar = 0; bar < 62; bar += 1) {
      const hour = 10 + Math.floor((bar * 5) / 60);
      const minute = (bar * 5) % 60;
      const base = 100 + day + bar * 0.05;
      const specialPrevious = day === 21 && bar === 49;
      const specialSignal = day === 21 && bar === 50;
      const specialEntry = day === 21 && bar === 51;
      appendFiveMinuteBar(candles, date, hour, minute, {
        open: specialPrevious ? 123 : specialSignal ? 120 : specialEntry ? 124 : base,
        high: specialPrevious ? 123.1 : specialSignal ? 124 : specialEntry ? 134 : base + 0.1,
        low: specialPrevious ? 118 : specialSignal ? 119.9 : specialEntry ? 124 : base - 0.1,
        close: specialPrevious ? 118 : specialSignal ? 123.5 : specialEntry ? 124 : base + 0.05,
        volume: specialSignal ? 1_000 : 100,
      });
    }
  }
  return candles;
}

describe('replayVwapPullback', () => {
  it('enters only at the following minute open and subtracts adverse slippage and both commissions', () => {
    const report = replayVwapPullback({
      instruments: [{ instrument, candles: syntheticArchive() }],
      phases: [
        {
          id: 'out_of_sample',
          label: 'synthetic holdout',
          from: '2025-01-21',
          to: '2025-01-21',
        },
      ],
      parameters: replayParameters(),
    });

    const phase = report.phases[0]!;
    expect(report.parameters).toEqual(replayParameters());
    expect(phase.executedTradeCount).toBe(1);
    const trade = phase.trades[0]!;
    expect(trade.signalAt).toBe('2025-01-21T11:14:00.000Z');
    expect(trade.entryAt).toBe('2025-01-21T11:15:00.000Z');
    expect(trade.entryMarketPrice).toBe(124);
    expect(trade.entryFillPrice).toBeGreaterThan(trade.entryMarketPrice);
    expect(trade.exitFillPrice).toBeLessThanOrEqual(trade.exitMarketPrice);
    expect(trade.totalSlippageRub).toBeGreaterThan(0);
    expect(trade.totalCommissionRub).toBeGreaterThan(0);
    expect(trade.marketPnlRub).toBeGreaterThan(trade.pnlAfterSlippageRub);
    expect(trade.pnlAfterSlippageRub).toBeGreaterThan(trade.netPnlRub);
    expect(trade.exitReason).toBe('target');
  });

  it('fills an intrabar stop crossing at the stop price before adverse slippage', () => {
    const baseline = replayVwapPullback({
      instruments: [{ instrument, candles: syntheticArchive() }],
      phases: [{ id: 'out_of_sample', label: 'synthetic holdout', from: '2025-01-21', to: '2025-01-21' }],
      parameters: replayParameters(),
    });
    const stopPrice = baseline.phases[0]!.trades[0]!.stopPrice;
    const candles = syntheticArchive();
    const crossingIndex = candles.findIndex((candle) => candle.time === '2025-01-21T11:16:00.000Z');
    expect(crossingIndex).toBeGreaterThanOrEqual(0);
    candles[crossingIndex] = {
      ...candles[crossingIndex]!,
      open: stopPrice + 1,
      high: stopPrice + 1,
      low: stopPrice - 10,
      close: stopPrice + 0.5,
    };

    const report = replayVwapPullback({
      instruments: [{ instrument, candles }],
      phases: [{ id: 'out_of_sample', label: 'synthetic holdout', from: '2025-01-21', to: '2025-01-21' }],
      parameters: replayParameters(),
    });
    const trade = report.phases[0]!.trades[0]!;

    expect(trade.exitReason).toBe('stop');
    expect(trade.exitMarketPrice).toBe(stopPrice);
    expect(trade.exitFillPrice).toBeLessThan(stopPrice);
  });

  it('rejects duplicate minute timestamps instead of silently choosing a price', () => {
    const candles = syntheticArchive();
    candles.push({ ...candles[0]! });

    expect(() =>
      replayVwapPullback({
        instruments: [{ instrument, candles }],
        phases: [
          {
            id: 'development',
            label: 'test',
            from: '2025-01-01',
            to: '2025-01-31',
          },
        ],
        parameters: replayParameters(),
      }),
    ).toThrow('duplicated');
  });
});

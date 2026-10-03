import { describe, expect, it } from 'vitest';
import { analyzeCandles } from '../domain/candle-analysis.js';
import { decimalPriceNano } from '../execution/sandbox-stop-state.js';
import { getStrategyDescriptor, isTradingStrategyId, STRATEGY_CATALOG, TRADING_STRATEGY_IDS } from './catalog.js';
import { evaluateTradingSignal, type TradingSignalInput } from './signal-engine.js';

function quote(price: number) {
  const nanoPrice = Math.round(price * 1_000_000_000);
  return { units: String(Math.floor(nanoPrice / 1_000_000_000)), nano: nanoPrice % 1_000_000_000 };
}

function candle(time: number, close = 100, volume = 100, halfRange = 1) {
  return { time: new Date(time).toISOString(), open: quote(close), high: quote(close + halfRange),
    low: quote(close - halfRange), close: quote(close), volume: String(volume), isComplete: true };
}

const start = Date.parse('2026-10-02T06:10:00.000Z'); // 09:10 Moscow, configured reference window.
const fiveMinutes = 5 * 60_000;

function input(candles: ReturnType<typeof candle>[], strategyId: TradingSignalInput['strategyId'] = 'opening-range-breakout-v1',
  overrides: Partial<TradingSignalInput> = {}): TradingSignalInput {
  const payload = { candles };
  const now = new Date(Date.parse(candles.at(-1)!.time) + fiveMinutes);
  return { strategyId, candlesPayload: payload, candleAnalysis: analyzeCandles(payload),
    orderBookPayload: { asks: [{ price: quote(101.01), quantity: '100' }] },
    priceStep: 0.01, commissionRate: 0.0001, slippageRate: 0.0001, sessionStartMinutes: 550, now,
    ...overrides };
}

function breakout() {
  return Array.from({ length: 21 }, (_, index) => candle(start + (index - 14) * fiveMinutes,
    index === 20 ? 102 : 100, index === 20 ? 200 : 100));
}

function reclaim() {
  return Array.from({ length: 21 }, (_, index) => candle(start + index * fiveMinutes,
    index === 19 ? 99 : index === 20 ? 101 : 100, index === 20 ? 200 : 100));
}

describe('strategy catalog', () => {
  it('offers three versioned long strategies and does not assert verified profitability', () => {
    expect(STRATEGY_CATALOG.map(strategy => strategy.id)).toEqual(TRADING_STRATEGY_IDS);
    expect(STRATEGY_CATALOG.every(strategy => strategy.evidence === 'unvalidated')).toBe(true);
    expect(isTradingStrategyId('intraday')).toBe(false);
    expect(isTradingStrategyId(TRADING_STRATEGY_IDS[0])).toBe(true);
    expect(getStrategyDescriptor('vwap-reclaim-v1').version).toBe('1');
  });
});

describe('closed-candle signal integrity', () => {
  it.each(['duplicate', 'unordered', 'future', 'future-end', 'invalid-open', 'fractional-volume', 'missing-completion'])(
    'rejects %s history before proposing an entry', kind => {
      const candles = breakout();
      const values = candles.map(item => ({ ...item }));
      const latest = values.at(-1)!;
      if (kind === 'duplicate') latest.time = values.at(-2)!.time;
      if (kind === 'unordered') values.reverse();
      if (kind === 'future') latest.time = new Date(Date.parse(latest.time) + 2 * fiveMinutes).toISOString();
      if (kind === 'future-end') latest.time = new Date(Date.parse(latest.time) + fiveMinutes).toISOString();
      if (kind === 'invalid-open') latest.open = quote(1000);
      if (kind === 'fractional-volume') latest.volume = '100.5';
      if (kind === 'missing-completion') delete (latest as { isComplete?: boolean }).isComplete;
      const result = evaluateTradingSignal(input(candles, 'opening-range-breakout-v1', { candlesPayload: { candles: values } }));
      expect(result).toMatchObject({ dataValid: false, signal: false, proposal: null });
    });

  it('ignores an explicitly unfinished current candle and uses only the last closed bar', () => {
    const candles = breakout();
    const unfinished = { ...candle(Date.parse(candles.at(-1)!.time) + fiveMinutes, 150, 1000), isComplete: false };
    const result = evaluateTradingSignal(input(candles, 'opening-range-breakout-v1', {
      candlesPayload: { candles: [...candles, unfinished] },
    }));
    expect(result).toMatchObject({ dataValid: true, signal: true });
  });

  it('rejects stale closed candles and a missing bar in the required signal window', () => {
    const candles = breakout();
    expect(evaluateTradingSignal(input(candles, 'opening-range-breakout-v1', {
      now: new Date(Date.parse(candles.at(-1)!.time) + 16 * 60_000),
    })).dataValid).toBe(false);
    candles.splice(17, 1);
    expect(evaluateTradingSignal(input(candles)).dataValid).toBe(false);
  });

  it('does not admit fresh entries at the 16:40 Moscow cutoff', () => {
    const candles = Array.from({ length: 90 }, (_, index) => candle(start + index * fiveMinutes));
    expect(evaluateTradingSignal(input(candles, 'vwap-reclaim-v1'))).toMatchObject({
      dataValid: true, signal: false, proposal: null,
    });
  });
});

describe('opening range breakout', () => {
  it('signals the first close above exactly six reference bars and creates a fixed cost-aware ATR plan', () => {
    const result = evaluateTradingSignal(input(breakout()));
    expect(result).toMatchObject({ strategyId: 'opening-range-breakout-v1', version: '1', dataValid: true, signal: true });
    expect(result.proposal!.stopPrice).toBeLessThan(result.proposal!.entryPrice);
    expect(result.proposal!.targetPrice).toBeGreaterThan(result.proposal!.entryPrice);
    expect(result.reasons[0]).toContain('Первое закрытие');
  });

  it('does not repeat an earlier breakout or signal a range touch without a close above', () => {
    const candles = breakout();
    // An earlier post-range breakout followed by a fresh recross is not the first signal.
    candles.push(candle(start + 7 * fiveMinutes, 100, 100), candle(start + 8 * fiveMinutes, 102, 200));
    const repeat = evaluateTradingSignal(input(candles));
    expect(repeat.signal).toBe(false);
    expect(repeat.reasons).toContain('Первый пробой диапазона уже произошёл');
    const touching = breakout();
    touching[touching.length - 1] = candle(start + 6 * fiveMinutes, 101, 200);
    expect(evaluateTradingSignal(input(touching)).signal).toBe(false);
  });

  it('rejects incomplete reference windows and a reference start supplied from a different hour', () => {
    const candles = breakout();
    const missingFirst = candles.filter(item => Date.parse(item.time) !== start);
    expect(evaluateTradingSignal(input(missingFirst)).dataValid).toBe(false);
    expect(evaluateTradingSignal(input(candles, 'opening-range-breakout-v1', { sessionStartMinutes: 475 })).dataValid).toBe(false);
  });

  it('keeps the fixed ATR target when costs make the setup uneconomic', () => {
    const candles = breakout();
    const lowCosts = evaluateTradingSignal(input(candles));
    const highCosts = evaluateTradingSignal(input(candles, 'opening-range-breakout-v1', { commissionRate: 0.1 }));
    expect(lowCosts.signal).toBe(true);
    expect(highCosts).toMatchObject({ dataValid: true, signal: false, proposal: null });
  });
});

describe('session VWAP reclaim', () => {
  it('signals a fresh upward reclaim with rising VWAP, nonfalling SMA20 and active volume', () => {
    expect(evaluateTradingSignal(input(reclaim(), 'vwap-reclaim-v1'))).toMatchObject({
      dataValid: true, signal: true, strategyId: 'vwap-reclaim-v1',
    });
  });

  it('excludes previous-date candles from the current reference-session VWAP', () => {
    const prior = Array.from({ length: 21 }, (_, index) => candle(start - 24 * 60 * 60_000 + index * fiveMinutes, 10000, 1_000_000));
    const current = reclaim();
    const first = evaluateTradingSignal(input(current, 'vwap-reclaim-v1'));
    const second = evaluateTradingSignal(input([...prior, ...current], 'vwap-reclaim-v1'));
    expect(second).toEqual(first);
  });

  it('requires the whole reference session and volume rather than a precomputed uptrend summary', () => {
    const candles = reclaim();
    const missingStart = candles.slice(1);
    expect(evaluateTradingSignal(input(missingStart, 'vwap-reclaim-v1')).signal).toBe(false);
    candles.at(-1)!.volume = '1';
    expect(evaluateTradingSignal(input(candles, 'vwap-reclaim-v1')).signal).toBe(false);
  });

  it('does not mistake an above-VWAP continuation or a falling SMA20 for a reclaim', () => {
    const above = reclaim();
    above[19] = candle(start + 19 * fiveMinutes, 100.5, 100);
    expect(evaluateTradingSignal(input(above, 'vwap-reclaim-v1')).signal).toBe(false);
    const falling = reclaim();
    falling[0] = candle(start, 110, 100);
    const result = evaluateTradingSignal(input(falling, 'vwap-reclaim-v1'));
    expect(result.signal).toBe(false);
    expect(result.reasons).toContain('SMA20 продолжает снижаться');
  });
});

describe('trend momentum compatibility', () => {
  it('recalculates its signal from validated bars rather than trusting a supplied candle summary', () => {
    const candles = Array.from({ length: 60 }, (_, index) => candle(start + (index - 36) * fiveMinutes,
      100 + index * 0.1, index === 59 ? 200 : 100, 0.2));
    const parameters = input(candles, 'trend-momentum-v1', { orderBookPayload: { asks: [{ price: quote(106.01), quantity: '100' }] } });
    expect(evaluateTradingSignal({ ...parameters, candleAnalysis: { ...parameters.candleAnalysis, trend: 'down' } }).signal).toBe(true);
    const flat = candles.map(item => ({ ...item, open: quote(100), high: quote(100.2), low: quote(99.8), close: quote(100) }));
    expect(evaluateTradingSignal({ ...parameters, candlesPayload: { candles: flat } }).signal).toBe(false);
  });
});

describe('executable exchange tick regression', () => {
  it.each(['trend-momentum-v1', 'vwap-reclaim-v1'] as const)(
    '%s produces only canonical whole-tick prices across realistic asks', strategyId => {
      const candles = strategyId === 'vwap-reclaim-v1' ? reclaim()
        : Array.from({ length: 60 }, (_, index) => candle(start + (index - 36) * fiveMinutes,
          95.09 + index * 0.1, index === 59 ? 200 : 100, 0.2));
      for (let ticks = 10051; ticks <= 10149; ticks++) {
        const ask = ticks / 100;
        const result = evaluateTradingSignal(input(candles, strategyId, {
          orderBookPayload: { asks: [{ price: quote(ask), quantity: '100' }] },
        }));
        expect(result.signal, `ask ${ask}`).toBe(true);
        const proposal = result.proposal!;
        expect(proposal.entryPrice).toBe(ask);
        for (const price of [proposal.entryPrice, proposal.stopPrice, proposal.targetPrice]) {
          expect(BigInt(decimalPriceNano(price)) % 10_000_000n).toBe(0n);
        }
        const cost = proposal.entryPrice * 2 * (0.0001 + 0.0001);
        expect(proposal.stopPrice).toBeLessThan(proposal.entryPrice);
        expect(proposal.targetPrice).toBeGreaterThan(proposal.entryPrice);
        expect((proposal.targetPrice - proposal.entryPrice - cost)
          / (proposal.entryPrice - proposal.stopPrice + cost)).toBeGreaterThanOrEqual(2);
        if (strategyId === 'vwap-reclaim-v1') {
          // This fixture has ATR14 = (13 * 2 + 3) / 14. Tick rounding may
          // reduce the target, never manufacture distance beyond fixed 4 ATR.
          expect(proposal.targetPrice - proposal.entryPrice).toBeLessThanOrEqual(4 * 29 / 14);
        }
      }
    },
  );

  it('supports exact one-nanoruble steps without losing execution precision', () => {
    const result = evaluateTradingSignal(input(reclaim(), 'vwap-reclaim-v1', {
      priceStep: 0.000000001,
      orderBookPayload: { asks: [{ price: quote(101.000000001), quantity: '100' }] },
    }));
    expect(result.signal).toBe(true);
    expect(decimalPriceNano(result.proposal!.entryPrice)).toBe('101000000001');
    for (const price of [result.proposal!.entryPrice, result.proposal!.stopPrice, result.proposal!.targetPrice]) {
      expect(decimalPriceNano(price)).toMatch(/^\d+$/);
    }
  });

  it('blocks sub-nanoruble and binary-noise price steps before proposing a trade', () => {
    for (const priceStep of [0.0000000001, 0.010000000000000002]) {
      expect(evaluateTradingSignal(input(reclaim(), 'vwap-reclaim-v1', { priceStep })))
        .toMatchObject({ dataValid: false, signal: false, proposal: null });
    }
  });
});

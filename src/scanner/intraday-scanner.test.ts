import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { TInvestClient } from '../tbank/client.js';
import { IntradayScanner } from './intraday-scanner.js';

const temporaryDirectories: string[] = [];

function quotation(value: number) {
  return { units: String(Math.trunc(value)), nano: Math.round((value % 1) * 1_000_000_000) };
}

function candles() {
  return {
    candles: Array.from({ length: 60 }, (_, index) => {
      const close = 100 + index * 0.1;
      return {
        open: quotation(close - 0.1),
        high: quotation(close + 0.2),
        low: quotation(close - 0.2),
        close: quotation(close),
        volume: index === 59 ? '200' : '100',
        time: new Date(Date.UTC(2026, 8, 14, 8, index * 5)).toISOString(),
        isComplete: true,
      };
    }),
  };
}

function createJournal() {
  const directory = mkdtempSync(join(tmpdir(), 'andstrel-scanner-'));
  temporaryDirectories.push(directory);
  return new ScenarioJournal(join(directory, 'journal.sqlite'));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('IntradayScanner', () => {
  it('records one candidate from a qualifying long setup and then applies cooldown', async () => {
    const config = loadConfig({
      T_INVEST_TOKEN: 'test-token',
      T_INVEST_INTRADAY_UNIVERSE: 'watchlist',
      T_INVEST_SCANNER_MIN_AVERAGE_CANDLE_TURNOVER_RUB: '1000',
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"sber","lotSize":1,"priceStep":0.01}]',
    });
    const client = {
      getCandles: async () => candles(),
      getOrderBook: async () => ({
        isConsistent: true,
        bids: [{ price: quotation(106), quantity: '1000' }],
        asks: [{ price: quotation(106.01), quantity: '1000' }],
      }),
      getLastPrices: async () => ({ lastPrices: [{ price: quotation(106.01) }] }),
      getTradingStatus: async () => ({
        tradingStatus: 'SECURITY_TRADING_STATUS_NORMAL_TRADING',
        apiTradeAvailable: true,
        limitOrderAvailable: true,
      }),
    } as unknown as TInvestClient;
    const journal = createJournal();
    const scanner = new IntradayScanner(config, client, journal, () => undefined);
    const now = new Date('2026-09-14T13:00:00.000Z');

    const first = await scanner.scanOnce(now);
    const second = await scanner.scanOnce(new Date('2026-09-14T13:05:00.000Z'));

    expect(first[0]).toMatchObject({ status: 'candidate-recorded', instrumentId: 'sber' });
    expect(second[0]).toMatchObject({ status: 'candidate-suppressed', instrumentId: 'sber' });
    expect(journal.list(10, 'intraday')).toHaveLength(1);
    expect(scanner.getLatestReport()).toMatchObject({
      scanned: 1,
      liquid: 1,
      trendUp: 1,
      volumeConfirmed: 1,
      marketCandidates: 1,
      recordedCandidates: 0,
      topRanked: [expect.objectContaining({ ticker: 'sber', candidateReady: true })],
    });
  });
});

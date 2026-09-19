import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { TInvestIntradayUniverseProvider } from './intraday-universe.js';

function quotation(value: number) {
  return { units: String(Math.trunc(value)), nano: Math.round((value % 1) * 1_000_000_000) };
}

describe('TInvestIntradayUniverseProvider', () => {
  it('resolves the configured liquid MOEX tickers from API metadata and caches the result', async () => {
    const config = loadConfig({
      T_INVEST_INTRADAY_UNIVERSE_TICKERS: 'SBER,GAZP,ILLQ',
      T_INVEST_SCANNER_MAX_INSTRUMENTS: '10',
    });
    let requests = 0;
    const provider = new TInvestIntradayUniverseProvider(config, {
      getShares: async () => {
        requests += 1;
        return {
          instruments: [
            {
              uid: 'sber-uid', figi: 'BBG004730N88', ticker: 'SBER', name: 'Сбербанк', classCode: 'TQBR', currency: 'rub',
              lot: 10, minPriceIncrement: quotation(0.01), apiTradeAvailableFlag: true,
              forQualInvestorFlag: false, otcFlag: false, blockedTcaFlag: false,
            },
            {
              uid: 'gazp-uid', ticker: 'GAZP', name: 'Газпром', classCode: 'TQBR', currency: 'RUB',
              lot: 10, minPriceIncrement: quotation(0.01), apiTradeAvailableFlag: true,
              forQualInvestorFlag: false, otcFlag: false, blockedTcaFlag: false,
            },
            {
              uid: 'illq-uid', ticker: 'ILLQ', classCode: 'TQBR', currency: 'RUB', lot: 1,
              minPriceIncrement: quotation(0.01), apiTradeAvailableFlag: true,
              forQualInvestorFlag: false, otcFlag: true,
            },
          ],
        };
      },
    });

    const first = await provider.getSnapshot(new Date('2026-09-19T09:00:00.000Z'));
    const second = await provider.getSnapshot(new Date('2026-09-19T09:05:00.000Z'));

    expect(requests).toBe(1);
    expect(first.instruments).toEqual([
      expect.objectContaining({
        instrumentId: 'sber-uid',
        figi: 'BBG004730N88',
        ticker: 'SBER',
        lotSize: 10,
        priceStep: 0.01,
      }),
      expect.objectContaining({ instrumentId: 'gazp-uid', ticker: 'GAZP', lotSize: 10, priceStep: 0.01 }),
    ]);
    expect(first.missingTickers).toEqual(['ILLQ']);
    expect(second).toBe(first);
  });

  it('resolves explicit watchlist UIDs to FIGIs before importing history', async () => {
    const config = loadConfig({
      T_INVEST_INTRADAY_UNIVERSE: 'watchlist',
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"sber-id","label":"SBER","lotSize":10,"priceStep":0.01}]',
    });
    const provider = new TInvestIntradayUniverseProvider(config, {
      getShares: async () => ({
        instruments: [{ uid: 'sber-id', figi: 'BBG004730N88' }],
      }),
    });

    await expect(provider.getSnapshot(new Date())).resolves.toMatchObject({
      source: 'watchlist',
      instruments: [expect.objectContaining({ instrumentId: 'sber-id', ticker: 'SBER', figi: 'BBG004730N88' })],
    });
  });
});

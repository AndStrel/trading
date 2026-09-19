import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses conservative scenario guardrails by default', () => {
    const config = loadConfig({});

    expect(config.journalPath).toBe('.trading/journal.sqlite');
    expect(config.marketDataPath).toBe('.trading/market-data.sqlite');
    expect(config.historyDataUrl).toBe('https://invest-public-api.tbank.ru/history-data');
    expect(config.scanner.intervalSeconds).toBe(300);
    expect(config.scanner.slippageRate).toBe(0.0005);
    expect(config.scanner.universeMode).toBe('moex-liquid');
    expect(config.scanner.maxInstruments).toBe(30);
    expect(config.scanner.minAverageCandleTurnoverRub).toBe(1_000_000);
    expect(config.scanner.intradayWatchlist).toEqual([]);
    expect(config.telegram).toEqual({ allowedChatIds: [], pollingTimeoutSeconds: 25 });
    expect(config.execution).toEqual({
      mode: 'disabled',
      maxOrdersPerDay: 3,
      maxDailyRiskRub: 1_000,
      candidateMaxAgeMinutes: 10,
      sandboxInitialBalanceRub: 100_000,
    });
    expect(config.backtest).toEqual({ startingCapitalRub: 100_000, maxConcurrentPositions: 2 });
    expect(config.strategies.intraday.maxSpreadPct).toBe(0.3);
    expect(config.strategies.intraday.maxEntryDeviationPct).toBe(0.5);
    expect(config.strategies.intraday.allowShort).toBe(false);
    expect(config.strategies.swing.maxSpreadPct).toBe(0.5);
    expect(config.strategies.swing.maxEntryDeviationPct).toBe(1);
    expect(config.strategies.swing.allowShort).toBe(false);
  });

  it('supports an API-resolved MOEX ticker universe and a legacy explicit watchlist mode', () => {
    const config = loadConfig({
      T_INVEST_INTRADAY_UNIVERSE: 'watchlist',
      T_INVEST_INTRADAY_UNIVERSE_TICKERS: 'sber, gazp, SBER',
      T_INVEST_SCANNER_MAX_INSTRUMENTS: '20',
    });

    expect(config.scanner.universeMode).toBe('watchlist');
    expect(config.scanner.universeTickers).toEqual(['SBER', 'GAZP']);
    expect(config.scanner.maxInstruments).toBe(20);
  });

  it('parses an explicit intraday scanner watchlist', () => {
    const config = loadConfig({
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"e6123145-9665-43e0-8413-cd61b8aa9b13","label":"SBER","lotSize":1,"priceStep":0.01}]',
    });

    expect(config.scanner.intradayWatchlist).toEqual([
      {
        instrumentId: 'e6123145-9665-43e0-8413-cd61b8aa9b13',
        label: 'SBER',
        lotSize: 1,
        priceStep: 0.01,
      },
    ]);
  });

  it('parses the Telegram allowlist without enabling the bot by default', () => {
    const config = loadConfig({
      TELEGRAM_ALLOWED_CHAT_IDS: '123, -456, 123',
      TELEGRAM_BOT_TOKEN: 'bot-token',
    });

    expect(config.telegram).toEqual({
      token: 'bot-token',
      allowedChatIds: ['123', '-456'],
      pollingTimeoutSeconds: 25,
    });
  });

  it('rejects malformed Telegram chat IDs', () => {
    expect(() => loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: 'not-a-chat-id' })).toThrow(
      'TELEGRAM_ALLOWED_CHAT_IDS',
    );
  });

  it('requires an HTTPS history archive endpoint', () => {
    expect(() => loadConfig({ T_INVEST_HISTORY_DATA_URL: 'http://example.test/history-data' })).toThrow(
      'T_INVEST_HISTORY_DATA_URL',
    );
  });

  it('requires an explicit configuration value to enable short scenarios', () => {
    const config = loadConfig({
      INTRADAY_ALLOW_SHORT: 'true',
      SWING_ALLOW_SHORT: 'false',
    });

    expect(config.strategies.intraday.allowShort).toBe(true);
    expect(config.strategies.swing.allowShort).toBe(false);
  });

  it('keeps sandbox credentials separate from the read-only client', () => {
    const config = loadConfig({
      T_INVEST_TOKEN: 'read-token',
      T_INVEST_EXECUTION_MODE: 'sandbox',
      T_INVEST_TRADING_TOKEN: 'trade-token',
      T_INVEST_SANDBOX_ACCOUNT_ID: 'sandbox-account',
      T_INVEST_EXECUTION_MAX_ORDERS_PER_DAY: '2',
      T_INVEST_EXECUTION_MAX_DAILY_RISK_RUB: '750',
    });

    expect(config.token).toBe('read-token');
    expect(config.execution).toEqual({
      mode: 'sandbox',
      token: 'trade-token',
      accountId: 'sandbox-account',
      maxOrdersPerDay: 2,
      maxDailyRiskRub: 750,
      candidateMaxAgeMinutes: 10,
      sandboxInitialBalanceRub: 100_000,
    });
  });
});

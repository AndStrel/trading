import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('keeps target exit opt-in and refuses a target protocol without every sandbox guard',()=>{
    const enabled={T_INVEST_SANDBOX_TARGET_EXIT_ENABLED:'true',T_INVEST_SANDBOX_PROTECTION_ENABLED:'true',
      T_INVEST_SANDBOX_LOSS_GUARD_ENABLED:'true',T_INVEST_SANDBOX_SESSION_CLOSE_ENABLED:'true'};
    expect(loadConfig(enabled).execution).toMatchObject({mode:'disabled',sandboxTargetExitEnabled:true});
    for(const key of ['T_INVEST_SANDBOX_PROTECTION_ENABLED','T_INVEST_SANDBOX_LOSS_GUARD_ENABLED','T_INVEST_SANDBOX_SESSION_CLOSE_ENABLED','T_INVEST_LIVE_PILOT_PREPARE']) {
      expect(()=>loadConfig({...enabled,[key]:'false'})).toThrow('requires');
    }
    expect(()=>loadConfig({T_INVEST_SANDBOX_TARGET_EXIT_ENABLED:'1'})).toThrow();
    expect(()=>loadConfig({...enabled,T_INVEST_EXECUTION_MODE:'live'})).toThrow();
  });
  it('selects a versioned algorithm and a five-minute MSK reference separately from account horizons',()=>{
    const config=loadConfig({T_INVEST_TRADING_STRATEGY_ID:'vwap-reclaim-v1',T_INVEST_STRATEGY_SESSION_START:'10:00'});
    expect(config.scanner.tradingStrategyId).toBe('vwap-reclaim-v1');expect(config.scanner.sessionStartMinutes).toBe(600);
    expect(config.strategies.intraday).toBeDefined();expect(config.strategies.swing).toBeDefined();
    expect(()=>loadConfig({T_INVEST_TRADING_STRATEGY_ID:'profit-guaranteed'})).toThrow();
    expect(()=>loadConfig({T_INVEST_STRATEGY_SESSION_START:'09:11'})).toThrow();
  });
  it('requires private UID watchlists to carry an exchange ticker label for strategy selection',()=>{
    expect(()=>loadConfig({T_INVEST_INTRADAY_UNIVERSE:'watchlist',T_INVEST_INTRADAY_WATCHLIST:'[{"instrumentId":"private-uid","lotSize":1,"priceStep":0.01}]'})).toThrow('ticker label');
    // Existing manual execution metadata outside watchlist scanning remains compatible.
    expect(loadConfig({T_INVEST_INTRADAY_WATCHLIST:'[{"instrumentId":"private-uid","lotSize":1,"priceStep":0.01}]'}).scanner.intradayWatchlist).toHaveLength(1);
  });
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
    expect(config.telegram).toEqual({ allowedChatIds: [], pollingTimeoutSeconds: 25, miniApp: { enabled: false, host: '127.0.0.1', port: 8080 } });
    expect(config.execution).toEqual({
      mode: 'disabled',
      baseUrl: 'https://sandbox-invest-public-api.tbank.ru/rest',
      maxOrdersPerDay: 3,
      maxDailyRiskRub: 60,
      candidateMaxAgeMinutes: 10,
      sandboxInitialBalanceRub: 1_000,
      sandboxProtectionEnabled: false,
      sandboxLossGuardEnabled: false,
      sandboxSessionCloseEnabled: false,
      sandboxTargetExitEnabled: false,
    });
    expect(config.backtest).toEqual({ startingCapitalRub: 100_000, maxConcurrentPositions: 2 });
    expect(config.strategies.intraday.maxSpreadPct).toBe(0.3);
    expect(config.strategies.intraday.maxEntryDeviationPct).toBe(0.5);
    expect(config.strategies.intraday.allowShort).toBe(false);
    expect(config.commissionRate).toBe(0.003);
    expect(config.strategies.intraday.maxRiskRub).toBe(20);
    expect(config.strategies.intraday.maxPositionRub).toBeLessThan(1_000);
    expect(config.livePilot).toEqual({ prepare: true, capitalRub: 1_000, maxTradeRiskRub: 20, maxDailyRiskRub: 60, maxDailyLossRub: 60 });
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
      miniApp: { enabled: false, host: '127.0.0.1', port: 8080 },
    });
  });

  it('rejects malformed Telegram chat IDs', () => {
    expect(() => loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: 'not-a-chat-id' })).toThrow(
      'TELEGRAM_ALLOWED_CHAT_IDS',
    );
  });

  it('requires an explicit public HTTPS origin and bot token before enabling the Mini App', () => {
    expect(() => loadConfig({ TELEGRAM_MINI_APP_ENABLED: 'true' })).toThrow('requires');
    for (const url of ['http://bot.brewnote.net', 'https://user:password@bot.brewnote.net', 'https://bot.brewnote.net/path', 'https://bot.brewnote.net?token=x', 'https://bot.brewnote.net#secret', 'https://127.0.0.1', 'https://bot.brewnote.net:8080']) {
      expect(() => loadConfig({ TELEGRAM_MINI_APP_URL: url })).toThrow('HTTPS origin');
    }
    expect(loadConfig({ TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_MINI_APP_ENABLED: 'true', TELEGRAM_MINI_APP_URL: 'https://bot.brewnote.net/' }).telegram.miniApp)
      .toEqual({ enabled: true, host: '127.0.0.1', port: 8080, url: 'https://bot.brewnote.net' });
  });

  it('requires an HTTPS history archive endpoint', () => {
    expect(() => loadConfig({ T_INVEST_HISTORY_DATA_URL: 'http://example.test/history-data' })).toThrow(
      'T_INVEST_HISTORY_DATA_URL',
    );
  });

  it('requires an explicit configuration value to enable short scenarios', () => {
    const config = loadConfig({
      T_INVEST_LIVE_PILOT_PREPARE: 'false',
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
      baseUrl: 'https://sandbox-invest-public-api.tbank.ru/rest',
      token: 'trade-token',
      sandboxProtectionEnabled: false,
      sandboxLossGuardEnabled: false,
      sandboxSessionCloseEnabled: false,
      sandboxTargetExitEnabled: false,
      accountId: 'sandbox-account',
      maxOrdersPerDay: 2,
      maxDailyRiskRub: 60,
      candidateMaxAgeMinutes: 10,
      sandboxInitialBalanceRub: 1_000,
    });
  });

  it('preserves the legacy sandbox role without guessing production intent from a token name', () => {
    const config = loadConfig({ T_INVEST_TRADING_TOKEN: 'legacy-sandbox-token' });
    expect(config.execution.token).toBe('legacy-sandbox-token');
    expect(config.livePilot.token).toBeUndefined();
    expect(config.execution.mode).toBe('disabled');
  });

  it('uses an explicitly selected live trading token only for production preflight', () => {
    const config = loadConfig({
      T_INVEST_TOKEN: 'read-token',
      T_INVEST_TRADING_TOKEN: 'production-token',
      T_INVEST_TRADING_TOKEN_ROLE: 'live',
    });
    expect(config.token).toBe('read-token');
    expect(config.livePilot.token).toBe('production-token');
    expect(config.execution.token).toBeUndefined();
    expect(config.execution.mode).toBe('disabled');
    expect(config.execution.baseUrl).toBe('https://sandbox-invest-public-api.tbank.ru/rest');
    expect(() => loadConfig({ T_INVEST_EXECUTION_MODE: 'live' })).toThrow();
  });

  it('sends live orders only with a separate production token and account', () => {
    const config = loadConfig({
      T_INVEST_TOKEN: 'read-token',
      T_INVEST_SANDBOX_TOKEN: 'sandbox-token',
      T_INVEST_LIVE_TOKEN: 'production-token',
      T_INVEST_LIVE_ACCOUNT_ID: 'daily-account',
      T_INVEST_EXECUTION_MODE: 'live',
    });
    expect(config.execution.mode).toBe('live');
    expect(config.execution.token).toBe('production-token');
    expect(config.execution.accountId).toBe('daily-account');
    expect(config.execution.baseUrl).toBe('https://invest-public-api.tbank.ru/rest');
    expect(config.token).toBe('read-token');
    expect(() => loadConfig({
      T_INVEST_TOKEN: 'read-token', T_INVEST_LIVE_TOKEN: 'production-token', T_INVEST_EXECUTION_MODE: 'live',
    })).toThrow(/account/);
  });

  it('resolves three isolated credential roles using the dedicated sandbox field', () => {
    const config = loadConfig({
      T_INVEST_TOKEN: 'read-token',
      T_INVEST_TRADING_TOKEN: 'production-token',
      T_INVEST_TRADING_TOKEN_ROLE: 'live',
      T_INVEST_SANDBOX_TOKEN: 'sandbox-token',
    });
    expect(config.token).toBe('read-token');
    expect(config.livePilot.token).toBe('production-token');
    expect(config.execution.token).toBe('sandbox-token');
  });

  it('supports canonical credentials without a trading alias', () => {
    const config = loadConfig({ T_INVEST_SANDBOX_TOKEN: 'sandbox-token', T_INVEST_LIVE_TOKEN: 'production-token' });
    expect(config.execution.token).toBe('sandbox-token');
    expect(config.livePilot.token).toBe('production-token');
  });

  it.each(['sandbox', 'live'] as const)('accepts identical trimmed aliases for the same %s role', role => {
    const config = loadConfig({
      T_INVEST_TRADING_TOKEN_ROLE: role,
      T_INVEST_TRADING_TOKEN: ' same-role-token ',
      [role === 'sandbox' ? 'T_INVEST_SANDBOX_TOKEN' : 'T_INVEST_LIVE_TOKEN']: 'same-role-token',
    });
    expect(role === 'sandbox' ? config.execution.token : config.livePilot.token).toBe('same-role-token');
    expect(role === 'sandbox' ? config.livePilot.token : config.execution.token).toBeUndefined();
  });

  it.each(['sandbox', 'live'] as const)('rejects conflicting %s aliases without disclosing either value', role => {
    let error: unknown;
    try {
      loadConfig({
        T_INVEST_TRADING_TOKEN_ROLE: role,
        T_INVEST_TRADING_TOKEN: 'first-private-token',
        [role === 'sandbox' ? 'T_INVEST_SANDBOX_TOKEN' : 'T_INVEST_LIVE_TOKEN']: 'second-private-token',
      });
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(`Conflicting ${role} credential aliases`);
    expect(String(error)).not.toContain('first-private-token');
    expect(String(error)).not.toContain('second-private-token');
  });

  it.each([
    { T_INVEST_TOKEN: 'same-token', T_INVEST_SANDBOX_TOKEN: 'same-token' },
    { T_INVEST_TOKEN: 'same-token', T_INVEST_TRADING_TOKEN: 'same-token' },
    { T_INVEST_TOKEN: 'same-token', T_INVEST_LIVE_TOKEN: 'same-token' },
    { T_INVEST_TOKEN: 'same-token', T_INVEST_TRADING_TOKEN: 'same-token', T_INVEST_TRADING_TOKEN_ROLE: 'live' },
    { T_INVEST_SANDBOX_TOKEN: 'same-token', T_INVEST_LIVE_TOKEN: 'same-token' },
    { T_INVEST_SANDBOX_TOKEN: 'same-token', T_INVEST_TRADING_TOKEN: 'same-token', T_INVEST_TRADING_TOKEN_ROLE: 'live' },
  ])('rejects credentials shared by resolved roles in %j', env => {
    expect(() => loadConfig(env)).toThrow('tokens must be separate');
  });

  it('does not fall back from an absent role credential to the read-only token', () => {
    const config = loadConfig({
      T_INVEST_TOKEN: 'read-token', T_INVEST_TRADING_TOKEN_ROLE: 'live',
      T_INVEST_TRADING_TOKEN: ' ', T_INVEST_SANDBOX_TOKEN: '', T_INVEST_LIVE_TOKEN: ' ',
    });
    expect(config.token).toBe('read-token');
    expect(config.execution.token).toBeUndefined();
    expect(config.livePilot.token).toBeUndefined();
  });

  it('rejects an unknown trading token role', () => {
    expect(() => loadConfig({ T_INVEST_TRADING_TOKEN_ROLE: 'automatic' })).toThrow('T_INVEST_TRADING_TOKEN_ROLE');
  });

  it('pins sandbox separately from production or overridden read-only market endpoints', () => {
    const production = loadConfig({});
    expect(production.baseUrl).toBe('https://invest-public-api.tbank.ru/rest');
    expect(production.execution.baseUrl).toBe('https://sandbox-invest-public-api.tbank.ru/rest');
    const custom = loadConfig({ T_INVEST_BASE_URL: 'https://market-data.example.test/rest/' });
    expect(custom.baseUrl).toBe('https://market-data.example.test/rest');
    expect(custom.execution.baseUrl).toBe(production.execution.baseUrl);
  });

  it('does not allow stale environment settings to relax the approved pilot limits', () => {
    const config = loadConfig({ T_INVEST_COMMISSION_RATE: '0.0005', INTRADAY_MAX_RISK_RUB: '500', INTRADAY_MAX_POSITION_RUB: '50000', INTRADAY_ALLOW_SHORT: 'true' });
    expect(config.commissionRate).toBe(0.003);
    expect(config.strategies.intraday.maxRiskRub).toBe(20);
    expect(config.strategies.intraday.maxPositionRub).toBeLessThan(1_000);
    expect(config.strategies.intraday.allowShort).toBe(false);
  });

  it('sizes a 500 RUB live pilot without changing its separately prepared sandbox baseline', () => {
    const config = loadConfig({
      T_INVEST_LIVE_CAPITAL_RUB: '500', T_INVEST_COMMISSION_RATE: '0.0005',
      INTRADAY_MAX_RISK_RUB: '500', INTRADAY_MAX_POSITION_RUB: '50000', INTRADAY_ALLOW_SHORT: 'true',
      T_INVEST_EXECUTION_MAX_DAILY_RISK_RUB: '1000',
    });
    expect(config.livePilot.capitalRub).toBe(500);
    expect(config.execution.sandboxInitialBalanceRub).toBe(1_000);
    expect(config.commissionRate).toBe(0.003);
    expect(config.strategies.intraday.maxPositionRub).toBe(498.25);
    expect(config.strategies.intraday.maxRiskRub).toBe(20);
    expect(config.execution.maxDailyRiskRub).toBe(60);
    expect(config.strategies.intraday.allowShort).toBe(false);
  });

  it.each([
    { raw: '300', expected: 300 },
    { raw: '1000', expected: 1_000 },
    { raw: '2500', expected: 1_000 },
  ])('keeps explicit sandbox balance $raw independent of live capital during preparation', ({ raw, expected }) => {
    expect(loadConfig({ T_INVEST_LIVE_CAPITAL_RUB: '500', T_INVEST_SANDBOX_INITIAL_BALANCE_RUB: raw })
      .execution.sandboxInitialBalanceRub).toBe(expected);
  });

  it('preserves the raw default and explicit sandbox balances outside pilot preparation', () => {
    expect(loadConfig({ T_INVEST_LIVE_PILOT_PREPARE: 'false', T_INVEST_LIVE_CAPITAL_RUB: '500' })
      .execution.sandboxInitialBalanceRub).toBe(100_000);
    expect(loadConfig({ T_INVEST_LIVE_PILOT_PREPARE: 'false', T_INVEST_LIVE_CAPITAL_RUB: '500',
      T_INVEST_SANDBOX_INITIAL_BALANCE_RUB: '2500' }).execution.sandboxInitialBalanceRub).toBe(2_500);
  });

  it('retains tighter explicitly configured risk and position budgets', () => {
    const config = loadConfig({
      T_INVEST_LIVE_CAPITAL_RUB: '500', T_INVEST_LIVE_MAX_TRADE_RISK_RUB: '10',
      T_INVEST_LIVE_MAX_DAILY_RISK_RUB: '30', T_INVEST_LIVE_MAX_DAILY_LOSS_RUB: '30',
      INTRADAY_MAX_RISK_RUB: '5', INTRADAY_MAX_POSITION_RUB: '100',
      T_INVEST_EXECUTION_MAX_DAILY_RISK_RUB: '20',
    });
    expect(config.strategies.intraday.maxRiskRub).toBe(5);
    expect(config.strategies.intraday.maxPositionRub).toBe(100);
    expect(config.execution.maxDailyRiskRub).toBe(20);
    expect(config.livePilot.maxDailyRiskRub).toBe(30);
    expect(config.livePilot.maxDailyLossRub).toBe(30);
    expect(config.execution.sandboxInitialBalanceRub).toBe(1_000);
  });

  it.each(['T_INVEST_LIVE_CAPITAL_RUB', 'T_INVEST_LIVE_MAX_TRADE_RISK_RUB', 'T_INVEST_LIVE_MAX_DAILY_RISK_RUB', 'T_INVEST_LIVE_MAX_DAILY_LOSS_RUB'])('rejects unauthorized expansion of %s', key => {
    expect(() => loadConfig({ [key]: '1001' })).toThrow();
  });

  it('rejects reused tokens and the weekly account for the daily live pilot', () => {
    expect(() => loadConfig({ T_INVEST_TOKEN: 'secret', T_INVEST_LIVE_TOKEN: 'secret' })).toThrow('tokens must be separate');
    expect(() => loadConfig({ T_INVEST_TRADING_TOKEN: 'secret', T_INVEST_LIVE_TOKEN: 'secret' })).toThrow('tokens must be separate');
    expect(() => loadConfig({ T_INVEST_SWING_ACCOUNT_ID: 'weekly', T_INVEST_LIVE_ACCOUNT_ID: 'weekly' })).toThrow('weekly or sandbox');
    expect(() => loadConfig({ T_INVEST_EXECUTION_MODE: 'live' })).toThrow();
  });
});

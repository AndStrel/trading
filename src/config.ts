import { z } from 'zod/v4';

import type { TInvestTransport } from './tbank/client.js';
import { pilotPositionBudget } from './execution/live-pilot-risk.js';
import { TRADING_STRATEGY_IDS, type TradingStrategyId } from './strategies/catalog.js';

export type Strategy = 'intraday' | 'swing';
export type ExecutionMode = 'disabled' | 'sandbox';
export type IntradayUniverseMode = 'moex-liquid' | 'watchlist';

export type IntradayWatchlistItem = {
  instrumentId: string;
  label?: string | undefined;
  lotSize: number;
  priceStep: number;
};

export type ScannerConfig = {
  tradingStrategyId: TradingStrategyId;
  sessionStartMinutes: number;
  intervalSeconds: number;
  lookbackMinutes: number;
  candidateCooldownMinutes: number;
  slippageRate: number;
  universeMode: IntradayUniverseMode;
  universeTickers: string[];
  universeRefreshMinutes: number;
  maxInstruments: number;
  maxConcurrentRequests: number;
  minAverageCandleTurnoverRub: number;
  maxCandidatesPerScan: number;
  intradayWatchlist: IntradayWatchlistItem[];
};

export type TelegramConfig = {
  token?: string;
  allowedChatIds: string[];
  pollingTimeoutSeconds: number;
  miniApp: { enabled: boolean; url?: string; host: string; port: number };
};

export type ExecutionConfig = {
  mode: ExecutionMode;
  baseUrl: string;
  token?: string;
  accountId?: string;
  maxOrdersPerDay: number;
  maxDailyRiskRub: number;
  candidateMaxAgeMinutes: number;
  sandboxInitialBalanceRub: number;
  sandboxProtectionEnabled: boolean;
  sandboxLossGuardEnabled: boolean;
  sandboxSessionCloseEnabled: boolean;
};

export type BacktestConfig = {
  startingCapitalRub: number;
  maxConcurrentPositions: number;
};

// Preparation only: this profile never enables live order submission.
export type LivePilotConfig = {
  prepare: boolean;
  token?: string;
  accountId?: string;
  capitalRub: number;
  maxTradeRiskRub: number;
  maxDailyRiskRub: number;
  maxDailyLossRub: number;
};

export type StrategyLimits = {
  accountId?: string;
  maxRiskRub: number;
  maxPositionRub: number;
  maxSpreadPct: number;
  maxEntryDeviationPct: number;
  allowShort: boolean;
};

export type AppConfig = {
  token?: string;
  baseUrl: string;
  historyDataUrl: string;
  transport: TInvestTransport;
  commissionRate: number;
  journalPath: string;
  marketDataPath: string;
  scanner: ScannerConfig;
  telegram: TelegramConfig;
  execution: ExecutionConfig;
  livePilot: LivePilotConfig;
  backtest: BacktestConfig;
  strategies: Record<Strategy, StrategyLimits>;
};

const optionalNonEmpty = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() || undefined : value),
  z.string().min(1).optional(),
);

function resolveCredentialAliases(
  role: 'sandbox' | 'live',
  canonical: string | undefined,
  alias: string | undefined,
): string | undefined {
  if (canonical && alias && canonical !== alias) {
    // Never include credential values in configuration diagnostics.
    throw new Error(`Conflicting ${role} credential aliases`);
  }
  return canonical ?? alias;
}

const intradayWatchlistItemSchema = z.object({
  instrumentId: z.string().trim().min(1).max(256),
  label: z.string().trim().min(1).max(64).optional(),
  lotSize: z.coerce.number().int().positive(),
  priceStep: z.coerce.number().positive(),
});

function parseIntradayWatchlist(raw: string): IntradayWatchlistItem[] {
  try {
    return z.array(intradayWatchlistItemSchema).max(30).parse(JSON.parse(raw));
  } catch {
    throw new Error(
      'T_INVEST_INTRADAY_WATCHLIST must be a JSON array of instrumentId, optional label, lotSize and priceStep values',
    );
  }
}

function parseUniverseTickers(raw: string): string[] {
  const tickers = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  if (tickers.some((ticker) => !/^[A-Z0-9.-]{1,16}$/.test(ticker))) {
    throw new Error(
      'T_INVEST_INTRADAY_UNIVERSE_TICKERS must be a comma-separated list of exchange tickers',
    );
  }

  return [...new Set(tickers)].slice(0, 60);
}

function parseTelegramAllowedChatIds(raw: string): string[] {
  const chatIds = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (chatIds.some((chatId) => !/^-?\d+$/.test(chatId))) {
    throw new Error('TELEGRAM_ALLOWED_CHAT_IDS must be a comma-separated list of numeric Telegram chat IDs');
  }

  return [...new Set(chatIds)].slice(0, 10);
}

const envSchema = z.object({
  T_INVEST_TOKEN: optionalNonEmpty,
  T_INVEST_BASE_URL: z.string().url().default('https://invest-public-api.tbank.ru/rest'),
  T_INVEST_HISTORY_DATA_URL: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === 'https:', 'T_INVEST_HISTORY_DATA_URL must use HTTPS')
    .default('https://invest-public-api.tbank.ru/history-data'),
  T_INVEST_TRANSPORT: z.enum(['fetch', 'system-curl']).default('fetch'),
  T_INVEST_COMMISSION_RATE: z.coerce.number().min(0).max(0.1).default(0.003),
  T_INVEST_JOURNAL_PATH: z.string().trim().min(1).default('.trading/journal.sqlite'),
  T_INVEST_MARKET_DATA_PATH: z.string().trim().min(1).default('.trading/market-data.sqlite'),
  T_INVEST_INTRADAY_WATCHLIST: z.string().default('[]'),
  T_INVEST_INTRADAY_UNIVERSE: z.enum(['moex-liquid', 'watchlist']).default('moex-liquid'),
  T_INVEST_INTRADAY_UNIVERSE_TICKERS: z.string().default(''),
  T_INVEST_TRADING_STRATEGY_ID: z.enum(TRADING_STRATEGY_IDS).default('trend-momentum-v1'),
  T_INVEST_STRATEGY_SESSION_START: z.string().regex(/^(0[6-9]|1[0-5]):(00|05|10|15|20|25|30|35|40|45|50|55)$/).default('09:10'),
  T_INVEST_SCANNER_UNIVERSE_REFRESH_MINUTES: z.coerce.number().int().min(60).max(10_080).default(1_440),
  T_INVEST_SCANNER_MAX_INSTRUMENTS: z.coerce.number().int().min(5).max(40).default(30),
  T_INVEST_SCANNER_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(5).default(2),
  T_INVEST_SCANNER_MIN_AVERAGE_CANDLE_TURNOVER_RUB: z.coerce.number()
    .positive()
    .max(100_000_000)
    .default(1_000_000),
  T_INVEST_SCANNER_MAX_CANDIDATES_PER_SCAN: z.coerce.number().int().min(1).max(5).default(3),
  T_INVEST_SCANNER_INTERVAL_SECONDS: z.coerce.number().int().min(300).max(3_600).default(300),
  T_INVEST_SCANNER_LOOKBACK_MINUTES: z.coerce.number().int().min(300).max(720).default(360),
  T_INVEST_SCANNER_CANDIDATE_COOLDOWN_MINUTES: z.coerce.number().int().min(5).max(1_440).default(30),
  T_INVEST_SCANNER_SLIPPAGE_RATE: z.coerce.number().min(0).max(0.02).default(0.0005),
  TELEGRAM_BOT_TOKEN: optionalNonEmpty,
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().default(''),
  TELEGRAM_POLLING_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(50).default(25),
  TELEGRAM_MINI_APP_ENABLED: z.enum(['true', 'false']).default('false'),
  TELEGRAM_MINI_APP_URL: optionalNonEmpty,
  TELEGRAM_MINI_APP_HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  TELEGRAM_MINI_APP_PORT: z.coerce.number().int().min(1024).max(65535).default(8080),
  T_INVEST_EXECUTION_MODE: z.enum(['disabled', 'sandbox']).default('disabled'),
  T_INVEST_TRADING_TOKEN: optionalNonEmpty,
  // Preserve the legacy sandbox role unless migration is explicitly selected.
  T_INVEST_TRADING_TOKEN_ROLE: z.enum(['sandbox', 'live']).default('sandbox'),
  T_INVEST_SANDBOX_TOKEN: optionalNonEmpty,
  T_INVEST_SANDBOX_ACCOUNT_ID: optionalNonEmpty,
  T_INVEST_SANDBOX_PROTECTION_ENABLED: z.enum(['true', 'false']).default('false'),
  T_INVEST_SANDBOX_LOSS_GUARD_ENABLED: z.enum(['true', 'false']).default('false'),
  T_INVEST_SANDBOX_SESSION_CLOSE_ENABLED: z.enum(['true', 'false']).default('false'),
  T_INVEST_EXECUTION_MAX_ORDERS_PER_DAY: z.coerce.number().int().min(1).max(20).default(3),
  T_INVEST_EXECUTION_MAX_DAILY_RISK_RUB: z.coerce.number().positive().max(10_000).default(1_000),
  T_INVEST_EXECUTION_CANDIDATE_MAX_AGE_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  T_INVEST_SANDBOX_INITIAL_BALANCE_RUB: z.coerce.number().positive().max(1_000_000).default(100_000),
  T_INVEST_LIVE_PILOT_PREPARE: z.enum(['true', 'false']).default('true'),
  T_INVEST_LIVE_TOKEN: optionalNonEmpty,
  T_INVEST_LIVE_ACCOUNT_ID: optionalNonEmpty,
  T_INVEST_LIVE_CAPITAL_RUB: z.coerce.number().positive().max(1_000).default(1_000),
  T_INVEST_LIVE_MAX_TRADE_RISK_RUB: z.coerce.number().positive().max(20).default(20),
  T_INVEST_LIVE_MAX_DAILY_RISK_RUB: z.coerce.number().positive().max(60).default(60),
  T_INVEST_LIVE_MAX_DAILY_LOSS_RUB: z.coerce.number().positive().max(60).default(60),
  T_INVEST_BACKTEST_STARTING_CAPITAL_RUB: z.coerce.number().positive().max(1_000_000).default(100_000),
  T_INVEST_BACKTEST_MAX_CONCURRENT_POSITIONS: z.coerce.number().int().min(1).max(5).default(2),
  T_INVEST_INTRADAY_ACCOUNT_ID: optionalNonEmpty,
  T_INVEST_SWING_ACCOUNT_ID: optionalNonEmpty,
  INTRADAY_MAX_RISK_RUB: z.coerce.number().positive().default(500),
  INTRADAY_MAX_POSITION_RUB: z.coerce.number().positive().default(50_000),
  INTRADAY_MAX_SPREAD_PCT: z.coerce.number().positive().max(5).default(0.3),
  INTRADAY_MAX_ENTRY_DEVIATION_PCT: z.coerce.number().positive().max(10).default(0.5),
  INTRADAY_ALLOW_SHORT: z.enum(['true', 'false']).default('false'),
  SWING_MAX_RISK_RUB: z.coerce.number().positive().default(700),
  SWING_MAX_POSITION_RUB: z.coerce.number().positive().default(50_000),
  SWING_MAX_SPREAD_PCT: z.coerce.number().positive().max(5).default(0.5),
  SWING_MAX_ENTRY_DEVIATION_PCT: z.coerce.number().positive().max(10).default(1),
  SWING_ALLOW_SHORT: z.enum(['true', 'false']).default('false'),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const prepare = parsed.T_INVEST_LIVE_PILOT_PREPARE === 'true';
  let miniAppUrl: string | undefined;
  if (parsed.TELEGRAM_MINI_APP_URL) {
    try {
      const url = new URL(parsed.TELEGRAM_MINI_APP_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || url.pathname !== '/' || url.port || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) throw new Error();
      miniAppUrl = url.origin;
    } catch { throw new Error('TELEGRAM_MINI_APP_URL must be a bare public HTTPS origin'); }
  }
  if (parsed.TELEGRAM_MINI_APP_ENABLED === 'true' && (!miniAppUrl || !parsed.TELEGRAM_BOT_TOKEN)) {
    throw new Error('Mini App requires its public HTTPS origin and a configured bot');
  }
  const commissionRate = prepare ? Math.max(0.003, parsed.T_INVEST_COMMISSION_RATE) : parsed.T_INVEST_COMMISSION_RATE;
  const sandboxToken = resolveCredentialAliases('sandbox', parsed.T_INVEST_SANDBOX_TOKEN,
    parsed.T_INVEST_TRADING_TOKEN_ROLE === 'sandbox' ? parsed.T_INVEST_TRADING_TOKEN : undefined);
  const liveToken = resolveCredentialAliases('live', parsed.T_INVEST_LIVE_TOKEN,
    parsed.T_INVEST_TRADING_TOKEN_ROLE === 'live' ? parsed.T_INVEST_TRADING_TOKEN : undefined);
  const roleTokens = [parsed.T_INVEST_TOKEN, sandboxToken, liveToken].filter((token): token is string => Boolean(token));
  if (new Set(roleTokens).size !== roleTokens.length) {
    throw new Error('Live, sandbox and read-only tokens must be separate');
  }
  if (parsed.T_INVEST_LIVE_ACCOUNT_ID && [parsed.T_INVEST_SWING_ACCOUNT_ID, parsed.T_INVEST_SANDBOX_ACCOUNT_ID].includes(parsed.T_INVEST_LIVE_ACCOUNT_ID)) {
    throw new Error('Daily live pilot must not use the weekly or sandbox account');
  }
  if (parsed.T_INVEST_LIVE_MAX_TRADE_RISK_RUB > parsed.T_INVEST_LIVE_MAX_DAILY_RISK_RUB) {
    throw new Error('Live per-trade risk must not exceed the daily risk budget');
  }
  // Leave cash for entry fees and estimated slippage; never round this budget up.
  const pilotPositionRub = pilotPositionBudget(parsed.T_INVEST_LIVE_CAPITAL_RUB, commissionRate, parsed.T_INVEST_SCANNER_SLIPPAGE_RATE);
  const intradayWatchlist = parseIntradayWatchlist(parsed.T_INVEST_INTRADAY_WATCHLIST);
  if (parsed.T_INVEST_INTRADAY_UNIVERSE === 'watchlist' && intradayWatchlist.some(item => !item.label || !/^[A-Z0-9.-]{1,16}$/.test(item.label))) {
    throw new Error('Watchlist mode requires an uppercase exchange ticker label for each item; use moex-liquid for automatic metadata');
  }
  return {
    ...(parsed.T_INVEST_TOKEN ? { token: parsed.T_INVEST_TOKEN } : {}),
    baseUrl: parsed.T_INVEST_BASE_URL.replace(/\/$/, ''),
    historyDataUrl: parsed.T_INVEST_HISTORY_DATA_URL,
    transport: parsed.T_INVEST_TRANSPORT,
    commissionRate,
    journalPath: parsed.T_INVEST_JOURNAL_PATH,
    marketDataPath: parsed.T_INVEST_MARKET_DATA_PATH,
    scanner: {
      tradingStrategyId: parsed.T_INVEST_TRADING_STRATEGY_ID,
      sessionStartMinutes: Number(parsed.T_INVEST_STRATEGY_SESSION_START.slice(0, 2)) * 60 + Number(parsed.T_INVEST_STRATEGY_SESSION_START.slice(3)),
      intervalSeconds: parsed.T_INVEST_SCANNER_INTERVAL_SECONDS,
      lookbackMinutes: parsed.T_INVEST_SCANNER_LOOKBACK_MINUTES,
      candidateCooldownMinutes: parsed.T_INVEST_SCANNER_CANDIDATE_COOLDOWN_MINUTES,
      slippageRate: parsed.T_INVEST_SCANNER_SLIPPAGE_RATE,
      universeMode: parsed.T_INVEST_INTRADAY_UNIVERSE,
      universeTickers: parseUniverseTickers(parsed.T_INVEST_INTRADAY_UNIVERSE_TICKERS),
      universeRefreshMinutes: parsed.T_INVEST_SCANNER_UNIVERSE_REFRESH_MINUTES,
      maxInstruments: parsed.T_INVEST_SCANNER_MAX_INSTRUMENTS,
      maxConcurrentRequests: parsed.T_INVEST_SCANNER_MAX_CONCURRENT_REQUESTS,
      minAverageCandleTurnoverRub:
        parsed.T_INVEST_SCANNER_MIN_AVERAGE_CANDLE_TURNOVER_RUB,
      maxCandidatesPerScan: parsed.T_INVEST_SCANNER_MAX_CANDIDATES_PER_SCAN,
      intradayWatchlist,
    },
    telegram: {
      ...(parsed.TELEGRAM_BOT_TOKEN ? { token: parsed.TELEGRAM_BOT_TOKEN } : {}),
      allowedChatIds: parseTelegramAllowedChatIds(parsed.TELEGRAM_ALLOWED_CHAT_IDS),
      pollingTimeoutSeconds: parsed.TELEGRAM_POLLING_TIMEOUT_SECONDS,
      miniApp: {
        enabled: parsed.TELEGRAM_MINI_APP_ENABLED === 'true',
        ...(miniAppUrl ? { url: miniAppUrl } : {}),
        host: parsed.TELEGRAM_MINI_APP_HOST, port: parsed.TELEGRAM_MINI_APP_PORT,
      },
    },
    execution: {
      mode: parsed.T_INVEST_EXECUTION_MODE,
      // Sandbox execution must not reuse or redirect production read-only data.
      baseUrl: 'https://sandbox-invest-public-api.tbank.ru/rest',
      ...(sandboxToken ? { token: sandboxToken } : {}),
      ...(parsed.T_INVEST_SANDBOX_ACCOUNT_ID
        ? { accountId: parsed.T_INVEST_SANDBOX_ACCOUNT_ID }
        : {}),
      maxOrdersPerDay: parsed.T_INVEST_EXECUTION_MAX_ORDERS_PER_DAY,
      maxDailyRiskRub: prepare ? Math.min(parsed.T_INVEST_EXECUTION_MAX_DAILY_RISK_RUB, parsed.T_INVEST_LIVE_MAX_DAILY_RISK_RUB) : parsed.T_INVEST_EXECUTION_MAX_DAILY_RISK_RUB,
      candidateMaxAgeMinutes: parsed.T_INVEST_EXECUTION_CANDIDATE_MAX_AGE_MINUTES,
      // Live cash changes must not rewrite the separately prepared sandbox baseline.
      sandboxInitialBalanceRub: prepare ? Math.min(parsed.T_INVEST_SANDBOX_INITIAL_BALANCE_RUB, 1_000) : parsed.T_INVEST_SANDBOX_INITIAL_BALANCE_RUB,
      sandboxProtectionEnabled: parsed.T_INVEST_SANDBOX_PROTECTION_ENABLED === 'true',
      sandboxLossGuardEnabled: parsed.T_INVEST_SANDBOX_LOSS_GUARD_ENABLED === 'true',
      sandboxSessionCloseEnabled: parsed.T_INVEST_SANDBOX_SESSION_CLOSE_ENABLED === 'true',
    },
    livePilot: {
      prepare,
      ...(liveToken ? { token: liveToken } : {}),
      ...(parsed.T_INVEST_LIVE_ACCOUNT_ID ? { accountId: parsed.T_INVEST_LIVE_ACCOUNT_ID } : {}),
      capitalRub: parsed.T_INVEST_LIVE_CAPITAL_RUB,
      maxTradeRiskRub: parsed.T_INVEST_LIVE_MAX_TRADE_RISK_RUB,
      maxDailyRiskRub: parsed.T_INVEST_LIVE_MAX_DAILY_RISK_RUB,
      maxDailyLossRub: parsed.T_INVEST_LIVE_MAX_DAILY_LOSS_RUB,
    },
    backtest: {
      startingCapitalRub: parsed.T_INVEST_BACKTEST_STARTING_CAPITAL_RUB,
      maxConcurrentPositions: parsed.T_INVEST_BACKTEST_MAX_CONCURRENT_POSITIONS,
    },
    strategies: {
      intraday: {
        ...(parsed.T_INVEST_INTRADAY_ACCOUNT_ID
          ? { accountId: parsed.T_INVEST_INTRADAY_ACCOUNT_ID }
          : {}),
        maxRiskRub: prepare ? Math.min(parsed.INTRADAY_MAX_RISK_RUB, parsed.T_INVEST_LIVE_MAX_TRADE_RISK_RUB) : parsed.INTRADAY_MAX_RISK_RUB,
        maxPositionRub: prepare ? Math.min(parsed.INTRADAY_MAX_POSITION_RUB, pilotPositionRub) : parsed.INTRADAY_MAX_POSITION_RUB,
        maxSpreadPct: parsed.INTRADAY_MAX_SPREAD_PCT,
        maxEntryDeviationPct: parsed.INTRADAY_MAX_ENTRY_DEVIATION_PCT,
        allowShort: !prepare && parsed.INTRADAY_ALLOW_SHORT === 'true',
      },
      swing: {
        ...(parsed.T_INVEST_SWING_ACCOUNT_ID ? { accountId: parsed.T_INVEST_SWING_ACCOUNT_ID } : {}),
        maxRiskRub: parsed.SWING_MAX_RISK_RUB,
        maxPositionRub: parsed.SWING_MAX_POSITION_RUB,
        maxSpreadPct: parsed.SWING_MAX_SPREAD_PCT,
        maxEntryDeviationPct: parsed.SWING_MAX_ENTRY_DEVIATION_PCT,
        allowShort: parsed.SWING_ALLOW_SHORT === 'true',
      },
    },
  };
}

export function getAccountId(config: AppConfig, strategy: Strategy): string {
  const accountId = config.strategies[strategy].accountId;
  if (!accountId) {
    throw new Error(`Account for ${strategy} is not configured`);
  }
  return accountId;
}

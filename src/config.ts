import { z } from 'zod/v4';

import type { TInvestTransport } from './tbank/client.js';

export type Strategy = 'intraday' | 'swing';
export type ExecutionMode = 'disabled' | 'sandbox';

export type IntradayWatchlistItem = {
  instrumentId: string;
  label?: string | undefined;
  lotSize: number;
  priceStep: number;
};

export type ScannerConfig = {
  intervalSeconds: number;
  lookbackMinutes: number;
  candidateCooldownMinutes: number;
  slippageRate: number;
  intradayWatchlist: IntradayWatchlistItem[];
};

export type TelegramConfig = {
  token?: string;
  allowedChatIds: string[];
  pollingTimeoutSeconds: number;
};

export type ExecutionConfig = {
  mode: ExecutionMode;
  token?: string;
  accountId?: string;
  maxOrdersPerDay: number;
  maxDailyRiskRub: number;
  candidateMaxAgeMinutes: number;
  sandboxInitialBalanceRub: number;
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
  transport: TInvestTransport;
  commissionRate: number;
  journalPath: string;
  scanner: ScannerConfig;
  telegram: TelegramConfig;
  execution: ExecutionConfig;
  strategies: Record<Strategy, StrategyLimits>;
};

const optionalNonEmpty = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const intradayWatchlistItemSchema = z.object({
  instrumentId: z.string().trim().min(1).max(256),
  label: z.string().trim().min(1).max(64).optional(),
  lotSize: z.coerce.number().int().positive(),
  priceStep: z.coerce.number().positive(),
});

function parseIntradayWatchlist(raw: string): IntradayWatchlistItem[] {
  try {
    return z.array(intradayWatchlistItemSchema).max(10).parse(JSON.parse(raw));
  } catch {
    throw new Error(
      'T_INVEST_INTRADAY_WATCHLIST must be a JSON array of instrumentId, optional label, lotSize and priceStep values',
    );
  }
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
  T_INVEST_TRANSPORT: z.enum(['fetch', 'system-curl']).default('fetch'),
  T_INVEST_COMMISSION_RATE: z.coerce.number().min(0).max(0.1).default(0.0005),
  T_INVEST_JOURNAL_PATH: z.string().trim().min(1).default('.trading/journal.sqlite'),
  T_INVEST_INTRADAY_WATCHLIST: z.string().default('[]'),
  T_INVEST_SCANNER_INTERVAL_SECONDS: z.coerce.number().int().min(300).max(3_600).default(300),
  T_INVEST_SCANNER_LOOKBACK_MINUTES: z.coerce.number().int().min(300).max(720).default(360),
  T_INVEST_SCANNER_CANDIDATE_COOLDOWN_MINUTES: z.coerce.number().int().min(5).max(1_440).default(30),
  T_INVEST_SCANNER_SLIPPAGE_RATE: z.coerce.number().min(0).max(0.02).default(0.0005),
  TELEGRAM_BOT_TOKEN: optionalNonEmpty,
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().default(''),
  TELEGRAM_POLLING_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(50).default(25),
  T_INVEST_EXECUTION_MODE: z.enum(['disabled', 'sandbox']).default('disabled'),
  T_INVEST_TRADING_TOKEN: optionalNonEmpty,
  T_INVEST_SANDBOX_ACCOUNT_ID: optionalNonEmpty,
  T_INVEST_EXECUTION_MAX_ORDERS_PER_DAY: z.coerce.number().int().min(1).max(20).default(3),
  T_INVEST_EXECUTION_MAX_DAILY_RISK_RUB: z.coerce.number().positive().max(10_000).default(1_000),
  T_INVEST_EXECUTION_CANDIDATE_MAX_AGE_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  T_INVEST_SANDBOX_INITIAL_BALANCE_RUB: z.coerce.number().positive().max(1_000_000).default(100_000),
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
  return {
    ...(parsed.T_INVEST_TOKEN ? { token: parsed.T_INVEST_TOKEN } : {}),
    baseUrl: parsed.T_INVEST_BASE_URL.replace(/\/$/, ''),
    transport: parsed.T_INVEST_TRANSPORT,
    commissionRate: parsed.T_INVEST_COMMISSION_RATE,
    journalPath: parsed.T_INVEST_JOURNAL_PATH,
    scanner: {
      intervalSeconds: parsed.T_INVEST_SCANNER_INTERVAL_SECONDS,
      lookbackMinutes: parsed.T_INVEST_SCANNER_LOOKBACK_MINUTES,
      candidateCooldownMinutes: parsed.T_INVEST_SCANNER_CANDIDATE_COOLDOWN_MINUTES,
      slippageRate: parsed.T_INVEST_SCANNER_SLIPPAGE_RATE,
      intradayWatchlist: parseIntradayWatchlist(parsed.T_INVEST_INTRADAY_WATCHLIST),
    },
    telegram: {
      ...(parsed.TELEGRAM_BOT_TOKEN ? { token: parsed.TELEGRAM_BOT_TOKEN } : {}),
      allowedChatIds: parseTelegramAllowedChatIds(parsed.TELEGRAM_ALLOWED_CHAT_IDS),
      pollingTimeoutSeconds: parsed.TELEGRAM_POLLING_TIMEOUT_SECONDS,
    },
    execution: {
      mode: parsed.T_INVEST_EXECUTION_MODE,
      ...(parsed.T_INVEST_TRADING_TOKEN ? { token: parsed.T_INVEST_TRADING_TOKEN } : {}),
      ...(parsed.T_INVEST_SANDBOX_ACCOUNT_ID
        ? { accountId: parsed.T_INVEST_SANDBOX_ACCOUNT_ID }
        : {}),
      maxOrdersPerDay: parsed.T_INVEST_EXECUTION_MAX_ORDERS_PER_DAY,
      maxDailyRiskRub: parsed.T_INVEST_EXECUTION_MAX_DAILY_RISK_RUB,
      candidateMaxAgeMinutes: parsed.T_INVEST_EXECUTION_CANDIDATE_MAX_AGE_MINUTES,
      sandboxInitialBalanceRub: parsed.T_INVEST_SANDBOX_INITIAL_BALANCE_RUB,
    },
    strategies: {
      intraday: {
        ...(parsed.T_INVEST_INTRADAY_ACCOUNT_ID
          ? { accountId: parsed.T_INVEST_INTRADAY_ACCOUNT_ID }
          : {}),
        maxRiskRub: parsed.INTRADAY_MAX_RISK_RUB,
        maxPositionRub: parsed.INTRADAY_MAX_POSITION_RUB,
        maxSpreadPct: parsed.INTRADAY_MAX_SPREAD_PCT,
        maxEntryDeviationPct: parsed.INTRADAY_MAX_ENTRY_DEVIATION_PCT,
        allowShort: parsed.INTRADAY_ALLOW_SHORT === 'true',
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

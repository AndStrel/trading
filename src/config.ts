import { z } from 'zod/v4';

import type { TInvestTransport } from './tbank/client.js';

export type Strategy = 'intraday' | 'swing';

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
  strategies: Record<Strategy, StrategyLimits>;
};

const optionalNonEmpty = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  T_INVEST_TOKEN: optionalNonEmpty,
  T_INVEST_BASE_URL: z.string().url().default('https://invest-public-api.tbank.ru/rest'),
  T_INVEST_TRANSPORT: z.enum(['fetch', 'system-curl']).default('fetch'),
  T_INVEST_COMMISSION_RATE: z.coerce.number().min(0).max(0.1).default(0.0005),
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

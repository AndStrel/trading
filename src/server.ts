import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { AppConfig, Strategy } from './config.js';
import { getAccountId } from './config.js';
import { calculateTradePlan } from './domain/trade-plan.js';
import { TInvestClient } from './tbank/client.js';

const strategySchema = z.enum(['intraday', 'swing']);
const candleIntervals = z.enum([
  'CANDLE_INTERVAL_1_MIN',
  'CANDLE_INTERVAL_5_MIN',
  'CANDLE_INTERVAL_15_MIN',
  'CANDLE_INTERVAL_HOUR',
  'CANDLE_INTERVAL_DAY',
]);

function result(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { data },
  };
}

export function createServer(config: AppConfig, client = new TInvestClient(config.token, config.baseUrl)) {
  const server = new McpServer(
    { name: 'andstrel-trading', version: '0.1.0' },
    {
      instructions:
        'This server is read-only. Treat market data as informational. Calculate a trade plan before proposing a trade. Never claim an order was placed.',
    },
  );

  server.registerTool(
    'system_status',
    {
      description: 'Show safe configuration status without exposing tokens or account identifiers.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      result({
        mode: 'read-only',
        tokenConfigured: Boolean(config.token),
        accountsConfigured: {
          intraday: Boolean(config.strategies.intraday.accountId),
          swing: Boolean(config.strategies.swing.accountId),
        },
        commissionRate: config.commissionRate,
        limits: {
          intraday: {
            maxRiskRub: config.strategies.intraday.maxRiskRub,
            maxPositionRub: config.strategies.intraday.maxPositionRub,
          },
          swing: {
            maxRiskRub: config.strategies.swing.maxRiskRub,
            maxPositionRub: config.strategies.swing.maxPositionRub,
          },
        },
      }),
  );

  server.registerTool(
    'list_accounts',
    {
      description: 'List T-Invest accounts so the user can map them to intraday and swing strategies.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => result(await client.getAccounts()),
  );

  server.registerTool(
    'get_portfolio',
    {
      description: 'Get the portfolio for the account assigned to a strategy.',
      inputSchema: z.object({ strategy: strategySchema }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ strategy }) => result(await client.getPortfolio(getAccountId(config, strategy as Strategy))),
  );

  server.registerTool(
    'get_positions',
    {
      description: 'Get positions and available cash for the account assigned to a strategy.',
      inputSchema: z.object({ strategy: strategySchema }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ strategy }) => result(await client.getPositions(getAccountId(config, strategy as Strategy))),
  );

  server.registerTool(
    'get_last_prices',
    {
      description: 'Get exchange last prices for one or more T-Invest instrument identifiers.',
      inputSchema: z.object({
        instrumentIds: z.array(z.string().min(1)).min(1).max(50),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ instrumentIds }) => result(await client.getLastPrices(instrumentIds)),
  );

  server.registerTool(
    'get_candles',
    {
      description: 'Get historical candles. Dates must be ISO-8601 UTC strings.',
      inputSchema: z.object({
        instrumentId: z.string().min(1),
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
        interval: candleIntervals,
        limit: z.number().int().min(1).max(1000).default(500),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (params) => result(await client.getCandles(params)),
  );

  server.registerTool(
    'calculate_trade_plan',
    {
      description:
        'Calculate a deterministic position size and net reward/risk including round-trip commission and slippage.',
      inputSchema: z.object({
        strategy: strategySchema,
        entryPrice: z.number().positive(),
        stopPrice: z.number().nonnegative(),
        targetPrice: z.number().nonnegative(),
        lotSize: z.number().int().positive(),
        slippageRate: z.number().min(0).max(0.02).default(0.0005),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ strategy, ...input }) => {
      const limits = config.strategies[strategy as Strategy];
      return result(
        calculateTradePlan({
          ...input,
          commissionRate: config.commissionRate,
          maxRiskRub: limits.maxRiskRub,
          maxPositionRub: limits.maxPositionRub,
        }),
      );
    },
  );

  return server;
}

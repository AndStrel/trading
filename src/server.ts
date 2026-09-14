import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { AppConfig, Strategy } from './config.js';
import { getAccountId } from './config.js';
import { analyzeCandles } from './domain/candle-analysis.js';
import { assessTradeScenario } from './domain/trade-scenario.js';
import { calculateTradePlan } from './domain/trade-plan.js';
import { ScenarioJournal } from './journal/scenario-journal.js';
import { TInvestClient } from './tbank/client.js';

const strategySchema = z.enum(['intraday', 'swing']);
const candleIntervals = z.enum([
  'CANDLE_INTERVAL_1_MIN',
  'CANDLE_INTERVAL_5_MIN',
  'CANDLE_INTERVAL_15_MIN',
  'CANDLE_INTERVAL_HOUR',
  'CANDLE_INTERVAL_DAY',
]);
const instrumentIdSchema = z.string().trim().min(1).max(256);
const instrumentQuerySchema = z.string().trim().min(1).max(128);
const orderBookDepthSchema = z.number().int().min(1).max(50).default(20);
const scenarioInputSchema = z.object({
  strategy: strategySchema,
  instrumentId: instrumentIdSchema,
  side: z.enum(['long', 'short']),
  entryPrice: z.number().positive(),
  stopPrice: z.number().nonnegative(),
  targetPrice: z.number().nonnegative(),
  lotSize: z.number().int().positive(),
  slippageRate: z.number().min(0).max(0.02).default(0.0005),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  interval: candleIntervals,
  depth: orderBookDepthSchema,
});
type ScenarioInput = z.infer<typeof scenarioInputSchema>;

function result(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { data },
  };
}

async function buildTradeScenario(
  config: AppConfig,
  client: TInvestClient,
  input: ScenarioInput,
) {
  const limits = config.strategies[input.strategy as Strategy];
  const [candles, lastPrices, orderBook, tradingStatus] = await Promise.all([
    client.getCandles({
      instrumentId: input.instrumentId,
      from: input.from,
      to: input.to,
      interval: input.interval,
    }),
    client.getLastPrices([input.instrumentId]),
    client.getOrderBook(input.instrumentId, input.depth),
    client.getTradingStatus(input.instrumentId),
  ]);
  const candleAnalysis = analyzeCandles(candles);
  const tradePlan = calculateTradePlan({
    side: input.side,
    entryPrice: input.entryPrice,
    stopPrice: input.stopPrice,
    targetPrice: input.targetPrice,
    lotSize: input.lotSize,
    slippageRate: input.slippageRate,
    commissionRate: config.commissionRate,
    maxRiskRub: limits.maxRiskRub,
    maxPositionRub: limits.maxPositionRub,
  });
  const assessment = assessTradeScenario({
    side: input.side,
    entryPrice: input.entryPrice,
    maxSpreadPct: limits.maxSpreadPct,
    maxEntryDeviationPct: limits.maxEntryDeviationPct,
    allowShort: limits.allowShort,
    tradePlan,
    candleAnalysis,
    lastPricesPayload: lastPrices,
    orderBookPayload: orderBook,
    tradingStatusPayload: tradingStatus,
  });

  return {
    mode: 'analysis-only' as const,
    observedAt: new Date().toISOString(),
    strategy: input.strategy,
    instrumentId: input.instrumentId,
    input: {
      side: input.side,
      entryPrice: input.entryPrice,
      stopPrice: input.stopPrice,
      targetPrice: input.targetPrice,
      lotSize: input.lotSize,
      slippageRate: input.slippageRate,
    },
    tradePlan,
    candleAnalysis,
    ...assessment,
  };
}

export function createServer(
  config: AppConfig,
  client = new TInvestClient(config.token, config.baseUrl, { transport: config.transport }),
) {
  const journal = new ScenarioJournal(config.journalPath);
  const server = new McpServer(
    { name: 'andstrel-trading', version: '0.1.0' },
    {
      instructions:
        'This server has analysis-only broker access. It may save local scenario journal records but never submits an order. Treat market data as informational and calculate a trade plan before proposing a trade.',
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
        mode: 'analysis-only',
        transport: config.transport,
        tokenConfigured: Boolean(config.token),
        accountsConfigured: {
          intraday: Boolean(config.strategies.intraday.accountId),
          swing: Boolean(config.strategies.swing.accountId),
        },
        commissionRate: config.commissionRate,
        localScenarioJournal: true,
        limits: {
          intraday: {
            maxRiskRub: config.strategies.intraday.maxRiskRub,
            maxPositionRub: config.strategies.intraday.maxPositionRub,
            maxSpreadPct: config.strategies.intraday.maxSpreadPct,
            maxEntryDeviationPct: config.strategies.intraday.maxEntryDeviationPct,
            allowShort: config.strategies.intraday.allowShort,
          },
          swing: {
            maxRiskRub: config.strategies.swing.maxRiskRub,
            maxPositionRub: config.strategies.swing.maxPositionRub,
            maxSpreadPct: config.strategies.swing.maxSpreadPct,
            maxEntryDeviationPct: config.strategies.swing.maxEntryDeviationPct,
            allowShort: config.strategies.swing.allowShort,
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
    'find_instrument',
    {
      description:
        'Find API-tradable T-Invest instruments by ticker, FIGI, ISIN or name before requesting market data.',
      inputSchema: z.object({ query: instrumentQuerySchema }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query }) => result(await client.findInstrument(query)),
  );

  server.registerTool(
    'get_last_prices',
    {
      description: 'Get exchange last prices for one or more T-Invest instrument identifiers.',
      inputSchema: z.object({
        instrumentIds: z.array(instrumentIdSchema).min(1).max(50),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ instrumentIds }) => result(await client.getLastPrices(instrumentIds)),
  );

  server.registerTool(
    'get_order_book',
    {
      description:
        'Get the current order book. Use it to assess spread and available bid/ask volume; it is not a trade signal.',
      inputSchema: z.object({
        instrumentId: instrumentIdSchema,
        depth: orderBookDepthSchema,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ instrumentId, depth }) => result(await client.getOrderBook(instrumentId, depth)),
  );

  server.registerTool(
    'get_trading_status',
    {
      description:
        'Get current exchange and API trading availability for an instrument before considering a trade.',
      inputSchema: z.object({ instrumentId: instrumentIdSchema }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ instrumentId }) => result(await client.getTradingStatus(instrumentId)),
  );

  server.registerTool(
    'get_market_snapshot',
    {
      description:
        'Get last price, order book and trading status in parallel for a single instrument. This is a point-in-time observation, not a trade recommendation.',
      inputSchema: z.object({
        instrumentId: instrumentIdSchema,
        depth: orderBookDepthSchema,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ instrumentId, depth }) => {
      const [lastPrices, orderBook, tradingStatus] = await Promise.all([
        client.getLastPrices([instrumentId]),
        client.getOrderBook(instrumentId, depth),
        client.getTradingStatus(instrumentId),
      ]);
      return result({
        instrumentId,
        observedAt: new Date().toISOString(),
        lastPrices,
        orderBook,
        tradingStatus,
      });
    },
  );

  server.registerTool(
    'get_candles',
    {
      description: 'Get historical candles. Dates must be ISO-8601 UTC strings.',
      inputSchema: z.object({
        instrumentId: instrumentIdSchema,
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
        interval: candleIntervals,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (params) => result(await client.getCandles(params)),
  );

  server.registerTool(
    'analyze_candles',
    {
      description:
        'Calculate deterministic trend, ATR volatility and relative volume from complete historical candles. It does not create a buy or sell signal.',
      inputSchema: z.object({
        instrumentId: instrumentIdSchema,
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
        interval: candleIntervals,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (params) => result(analyzeCandles(await client.getCandles(params))),
  );

  server.registerTool(
    'prepare_trade_scenario',
    {
      description:
        'Build one analysis-only trade scenario from live price, order book, trading status, candles and configured risk limits. It never submits an order.',
      inputSchema: scenarioInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input) => result(await buildTradeScenario(config, client, input as ScenarioInput)),
  );

  server.registerTool(
    'record_trade_scenario',
    {
      description:
        'Build a fresh analysis-only scenario and save its safe snapshot in the local SQLite journal. It never submits an order or stores a token.',
      inputSchema: scenarioInputSchema.extend({
        note: z.string().trim().min(1).max(1_000).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ note, ...input }) => {
      const scenario = await buildTradeScenario(config, client, input as ScenarioInput);
      const record = journal.record({
        observedAt: scenario.observedAt,
        strategy: scenario.strategy,
        instrumentId: scenario.instrumentId,
        input: scenario.input,
        decision: scenario.decision,
        blockers: scenario.blockers,
        warnings: scenario.warnings,
        snapshot: {
          input: scenario.input,
          tradePlan: scenario.tradePlan,
          candleAnalysis: scenario.candleAnalysis,
          market: scenario.market,
        },
        ...(note ? { note } : {}),
      });

      return result({
        ...scenario,
        journal: {
          id: record.id,
          recordedAt: record.recordedAt,
          note: record.note ?? null,
        },
      });
    },
  );

  server.registerTool(
    'list_recorded_scenarios',
    {
      description:
        'List safe local scenario snapshots from the SQLite journal. This reads only the local journal and never contacts T-Invest.',
      inputSchema: z.object({
        strategy: strategySchema.optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ strategy, limit }) => result(journal.list(limit, strategy as Strategy | undefined)),
  );

  server.registerTool(
    'calculate_trade_plan',
    {
      description:
        'Calculate a deterministic position size and net reward/risk including round-trip commission and slippage.',
      inputSchema: z.object({
        strategy: strategySchema,
        side: z.enum(['long', 'short']),
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

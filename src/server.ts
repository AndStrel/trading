import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { AppConfig, Strategy } from './config.js';
import { getAccountId } from './config.js';
import { analyzeCandles } from './domain/candle-analysis.js';
import { assessTradeScenario } from './domain/trade-scenario.js';
import { summarizePaperTrades } from './domain/paper-report.js';
import { calculatePaperEntry, calculatePaperExit } from './domain/paper-trade.js';
import { calculateTradePlan } from './domain/trade-plan.js';
import { quotationToNumber } from './domain/money.js';
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
const paperTradeStatusSchema = z.enum(['open', 'closed']);
const reportPeriodSchema = z.enum(['day', 'week']);
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

function getExchangeLastPrice(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('T-Invest did not return a last-price payload');
  }
  const lastPrices = (payload as { lastPrices?: unknown }).lastPrices;
  if (!Array.isArray(lastPrices) || lastPrices.length === 0) {
    throw new Error('T-Invest did not return an exchange last price');
  }
  const first = lastPrices[0];
  if (typeof first !== 'object' || first === null) {
    throw new Error('T-Invest returned an invalid last price');
  }
  const price = quotationToNumber((first as { price?: { units?: string | number; nano?: number } }).price);
  if (price === null || price <= 0) {
    throw new Error('T-Invest returned an invalid exchange last price');
  }
  return price;
}

function getReportWindow(period: 'day' | 'week', endAt?: string) {
  const to = endAt ? new Date(endAt) : new Date();
  if (Number.isNaN(to.getTime())) throw new Error('Invalid report end time');
  const durationMs = period === 'day' ? 24 * 60 * 60 * 1_000 : 7 * 24 * 60 * 60 * 1_000;
  const from = new Date(to.getTime() - durationMs);
  return { from: from.toISOString(), to: to.toISOString() };
}

function getPaperPosition(snapshot: unknown): { lots: number; units: number } {
  if (typeof snapshot !== 'object' || snapshot === null) {
    throw new Error('Recorded scenario has no paper-trade snapshot');
  }
  const tradePlan = (snapshot as { tradePlan?: unknown }).tradePlan;
  if (typeof tradePlan !== 'object' || tradePlan === null) {
    throw new Error('Recorded scenario has no trade plan');
  }
  const plan = tradePlan as { allowed?: unknown; lots?: unknown; units?: unknown };
  if (plan.allowed !== true || !Number.isInteger(plan.lots) || !Number.isInteger(plan.units)) {
    throw new Error('Recorded scenario does not contain an allowed whole-lot trade plan');
  }
  if ((plan.lots as number) < 1 || (plan.units as number) < 1) {
    throw new Error('Recorded scenario does not contain a positive paper position');
  }
  return { lots: plan.lots as number, units: plan.units as number };
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
        'This server has analysis-only broker access. It may save local scenarios and paper trades but never submits an order. Treat market data as informational and calculate a trade plan before proposing a trade.',
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
        paperTrading: true,
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
    'open_paper_trade',
    {
      description:
        'Open one local paper trade from a saved candidate scenario. It fetches a current last price, applies adverse simulated slippage and entry commission, and never submits an order.',
      inputSchema: z.object({
        scenarioId: z.number().int().positive(),
        confirmPaperTrade: z.literal(true),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ scenarioId }) => {
      const scenario = journal.getScenario(scenarioId);
      if (!scenario) throw new Error('Recorded scenario was not found');
      if (scenario.decision !== 'candidate') {
        throw new Error('Only a candidate scenario can open a paper trade');
      }

      const position = getPaperPosition(scenario.snapshot);
      const marketPrice = getExchangeLastPrice(await client.getLastPrices([scenario.instrumentId]));
      const entry = calculatePaperEntry({
        side: scenario.input.side,
        units: position.units,
        marketPrice,
        commissionRate: config.commissionRate,
        slippageRate: scenario.input.slippageRate,
      });
      const paperTrade = journal.openPaperTrade({
        scenarioId: scenario.id,
        strategy: scenario.strategy,
        instrumentId: scenario.instrumentId,
        side: scenario.input.side,
        lots: position.lots,
        units: position.units,
        ...entry,
        commissionRate: config.commissionRate,
        slippageRate: scenario.input.slippageRate,
      });

      return result({
        mode: 'paper-trading',
        paperTrade,
        model: {
          orderSubmitted: false,
          slippage: 'Adverse slippage is included in the simulated fill price',
          commission: 'Entry commission is included; exit commission will be added when the trade is closed',
        },
      });
    },
  );

  server.registerTool(
    'close_paper_trade',
    {
      description:
        'Close one open local paper trade at a fresh simulated exit price. It applies adverse exit slippage and commission, then stores gross and net PnL. It never submits an order.',
      inputSchema: z.object({
        paperTradeId: z.number().int().positive(),
        confirmClose: z.literal(true),
        note: z.string().trim().min(1).max(1_000).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ paperTradeId, note }) => {
      const paperTrade = journal.getPaperTrade(paperTradeId);
      if (!paperTrade) throw new Error('Paper trade was not found');
      if (paperTrade.status !== 'open') throw new Error('Paper trade is already closed');

      const marketPrice = getExchangeLastPrice(await client.getLastPrices([paperTrade.instrumentId]));
      const exit = calculatePaperExit({
        side: paperTrade.side,
        units: paperTrade.units,
        entryFillPrice: paperTrade.entryFillPrice,
        entryCommissionRub: paperTrade.entryCommissionRub,
        entrySlippageRub: paperTrade.entrySlippageRub,
        marketPrice,
        commissionRate: paperTrade.commissionRate,
        slippageRate: paperTrade.slippageRate,
      });
      const closedTrade = journal.closePaperTrade({
        id: paperTrade.id,
        ...exit,
        ...(note ? { closeNote: note } : {}),
      });

      return result({
        mode: 'paper-trading',
        paperTrade: closedTrade,
        model: {
          orderSubmitted: false,
          netPnlFormula: 'Gross PnL after simulated fill prices minus entry and exit commissions',
        },
      });
    },
  );

  server.registerTool(
    'list_paper_trades',
    {
      description:
        'List local paper trades and their simulated costs and PnL. This reads only the local SQLite journal and never contacts T-Invest.',
      inputSchema: z.object({
        status: paperTradeStatusSchema.optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ status, limit }) => result(journal.listPaperTrades(limit, status)),
  );

  server.registerTool(
    'get_paper_report',
    {
      description:
        'Summarize closed local paper trades for a rolling day or week. It reports simulated gross/net PnL, commission, slippage, win rate and sample-size warnings without contacting T-Invest.',
      inputSchema: z.object({
        period: reportPeriodSchema,
        endAt: z.iso.datetime({ offset: true }).optional(),
        strategy: strategySchema.optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ period, endAt, strategy }) => {
      const window = getReportWindow(period, endAt);
      const trades = journal.listClosedPaperTrades(window.from, window.to, strategy as Strategy | undefined);
      const report = summarizePaperTrades(
        trades.map((trade) => {
          if (
            trade.status !== 'closed' ||
            trade.grossPnlRub === undefined ||
            trade.totalCommissionRub === undefined ||
            trade.totalSlippageRub === undefined ||
            trade.netPnlRub === undefined
          ) {
            throw new Error('Paper trade journal contains an incomplete closed trade');
          }
          return {
            status: 'closed' as const,
            grossPnlRub: trade.grossPnlRub,
            totalCommissionRub: trade.totalCommissionRub,
            totalSlippageRub: trade.totalSlippageRub,
            netPnlRub: trade.netPnlRub,
          };
        }),
      );

      return result({
        mode: 'paper-trading',
        accounting: 'simulated',
        period,
        window,
        ...(strategy ? { strategy } : {}),
        report,
      });
    },
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

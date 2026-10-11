import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import type { TelegramClient } from '../telegram/client.js';
import { TelegramTradingBot } from '../telegram/bot.js';
import { LiveExecutionService } from './live-execution-service.js';
import { TInvestOrderError } from './tinvest-order-client.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createJournal(): ScenarioJournal {
  const directory = mkdtempSync(join(tmpdir(), 'andstrel-live-'));
  directories.push(directory);
  return new ScenarioJournal(join(directory, 'journal.sqlite'));
}

function createConfig() {
  return loadConfig({
    T_INVEST_TOKEN: 'read-token',
    T_INVEST_SANDBOX_TOKEN: 'sandbox-token',
    T_INVEST_LIVE_TOKEN: 'live-token',
    T_INVEST_LIVE_ACCOUNT_ID: 'daily-account',
    T_INVEST_EXECUTION_MODE: 'live',
    T_INVEST_INTRADAY_WATCHLIST: '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
  });
}

function ready() {
  return { liveSubmissionAllowed: false as const, accountChecksPassed: true, availableCashRub: 1000, blockers: ['arm'] };
}

function market() {
  return {
    getOrderBook: vi.fn().mockResolvedValue({
      bids: [{ price: { units: '99', nano: 900_000_000 }, quantity: 100 }],
      asks: [{ price: { units: '100', nano: 0 }, quantity: 100 }],
    }),
    getTradingStatus: vi.fn().mockResolvedValue({
      tradingStatus: 'SECURITY_TRADING_STATUS_NORMAL_TRADING', apiTradeAvailableFlag: true, limitOrderAvailableFlag: true,
    }),
  };
}

function orders() {
  return {
    postLimitOrder: vi.fn().mockResolvedValue({
      brokerOrderId: 'broker-1', executionStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsRequested: 5, lotsExecuted: 5,
    }),
    getOrderState: vi.fn(),
    postStopLimit: vi.fn().mockResolvedValue('stop-1'),
  };
}

function candidate(journal: ScenarioJournal) {
  return journal.record({
    observedAt: new Date().toISOString(), strategy: 'intraday', instrumentId: 'sber',
    input: { side: 'long', entryPrice: 100, stopPrice: 99, targetPrice: 105, lotSize: 1, slippageRate: 0.0005 },
    decision: 'candidate', blockers: [], warnings: [],
    snapshot: { tradePlan: { lots: 5, positionRub: 500, totalRiskRub: 8.49 } },
  });
}

describe('live execution', () => {
  it('does not post while the kill switch is on', async () => {
    const journal = createJournal();
    const client = orders();
    const service = new LiveExecutionService(createConfig(), market(), client, { check: vi.fn().mockResolvedValue(ready()) }, journal);
    await expect(service.submitScenario(candidate(journal).id, '42')).rejects.toThrow(/kill switch/i);
    expect(client.postLimitOrder).not.toHaveBeenCalled();
    expect(client.postStopLimit).not.toHaveBeenCalled();
  });

  it('keeps the kill switch on when the account check fails', async () => {
    const journal = createJournal();
    const client = orders();
    const service = new LiveExecutionService(createConfig(), market(), client, {
      check: vi.fn().mockResolvedValue({ ...ready(), accountChecksPassed: false, blockers: ['На счёте уже есть позиции: автоматическое управление ими запрещено.'] }),
    }, journal);
    await expect(service.armLive()).rejects.toThrow(/уже есть позиции/);
    expect(service.isKilled()).toBe(true);
    expect(client.postLimitOrder).not.toHaveBeenCalled();
  });

  it('sends one buy and one stop only after arming and confirmation', async () => {
    const journal = createJournal();
    const client = orders();
    const service = new LiveExecutionService(createConfig(), market(), client, { check: vi.fn().mockResolvedValue(ready()) }, journal);
    await service.armLive();
    expect(service.isKilled()).toBe(false);
    const result = await service.submitScenario(candidate(journal).id, '42');
    expect(result.lotsExecuted).toBe(5);
    expect(client.postLimitOrder).toHaveBeenCalledOnce();
    expect(client.postLimitOrder.mock.calls[0]?.[0]).toMatchObject({ mode: 'live', direction: 'buy', lots: 5, accountId: 'daily-account' });
    expect(client.postStopLimit).toHaveBeenCalledOnce();
    expect(client.postStopLimit.mock.calls[0]?.[0]).toMatchObject({ mode: 'live', lots: 5 });
    expect(service.isKilled()).toBe(false);
  });

  it('does not post a second buy when the first outcome is uncertain', async () => {
    const journal = createJournal();
    const client = orders();
    client.postLimitOrder.mockRejectedValue(new TInvestOrderError('timeout', true));
    const service = new LiveExecutionService(createConfig(), market(), client, { check: vi.fn().mockResolvedValue(ready()) }, journal);
    await service.armLive();
    const scenario = candidate(journal);
    await expect(service.submitScenario(scenario.id, '42')).rejects.toThrow(/не подтверждена/);
    await expect(service.submitScenario(scenario.id, '42')).rejects.toThrow(/Сверка/);
    expect(client.postLimitOrder).toHaveBeenCalledOnce();
    expect(client.getOrderState).toHaveBeenCalledOnce();
    expect(client.postStopLimit).not.toHaveBeenCalled();
  });

  it('places one stop when a later read shows the buy filled', async () => {
    const journal = createJournal();
    const client = orders();
    client.postLimitOrder.mockRejectedValueOnce(new TInvestOrderError('timeout', true));
    const service = new LiveExecutionService(createConfig(), market(), client, { check: vi.fn().mockResolvedValue(ready()) }, journal);
    await service.armLive();
    const scenario = candidate(journal);
    await expect(service.submitScenario(scenario.id, '42')).rejects.toThrow(/не подтверждена/);
    const requestId = journal.getExecutionByScenario(scenario.id)?.orderRequestId;
    const now = new Date();
    client.getOrderState.mockResolvedValue({
      orderId: 'broker-1', orderRequestId: requestId, instrumentUid: 'sber',
      direction: 'ORDER_DIRECTION_BUY', orderType: 'ORDER_TYPE_LIMIT',
      executionReportStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsRequested: '5', lotsExecuted: '5', currency: 'rub',
      stages: [{ tradeId: 'trade-1', price: { currency: 'rub', units: '100', nano: 0 }, quantity: '5', executionTime: now.toISOString() }],
      executedCommission: { currency: 'rub', units: '1', nano: 0 }, serviceCommission: { currency: 'rub', units: '0', nano: 0 },
    });
    const result = await service.submitScenario(scenario.id, '42', now);
    expect(result.lotsExecuted).toBe(5);
    expect(client.postLimitOrder).toHaveBeenCalledOnce();
    expect(client.postStopLimit).toHaveBeenCalledOnce();
    expect(service.isKilled()).toBe(false);
  });

  it('does not place a second stop when confirm and reconcile overlap', async () => {
    const journal = createJournal();
    const client = orders();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started: () => void = () => undefined;
    const startedGate = new Promise<void>(resolve => { started = resolve; });
    client.postStopLimit.mockImplementation(async () => {
      started();
      await gate;
      return 'stop-1';
    });
    const service = new LiveExecutionService(createConfig(), market(), client, { check: vi.fn().mockResolvedValue(ready()) }, journal);
    await service.armLive();
    const scenario = candidate(journal);
    const now = new Date();
    client.getOrderState.mockImplementation(async () => ({
      orderId: 'broker-1', orderRequestId: journal.getExecutionByScenario(scenario.id)?.orderRequestId,
      instrumentUid: 'sber', direction: 'ORDER_DIRECTION_BUY', orderType: 'ORDER_TYPE_LIMIT',
      executionReportStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsRequested: '5', lotsExecuted: '5', currency: 'rub',
      stages: [{ tradeId: 'trade-1', price: { currency: 'rub', units: '100', nano: 0 }, quantity: '5', executionTime: now.toISOString() }],
      executedCommission: { currency: 'rub', units: '1', nano: 0 }, serviceCommission: { currency: 'rub', units: '0', nano: 0 },
    }));
    const submit = service.submitScenario(scenario.id, '42', now);
    await startedGate;
    await expect(service.reconcileScenario(scenario.id, now)).rejects.toThrow(/не подтверждён/);
    release();
    await submit;
    expect(client.postLimitOrder).toHaveBeenCalledOnce();
    expect(client.postStopLimit).toHaveBeenCalledOnce();
  });

  it('walks status, arm, card, confirm, stop and kill without a second buy', async () => {
    const journal = createJournal();
    const config = loadConfig({
      T_INVEST_TOKEN: 'read-token',
      T_INVEST_SANDBOX_TOKEN: 'sandbox-token',
      T_INVEST_LIVE_TOKEN: 'live-token',
      T_INVEST_LIVE_ACCOUNT_ID: 'daily-account',
      T_INVEST_EXECUTION_MODE: 'live',
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_INTRADAY_WATCHLIST: '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
    });
    const ordersClient = orders();
    const service = new LiveExecutionService(config, market(), ordersClient, { check: vi.fn().mockResolvedValue(ready()) }, journal);
    const updates: Array<{ update_id: number; message?: { chat: { id: number }; text: string }; callback_query?: { id: string; data: string; message: { chat: { id: number } } } }> = [];
    const sent: string[] = [];
    let button = '';
    const telegram: TelegramClient = {
      getUpdates: async () => updates.splice(0),
      sendMessage: async (_chatId, text) => { sent.push(text); },
      sendPhoto: async ({ caption, replyMarkup }) => {
        sent.push(caption);
        button = replyMarkup?.inline_keyboard?.[0]?.[0]?.callback_data ?? '';
      },
      answerCallbackQuery: async () => undefined,
    };
    const bot = new TelegramTradingBot(config, telegram, { isPaused: () => false, pause: () => undefined, resume: () => undefined },
      journal, () => undefined, async () => new Uint8Array([137, 80, 78, 71]), service);
    updates.push({ update_id: 1, message: { chat: { id: 42 }, text: '/status' } });
    await bot.pollOnce();
    expect(sent.at(-1)).toContain('/execution_arm LIVE');
    updates.push({ update_id: 2, message: { chat: { id: 42 }, text: '/execution_arm LIVE' } });
    await bot.pollOnce();
    expect(service.isKilled()).toBe(false);
    const scenario = candidate(journal);
    await bot.notifyScannerEvent({ instrumentId: 'sber', observedAt: scenario.observedAt, status: 'candidate-recorded', scenarioId: scenario.id, reasons: [] });
    expect(button).toBe(`exec:approve:${scenario.id}:confirm`);
    updates.push({ update_id: 3, callback_query: { id: 'cb', data: button, message: { chat: { id: 42 } } } });
    await bot.pollOnce();
    expect(ordersClient.postLimitOrder).toHaveBeenCalledOnce();
    expect(ordersClient.postStopLimit).toHaveBeenCalledOnce();
    expect(sent.at(-1)).toContain('Защитный стоп подтверждён');
    updates.push({ update_id: 4, message: { chat: { id: 42 }, text: '/kill' } });
    await bot.pollOnce();
    expect(sent.at(-1)).toContain('Уже открытая позиция');
    expect(service.isKilled()).toBe(true);
    updates.push({ update_id: 5, callback_query: { id: 'cb2', data: button, message: { chat: { id: 42 } } } });
    await bot.pollOnce();
    expect(ordersClient.postLimitOrder).toHaveBeenCalledOnce();
    expect(sent.at(-1)).toContain('стоп включён');
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import type { IntradayScanEvent } from '../scanner/intraday-scanner.js';
import type { TelegramClient, TelegramUpdate } from './client.js';
import { TelegramTradingBot } from './bot.js';

const temporaryDirectories: string[] = [];

function createJournal() {
  const directory = mkdtempSync(join(tmpdir(), 'andstrel-telegram-'));
  temporaryDirectories.push(directory);
  return new ScenarioJournal(join(directory, 'journal.sqlite'));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('TelegramTradingBot', () => {
  it('reconciles only allowlisted exact requests and never submits on that command', async () => {
    const client: TelegramClient = { getUpdates: async () => [
      { update_id: 1, message: { chat: { id: 7 }, text: '/reconcile 17' } },
      { update_id: 2, message: { chat: { id: 42 }, text: '/reconcile invalid' } },
      { update_id: 3, message: { chat: { id: 42 }, text: '/reconcile 17 extra' } },
      { update_id: 4, message: { chat: { id: 42 }, text: '/reconcile 17' } },
    ], sendMessage: vi.fn(), sendPhoto: vi.fn() };
    const execution = { mode: () => 'sandbox', isConfigured: () => true, isReady: () => true, isKilled: () => true,
      armSandbox: vi.fn(), kill: vi.fn(), queueScenario: vi.fn(), rejectScenario: vi.fn(), listRecent: () => [], submitScenario: vi.fn(),
      reconcileScenario: vi.fn().mockResolvedValue({ executionStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsExecuted: 5, order: { lots: 5 } }) };
    const scanner = { isPaused: () => false, pause: vi.fn(), resume: vi.fn() };
    const bot = new TelegramTradingBot(loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: '42' }), client, scanner, createJournal(), () => undefined, undefined, execution);
    await bot.pollOnce();
    expect(execution.reconcileScenario).toHaveBeenCalledOnce();
    expect(execution.reconcileScenario).toHaveBeenCalledWith(17);
    expect(execution.submitScenario).not.toHaveBeenCalled();
    expect(client.sendMessage).toHaveBeenLastCalledWith('42', expect.stringContaining('Новая заявка не отправлялась'));
  });
  it('announces each menu phase once to private IDs and retries a failed menu update', async () => {
    const journal = createJournal();
    const base = { TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_ALLOWED_CHAT_IDS: '42,-9' };
    const client: TelegramClient = { getUpdates: async () => [], sendMessage: vi.fn(), sendPhoto: vi.fn(),
      setChatMenuButton: vi.fn().mockRejectedValueOnce(new Error('not available')).mockResolvedValue(undefined) };
    const scanner = { isPaused: () => false, pause: vi.fn(), resume: vi.fn() };
    const buttons = new TelegramTradingBot(loadConfig(base), client, scanner, journal, () => undefined);
    await buttons.announceMenu(); await buttons.announceMenu();
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    const app = new TelegramTradingBot(loadConfig({ ...base, TELEGRAM_MINI_APP_ENABLED: 'true',
      TELEGRAM_MINI_APP_URL: 'https://bot.brewnote.net' }), client, scanner, journal, () => undefined);
    await app.announceMenu();
    expect(journal.getRuntimeState('telegram.menu.v1.miniapp.42')).toBeNull();
    await app.announceMenu(); await app.announceMenu();
    expect(client.sendMessage).toHaveBeenCalledTimes(3);
    expect(client.setChatMenuButton).toHaveBeenCalledTimes(2);
    expect(client.setChatMenuButton).toHaveBeenLastCalledWith('42', 'https://bot.brewnote.net');
    expect(journal.getRuntimeState('telegram.menu.v1.miniapp.-9')).toBeNull();
  });
  it('shows buttons and launches the Mini App only for an allowed private chat', async () => {
    const config = loadConfig({ TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_ALLOWED_CHAT_IDS: '42,-9',
      TELEGRAM_MINI_APP_ENABLED: 'true', TELEGRAM_MINI_APP_URL: 'https://bot.brewnote.net' });
    const client: TelegramClient = { getUpdates: async () => [
      { update_id: 1, message: { chat: { id: 7, type: 'private' }, text: '📱 Мини-приложение' } },
      { update_id: 2, message: { chat: { id: 42, type: 'private' }, text: '/menu' } },
      { update_id: 3, message: { chat: { id: 42, type: 'private' }, text: '📱 Мини-приложение' } },
      { update_id: 4, message: { chat: { id: -9, type: 'group' }, text: '📱 Мини-приложение' } },
      { update_id: 5, message: { chat: { id: 42, type: 'private' }, text: '⏸ Пауза' } },
    ], sendMessage: vi.fn(), sendPhoto: vi.fn() };
    const scanner = { isPaused: () => false, pause: vi.fn(), resume: vi.fn() };
    const bot = new TelegramTradingBot(config, client, scanner, createJournal(), () => undefined);
    await bot.pollOnce();
    expect(client.sendMessage).toHaveBeenCalledTimes(4);
    expect(client.sendMessage).toHaveBeenNthCalledWith(1, '42', expect.any(String), expect.objectContaining({ replyMarkup: expect.objectContaining({ is_persistent: true }) }));
    expect(client.sendMessage).toHaveBeenNthCalledWith(2, '42', expect.any(String), { replyMarkup: { inline_keyboard: [[{ text: 'Открыть Mini App', web_app: { url: 'https://bot.brewnote.net' } }]] } });
    expect(client.sendMessage).toHaveBeenNthCalledWith(3, '-9', expect.stringContaining('личного чата'));
    expect(scanner.pause).toHaveBeenCalledTimes(1);
  });
  it('shows approved limits but checks the live account only for an allowed chat', async () => {
    const journal = createJournal();
    const config = loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: '42' });
    const sent: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [
        { update_id: 1, message: { chat: { id: 7 }, text: '/pilot_check' } },
        { update_id: 2, message: { chat: { id: 42 }, text: '/pilot' } },
        { update_id: 3, message: { chat: { id: 42 }, text: '/pilot_check' } },
      ],
      sendMessage: async (_chatId, text) => { sent.push(text); }, sendPhoto: async () => undefined,
    };
    const pilot = { check: vi.fn().mockResolvedValue({ liveSubmissionAllowed: false, accountChecksPassed: false, availableCashRub: null, blockers: ['Не задан отдельный live-токен.'] }) };
    const scanner = { isPaused: () => false, pause: () => undefined, resume: () => undefined };
    const bot = new TelegramTradingBot(config, client, scanner, journal, () => undefined, undefined, undefined, pilot);
    await bot.pollOnce();
    expect(pilot.check).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('20 ₽/сделка; 60 ₽/день');
    expect(sent[0]).toContain('Реальные заявки недоступны');
    expect(sent[1]).toContain('не пройдена');
  });
  it('accepts only allowlisted commands and persists the update offset', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
    });
    const sent: Array<{ chatId: string; text: string }> = [];
    const updates: TelegramUpdate[] = [
      { update_id: 10, message: { chat: { id: 42 }, text: '/pause' } },
      { update_id: 11, message: { chat: { id: 7 }, text: '/status' } },
      { update_id: 12, message: { chat: { id: 42 }, text: '/status' } },
    ];
    const client: TelegramClient = {
      getUpdates: async () => updates.splice(0),
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      sendPhoto: async () => undefined,
    };
    let paused = false;
    const scanner = {
      isPaused: () => paused,
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
    };
    const bot = new TelegramTradingBot(config, client, scanner, journal, () => undefined);

    await bot.pollOnce();

    expect(paused).toBe(true);
    expect(journal.getTelegramUpdateOffset()).toBe(13);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.text).toContain('паузу');
    expect(sent[1]?.text).toContain('Сканер: пауза');
  });

  it('returns the last market scan with counts and ranked near-misses', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
    });
    const sent: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [{ update_id: 1, message: { chat: { id: 42 }, text: '/market' } }],
      sendMessage: async (_chatId, text) => {
        sent.push(text);
      },
      sendPhoto: async () => undefined,
    };
    const scanner = {
      isPaused: () => false,
      pause: () => undefined,
      resume: () => undefined,
      getLatestReport: () => ({
        observedAt: '2026-09-19T10:00:00.000Z',
        universe: {
          source: 'moex-liquid' as const,
          refreshedAt: '2026-09-19T09:00:00.000Z',
          requested: 26,
          active: 25,
          missingTickers: ['TRNFP'],
        },
        scanned: 25,
        liquid: 22,
        trendUp: 5,
        volumeConfirmed: 3,
        readyForMarketCheck: 2,
        marketCandidates: 1,
        recordedCandidates: 1,
        errors: 0,
        topRanked: [
          {
            ticker: 'SBER',
            instrumentId: 'sber',
            score: 87,
            trend: 'up' as const,
            relativeVolume: 1.4,
            averageCandleTurnoverRub: 12_000_000,
            candidateReady: true,
            reasons: [],
          },
        ],
      }),
    };
    const bot = new TelegramTradingBot(config, client, scanner, journal, () => undefined);

    await bot.pollOnce();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Проверено: 25');
    expect(sent[0]).toContain('SBER — 87/100');
    expect(sent[0]).toContain('TRNFP');
  });

  it('sends a rendered candidate card only to authorized chats', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
    });
    const scenario = journal.record({
      observedAt: '2026-09-14T13:00:00.000Z',
      strategy: 'intraday',
      instrumentId: 'sber',
      input: {
        side: 'long',
        entryPrice: 100,
        stopPrice: 99,
        targetPrice: 102.5,
        lotSize: 1,
        slippageRate: 0.0005,
      },
      decision: 'candidate',
      blockers: [],
      warnings: [],
      snapshot: {
        tradePlan: {
          lots: 5,
          units: 5,
          positionRub: 500,
          totalRiskRub: 7,
          estimatedCommissionRub: 0.5,
          estimatedSlippageRub: 0.5,
          netRewardRub: 11.5,
          rewardToRisk: 1.64,
        },
        market: { bestBid: 99.99, bestAsk: 100, spreadPct: 0.01 },
        candleAnalysis: { trend: 'up', relativeVolume: 1.2, averageTrueRange14: 0.3 },
      },
    });
    const photos: Array<{ chatId: string; png: Uint8Array; caption: string }> = [];
    const client: TelegramClient = {
      getUpdates: async () => [],
      sendMessage: async () => undefined,
      sendPhoto: async (input) => {
        photos.push(input);
      },
    };
    const scanner = { isPaused: () => false, pause: () => undefined, resume: () => undefined };
    const bot = new TelegramTradingBot(
      config,
      client,
      scanner,
      journal,
      () => undefined,
      async (svg) => {
        expect(svg).toContain('INTRADAY CANDIDATE');
        expect(svg).toContain('SBER');
        expect(svg).toContain('КОМИССИЯ');
        return new Uint8Array([137, 80, 78, 71]);
      },
    );
    const event: IntradayScanEvent = {
      instrumentId: 'sber',
      observedAt: scenario.observedAt,
      status: 'candidate-recorded',
      scenarioId: scenario.id,
      reasons: [],
    };

    await bot.notifyScannerEvent(event);

    expect(photos).toEqual([
      expect.objectContaining({
        chatId: '42',
        caption: expect.stringContaining('Новый кандидат'),
        png: new Uint8Array([137, 80, 78, 71]),
      }),
    ]);
  });

  it('prepares a sandbox order automatically and includes exact Telegram actions', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_EXECUTION_MODE: 'sandbox',
      T_INVEST_TRADING_TOKEN: 'trade-token',
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
    });
    const scenario = journal.record({
      observedAt: '2026-09-14T13:00:00.000Z',
      strategy: 'intraday',
      instrumentId: 'sber',
      input: {
        side: 'long',
        entryPrice: 100,
        stopPrice: 99,
        targetPrice: 102.5,
        lotSize: 1,
        slippageRate: 0.0005,
      },
      decision: 'candidate',
      blockers: [],
      warnings: [],
      snapshot: { tradePlan: { lots: 5, positionRub: 500, totalRiskRub: 7 } },
    });
    const queueScenario = vi.fn().mockReturnValue({ scenarioId: scenario.id });
    const execution = {
      mode: () => 'sandbox',
      isConfigured: () => true,
      isReady: () => true,
      isKilled: () => false,
      armSandbox: vi.fn(),
      kill: vi.fn(),
      queueScenario,
      rejectScenario: vi.fn(),
      listRecent: () => [],
      submitScenario: vi.fn(),
      reconcileScenario: vi.fn(),
    };
    const photos: Array<{ caption: string; callbackData?: string }> = [];
    const client: TelegramClient = {
      getUpdates: async () => [],
      sendMessage: async () => undefined,
      sendPhoto: async ({ caption, replyMarkup }) => {
        const callbackData = replyMarkup?.inline_keyboard[0]?.[0]?.callback_data;
        photos.push({
          caption,
          ...(callbackData ? { callbackData } : {}),
        });
      },
    };
    const scanner = { isPaused: () => false, pause: () => undefined, resume: () => undefined };
    const bot = new TelegramTradingBot(
      config,
      client,
      scanner,
      journal,
      () => undefined,
      async () => new Uint8Array([137, 80, 78, 71]),
      execution,
    );

    await bot.notifyScannerEvent({
      instrumentId: 'sber',
      observedAt: scenario.observedAt,
      status: 'candidate-recorded',
      scenarioId: scenario.id,
      reasons: [],
    });

    expect(queueScenario).toHaveBeenCalledWith(scenario);
    expect(photos).toEqual([
      {
        caption: expect.stringContaining(`/approve ${scenario.id} CONFIRM или /reject ${scenario.id}`),
        callbackData: `exec:approve:${scenario.id}:confirm`,
      },
    ]);
  });

  it('falls back to text when card rendering fails', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_EXECUTION_MODE: 'sandbox',
      T_INVEST_TRADING_TOKEN: 'trade-token',
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
    });
    const scenario = journal.record({
      observedAt: '2026-09-14T13:00:00.000Z',
      strategy: 'intraday',
      instrumentId: 'sber',
      input: {
        side: 'long',
        entryPrice: 100,
        stopPrice: 99,
        targetPrice: 102.5,
        lotSize: 1,
        slippageRate: 0.0005,
      },
      decision: 'candidate',
      blockers: [],
      warnings: [],
      snapshot: {},
    });
    const sent: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [],
      sendMessage: async (_chatId, text) => {
        sent.push(text);
      },
      sendPhoto: async () => undefined,
    };
    const scanner = { isPaused: () => false, pause: () => undefined, resume: () => undefined };
    const execution = {
      mode: () => 'sandbox',
      isConfigured: () => true,
      isReady: () => true,
      isKilled: () => false,
      armSandbox: vi.fn(),
      kill: vi.fn(),
      queueScenario: vi.fn().mockReturnValue({ scenarioId: scenario.id }),
      rejectScenario: vi.fn(),
      listRecent: () => [],
      submitScenario: vi.fn(),
      reconcileScenario: vi.fn(),
    };
    const bot = new TelegramTradingBot(
      config,
      client,
      scanner,
      journal,
      () => undefined,
      async () => {
        throw new Error('renderer unavailable');
      },
      execution,
    );

    await bot.notifyScannerEvent({
      instrumentId: 'sber',
      observedAt: scenario.observedAt,
      status: 'candidate-recorded',
      scenarioId: scenario.id,
      reasons: [],
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Карточка не сформировалась');
    expect(sent[0]).toContain(`/approve ${scenario.id} CONFIRM или /reject ${scenario.id}`);
  });

  it('sends a clearly labelled non-market preview card', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
    });
    const photos: Array<{ chatId: string; caption: string }> = [];
    const client: TelegramClient = {
      getUpdates: async () => [{ update_id: 1, message: { chat: { id: 42 }, text: '/preview' } }],
      sendMessage: async () => undefined,
      sendPhoto: async (input) => {
        photos.push({ chatId: input.chatId, caption: input.caption });
      },
    };
    const scanner = { isPaused: () => false, pause: () => undefined, resume: () => undefined };
    const bot = new TelegramTradingBot(
      config,
      client,
      scanner,
      journal,
      () => undefined,
      async () => new Uint8Array([137, 80, 78, 71]),
    );

    await bot.pollOnce();

    expect(photos).toEqual([
      expect.objectContaining({
        chatId: '42',
        caption: expect.stringContaining('Тестовая карточка'),
      }),
    ]);
  });

  it('requires explicit sandbox arming and per-order confirmation commands', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
    });
    const sent: string[] = [];
    const updates: TelegramUpdate[] = [
      { update_id: 1, message: { chat: { id: 42 }, text: '/execution_arm SANDBOX' } },
      { update_id: 2, message: { chat: { id: 42 }, text: '/approve 17 CONFIRM' } },
      { update_id: 3, message: { chat: { id: 42 }, text: '/kill' } },
    ];
    const client: TelegramClient = {
      getUpdates: async () => updates.splice(0),
      sendMessage: async (_chatId, text) => {
        sent.push(text);
      },
      sendPhoto: async () => undefined,
    };
    const scanner = { isPaused: () => false, pause: () => undefined, resume: () => undefined };
    const armSandbox = vi.fn();
    const kill = vi.fn();
    const submitScenario = vi.fn().mockResolvedValue({
      order: { lots: 5 },
      executionStatus: 'EXECUTION_REPORT_STATUS_FILL',
      lotsExecuted: 5,
    });
    const execution = {
      mode: () => 'sandbox',
      isConfigured: () => true,
      isReady: () => true,
      isKilled: () => false,
      armSandbox,
      kill,
      queueScenario: vi.fn(),
      rejectScenario: vi.fn(),
      listRecent: () => [],
      submitScenario,
      reconcileScenario: vi.fn(),
    };
    const bot = new TelegramTradingBot(
      config,
      client,
      scanner,
      journal,
      () => undefined,
      async () => new Uint8Array(),
      execution,
    );

    await bot.pollOnce();

    expect(armSandbox).toHaveBeenCalledOnce();
    expect(submitScenario).toHaveBeenCalledWith(17, '42');
    expect(kill).toHaveBeenCalledOnce();
    expect(sent.some((message) => message.includes('Sandbox-заявка #17'))).toBe(true);
  });

  it('accepts an allowlisted sandbox approval button', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
    });
    const answers: Array<{ callbackId: string; text: string }> = [];
    const sent: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [
        {
          update_id: 1,
          callback_query: {
            id: 'callback-1',
            data: 'exec:approve:17:confirm',
            message: { chat: { id: 42 } },
          },
        },
      ],
      sendMessage: async (_chatId, text) => {
        sent.push(text);
      },
      sendPhoto: async () => undefined,
      answerCallbackQuery: async (callbackId, text) => {
        answers.push({ callbackId, text });
      },
    };
    const scanner = { isPaused: () => false, pause: () => undefined, resume: () => undefined };
    const submitScenario = vi.fn().mockResolvedValue({
      order: { lots: 5 },
      executionStatus: 'EXECUTION_REPORT_STATUS_FILL',
      lotsExecuted: 5,
    });
    const execution = {
      mode: () => 'sandbox',
      isConfigured: () => true,
      isReady: () => true,
      isKilled: () => false,
      armSandbox: vi.fn(),
      kill: vi.fn(),
      queueScenario: vi.fn(),
      rejectScenario: vi.fn(),
      listRecent: () => [],
      submitScenario,
      reconcileScenario: vi.fn(),
    };
    const bot = new TelegramTradingBot(
      config,
      client,
      scanner,
      journal,
      () => undefined,
      async () => new Uint8Array(),
      execution,
    );

    await bot.pollOnce();

    expect(answers).toEqual([{ callbackId: 'callback-1', text: 'Проверяю и отправляю…' }]);
    expect(submitScenario).toHaveBeenCalledWith(17, '42');
    expect(sent[0]).toContain('Sandbox-заявка #17');
  });

});

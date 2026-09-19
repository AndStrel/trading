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

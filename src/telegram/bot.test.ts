import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('lists paper commands in help', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
    });
    const sent: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [{ update_id: 1, message: { chat: { id: 42 }, text: '/help' } }],
      sendMessage: async (_chatId, text) => {
        sent.push(text);
      },
      sendPhoto: async () => undefined,
    };
    const scanner = { isPaused: () => false, pause: () => undefined, resume: () => undefined };
    const bot = new TelegramTradingBot(config, client, scanner, journal, () => undefined);
    await bot.pollOnce();
    expect(sent[0]).toContain('/paper');
    expect(sent[0]).toContain('/dual');
    expect(sent[0]).toContain('/sleeve');
  });

  it('reports paper dual momentum from mounted snapshot files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'andstrel-paper-snapshots-'));
    temporaryDirectories.push(directory);
    const rows = [
      { day: '2022-01-03', open: 100, high: 100, low: 100, close: 100, volume: 1 },
      { day: '2022-01-04', open: 101, high: 101, low: 101, close: 101, volume: 1 },
    ];
    const snapshot = { rowsSha256: 'test', rows };
    for (const name of ['sbmx', 'sbgb', 'sbmm']) {
      writeFileSync(join(directory, `${name}-daily-2021-2025.json`), JSON.stringify(snapshot));
    }
    const previous = process.env.T_INVEST_PAPER_SNAPSHOT_DIR;
    process.env.T_INVEST_PAPER_SNAPSHOT_DIR = directory;
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
    });
    const sent: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [{ update_id: 1, message: { chat: { id: 42 }, text: '/dual' } }],
      sendMessage: async (_chatId, text) => {
        sent.push(text);
      },
      sendPhoto: async () => undefined,
    };
    const scanner = { isPaused: () => false, pause: () => undefined, resume: () => undefined };
    const bot = new TelegramTradingBot(config, client, scanner, journal, () => undefined);
    try {
      await bot.pollOnce();
    } finally {
      if (previous === undefined) delete process.env.T_INVEST_PAPER_SNAPSHOT_DIR;
      else process.env.T_INVEST_PAPER_SNAPSHOT_DIR = previous;
    }
    expect(sent[0]).toContain('Paper dual momentum');
    expect(sent[0]).toContain('Заявок брокеру нет');
  });

  it('combines sleeve and dual momentum in /paper', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'andstrel-paper-summary-'));
    temporaryDirectories.push(directory);
    const rows = [
      { day: '2022-01-03', open: 100, high: 100, low: 100, close: 100, volume: 1 },
      { day: '2022-01-04', open: 101, high: 101, low: 101, close: 101, volume: 1 },
    ];
    const snapshot = { rowsSha256: 'test', rows };
    for (const name of ['sbmx', 'sbgb', 'sbmm']) {
      writeFileSync(join(directory, `${name}-daily-2021-2025.json`), JSON.stringify(snapshot));
    }
    const previous = process.env.T_INVEST_PAPER_SNAPSHOT_DIR;
    process.env.T_INVEST_PAPER_SNAPSHOT_DIR = directory;
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
    });
    const sent: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [{ update_id: 1, message: { chat: { id: 42 }, text: '/paper' } }],
      sendMessage: async (_chatId, text) => {
        sent.push(text);
      },
      sendPhoto: async () => undefined,
    };
    const scanner = { isPaused: () => false, pause: () => undefined, resume: () => undefined };
    const bot = new TelegramTradingBot(config, client, scanner, journal, () => undefined);
    try {
      await bot.pollOnce();
    } finally {
      if (previous === undefined) delete process.env.T_INVEST_PAPER_SNAPSHOT_DIR;
      else process.env.T_INVEST_PAPER_SNAPSHOT_DIR = previous;
    }
    expect(sent[0]).toContain('Admitted paper-only');
    expect(sent[0]).toContain('Paper cash sleeve: не открыт');
    expect(sent[0]).toContain('Paper dual momentum');
  });

  it('reports an empty paper cash sleeve without contacting the broker', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
    });
    const sent: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [{ update_id: 1, message: { chat: { id: 42 }, text: '/sleeve' } }],
      sendMessage: async (_chatId, text) => {
        sent.push(text);
      },
      sendPhoto: async () => undefined,
    };
    const scanner = { isPaused: () => false, pause: () => undefined, resume: () => undefined };
    const bot = new TelegramTradingBot(config, client, scanner, journal, () => undefined);
    await bot.pollOnce();
    expect(sent[0]).toContain('Paper cash sleeve: не открыт');
    expect(sent[0]).toContain('Заявок брокеру нет');
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

  it('covers resume, execution, orders, candidates, reject, and open sleeve replies', async () => {
    const journal = createJournal();
    journal.openPaperCashSleeve({
      instrumentId: 'figi-lqdt',
      principal: 1_000_000,
      openPrice: 100,
      day: '2025-01-06',
    });
    journal.markPaperCashSleeve({ markPrice: 105, day: '2025-06-30' });
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
    });
    const sent: string[] = [];
    let paused = true;
    const updates: TelegramUpdate[] = [
      { update_id: 1, message: { chat: { id: 42 }, text: '/resume' } },
      { update_id: 2, message: { chat: { id: 42 }, text: '/execution' } },
      { update_id: 3, message: { chat: { id: 42 }, text: '/orders' } },
      { update_id: 4, message: { chat: { id: 42 }, text: '/candidates' } },
      { update_id: 5, message: { chat: { id: 42 }, text: '/reject 9' } },
      { update_id: 6, message: { chat: { id: 42 }, text: '/sleeve' } },
    ];
    const client: TelegramClient = {
      getUpdates: async () => updates.splice(0, 1),
      sendMessage: async (_chatId, text) => {
        sent.push(text);
      },
      sendPhoto: async () => undefined,
    };
    const scanner = {
      isPaused: () => paused,
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
    };
    const rejectScenario = vi.fn();
    const execution = {
      mode: () => 'sandbox',
      isConfigured: () => true,
      isReady: () => true,
      isKilled: () => false,
      armSandbox: vi.fn(),
      kill: vi.fn(),
      queueScenario: vi.fn(),
      rejectScenario,
      listRecent: () => [
        {
          id: 1,
          scenarioId: 3,
          mode: 'sandbox' as const,
          status: 'pending' as const,
          instrumentId: 'sber',
          side: 'long' as const,
          lots: 2,
          limitPrice: 250.5,
          estimatedRiskRub: 1200,
          orderRequestId: 'req-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      submitScenario: vi.fn(),
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

    for (let index = 0; index < 6; index += 1) {
      await bot.pollOnce();
    }

    expect(paused).toBe(false);
    expect(sent[0]).toContain('Сканер снова активен');
    expect(sent[1]).toContain('Исполнение: sandbox');
    expect(sent[2]).toContain('Последние sandbox-поручения');
    expect(sent[2]).toContain('#3');
    expect(sent[3]).toContain('intraday-кандидатов');
    expect(rejectScenario).toHaveBeenCalledWith(9, '42');
    expect(sent[5]).toContain('Paper cash sleeve LQDT: открыт');
  });

});

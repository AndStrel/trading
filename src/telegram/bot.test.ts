import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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

  it('falls back to text when card rendering fails', async () => {
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
    const bot = new TelegramTradingBot(
      config,
      client,
      scanner,
      journal,
      () => undefined,
      async () => {
        throw new Error('renderer unavailable');
      },
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

});

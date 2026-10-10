import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from './config.js';
import { ScenarioJournal, type ExecutionOrderRecord } from './journal/scenario-journal.js';
import { TelegramTradingBot } from './telegram/bot.js';
import type { TelegramClient, TelegramUpdate } from './telegram/client.js';

const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'telegram-bot-smoke-'));
  try {
    const journal = new ScenarioJournal(join(directory, 'journal.sqlite'));
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'smoke-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
    });
    const sent: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [],
      sendMessage: async (_chatId, text) => {
        sent.push(text);
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
      getLatestReport: () => ({
        observedAt: '2026-09-19T10:00:00.000Z',
        universe: {
          source: 'moex-liquid' as const,
          refreshedAt: '2026-09-19T09:00:00.000Z',
          requested: 1,
          active: 1,
          missingTickers: [],
        },
        scanned: 1,
        liquid: 1,
        trendUp: 1,
        volumeConfirmed: 1,
        readyForMarketCheck: 1,
        marketCandidates: 0,
        recordedCandidates: 0,
        errors: 0,
        topRanked: [],
      }),
    };
    const sampleOrder: ExecutionOrderRecord = {
      id: 1,
      scenarioId: 9,
      mode: 'sandbox',
      status: 'pending',
      instrumentId: 'sber',
      side: 'long',
      lots: 1,
      limitPrice: 100,
      estimatedRiskRub: 10,
      orderRequestId: 'smoke',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const execution = {
      mode: () => 'sandbox',
      isConfigured: () => true,
      isReady: () => true,
      isKilled: () => false,
      armSandbox: async () => undefined,
      kill: () => undefined,
      queueScenario: () => null,
      rejectScenario: () => ({ ...sampleOrder, status: 'rejected' as const }),
      listRecent: () => [],
      submitScenario: async () => ({
        order: sampleOrder,
        executionStatus: 'EXECUTION_REPORT_STATUS_FILL',
        lotsExecuted: 1,
      }),
    };
    const bot = new TelegramTradingBot(
      config,
      client,
      scanner,
      journal,
      () => undefined,
      async () => pngSignature,
      execution,
    );

    const commands = [
      '/help',
      '/status',
      '/market',
      '/candidates',
      '/preview',
      '/pause',
      '/resume',
      '/execution',
      '/orders',
      '/paper',
      '/sleeve',
      '/dual',
      '/execution_arm SANDBOX',
      '/reject 9',
      '/kill',
    ];

    let updateId = 1;
    let dualReply = '';
    for (const text of commands) {
      sent.length = 0;
      const updates: TelegramUpdate[] = [{ update_id: updateId++, message: { chat: { id: 42 }, text } }];
      client.getUpdates = async () => updates.splice(0);
      await bot.pollOnce();
      if (sent.length === 0 && text !== '/preview') {
        throw new Error(`Command produced no reply: ${text}`);
      }
      if (text === '/dual') dualReply = sent.at(-1) ?? '';
    }

    const snapshotDir = process.env.T_INVEST_PAPER_SNAPSHOT_DIR?.trim();
    if (snapshotDir) {
      if (!dualReply.includes('Paper dual momentum')) {
        throw new Error('/dual reply did not mention paper dual momentum');
      }
      if (dualReply.includes('нет локальных дневных снимков')) {
        throw new Error(`/dual expected snapshots under ${snapshotDir}`);
      }
    }

    process.stdout.write(`Telegram bot command smoke passed: ${commands.length} commands\n`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

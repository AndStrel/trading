import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import type { IntradayScanEvent } from '../scanner/intraday-scanner.js';
import type { TelegramClient, TelegramUpdate } from './client.js';
import { entryHoursNote, TelegramTradingBot } from './bot.js';
import type { TradingSelection } from '../strategies/selection.js';
import type { AssetRecommendation } from '../scanner/intraday-scanner.js';

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
  it('shows strategy buttons only for authorized chats and includes the current revision', async () => {
    const client: TelegramClient = { getUpdates: async () => [
      { update_id: 1, message: { chat: { id: 7 }, text: '/strategies' } },
      { update_id: 2, message: { chat: { id: 42 }, text: '🧭 Стратегии' } },
    ], sendMessage: vi.fn(), sendPhoto: vi.fn() };
    const scanner = { isPaused: () => false, pause: vi.fn(), resume: vi.fn(),
      getTradingSelection: () => ({ strategyId: 'trend-momentum-v1' as const, revision: 3, tickers: ['VTBR'] }),
      selectTradingStrategy: vi.fn() };
    await new TelegramTradingBot(loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: '42' }), client, scanner, createJournal(), () => undefined).pollOnce();
    expect(client.sendMessage).toHaveBeenCalledOnce();
    expect(client.sendMessage).toHaveBeenCalledWith('42', expect.stringContaining('Выберите торговый подход'), {
      replyMarkup: { inline_keyboard: expect.arrayContaining([
        [{ text: '✓ Тренд и объём', callback_data: 'strategy:trend-momentum-v1:3' }],
        [{ text: 'Возврат выше VWAP', callback_data: 'strategy:vwap-reclaim-v1:3' }],
      ]) },
    });
    expect(scanner.selectTradingStrategy).not.toHaveBeenCalled();
  });

  it('logs a completed poll without update contents', async () => {
    const logs: string[] = [];
    const client: TelegramClient = { getUpdates: async () => [], sendMessage: vi.fn(), sendPhoto: vi.fn() };
    const scanner = { isPaused: () => false, pause: () => undefined, resume: () => undefined };
    await new TelegramTradingBot(loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: '42' }), client, scanner, createJournal(), (message) => logs.push(message)).pollOnce();
    expect(logs).toEqual(['Telegram poll ok: updates=0']);
  });

  it('authorizes strategy callbacks and prevents stale buttons or malformed revisions from changing selection', async () => {
    let selection: TradingSelection = { strategyId: 'trend-momentum-v1', revision: 3, tickers: ['VTBR'] };
    const scanner = { isPaused: () => false, pause: vi.fn(), resume: vi.fn(), getTradingSelection: () => selection,
      selectTradingStrategy: vi.fn((id: TradingSelection['strategyId'], revision: number) => {
        if (revision !== selection.revision) throw new Error('private-error-marker');
        selection = { ...selection, strategyId: id, revision: revision + 1 };
      }) };
    const updates: TelegramUpdate[] = [
      { update_id: 1, callback_query: { id: 'denied', data: 'strategy:vwap-reclaim-v1:3', message: { chat: { id: 7 } } } },
      { update_id: 2, callback_query: { id: 'valid', data: 'strategy:vwap-reclaim-v1:3', message: { chat: { id: 42 } } } },
      { update_id: 3, callback_query: { id: 'stale', data: 'strategy:opening-range-breakout-v1:3', message: { chat: { id: 42 } } } },
      ...['strategy:unknown:4', 'strategy:trend-momentum-v1:0', 'strategy:trend-momentum-v1:03', 'strategy:trend-momentum-v1:9007199254740992', 'strategy:trend-momentum-v1:4:extra'].map((data, index) => ({
        update_id: index + 4, callback_query: { id: `malformed-${index}`, data, message: { chat: { id: 42 } } },
      })),
    ];
    const client: TelegramClient = { getUpdates: async () => updates, sendMessage: vi.fn(), sendPhoto: vi.fn(), answerCallbackQuery: vi.fn() };
    await new TelegramTradingBot(loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: '42' }), client, scanner, createJournal(), () => undefined).pollOnce();
    expect(selection).toEqual({ strategyId: 'vwap-reclaim-v1', revision: 4, tickers: ['VTBR'] });
    expect(scanner.selectTradingStrategy).toHaveBeenCalledTimes(2);
    expect(client.answerCallbackQuery).toHaveBeenCalledWith('denied', 'Нет доступа');
    expect(client.sendMessage).toHaveBeenLastCalledWith('42', expect.stringContaining('настройки уже изменились'));
    expect(JSON.stringify(vi.mocked(client.sendMessage).mock.calls)).not.toContain('private-error-marker');
  });

  it('accepts exact strategy and assets commands for allowed chats without order operations', async () => {
    const scanner = { isPaused: () => false, pause: vi.fn(), resume: vi.fn(),
      getTradingSelection: () => ({ strategyId: 'trend-momentum-v1' as const, revision: 5, tickers: ['VTBR'] }),
      selectTradingStrategy: vi.fn(), selectTradingAssets: vi.fn() };
    const client: TelegramClient = { getUpdates: async () => [
      { update_id: 1, message: { chat: { id: 7 }, text: '/assets IRAO' } },
      { update_id: 2, message: { chat: { id: 42 }, text: '/strategy vwap-reclaim-v1' } },
      { update_id: 3, message: { chat: { id: 42 }, text: '/assets vtbr,irao' } },
      { update_id: 4, message: { chat: { id: 42 }, text: '/assets VTBR,VTBR' } },
      { update_id: 5, message: { chat: { id: 42 }, text: '/assets VTBR IRAO' } },
    ], sendMessage: vi.fn(), sendPhoto: vi.fn() };
    const execution = { mode: () => 'sandbox', isConfigured: () => true, isReady: () => true, isKilled: () => true,
      armSandbox: vi.fn(), kill: vi.fn(), queueScenario: vi.fn(), rejectScenario: vi.fn(), listRecent: () => [], submitScenario: vi.fn(), reconcileScenario: vi.fn() };
    await new TelegramTradingBot(loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: '42' }), client, scanner, createJournal(), () => undefined, undefined, execution).pollOnce();
    expect(scanner.selectTradingStrategy).toHaveBeenCalledExactlyOnceWith('vwap-reclaim-v1', 5);
    expect(scanner.selectTradingAssets).toHaveBeenCalledExactlyOnceWith(['VTBR', 'IRAO'], 5);
    expect(execution.submitScenario).not.toHaveBeenCalled();
    expect(execution.armSandbox).not.toHaveBeenCalled();
    expect(execution.queueScenario).not.toHaveBeenCalled();
  });

  it('offers the Mini App asset picker only in an allowed private chat', async () => {
    const client: TelegramClient = { getUpdates: async () => [
      { update_id: 1, message: { chat: { id: 42, type: 'private' }, text: '🎯 Активы' } },
      { update_id: 2, message: { chat: { id: -9, type: 'group' }, text: '/assets' } },
    ], sendMessage: vi.fn(), sendPhoto: vi.fn() };
    const scanner = { isPaused: () => false, pause: vi.fn(), resume: vi.fn(),
      getTradingSelection: () => ({ strategyId: 'trend-momentum-v1' as const, revision: 1, tickers: ['VTBR'] }), getAvailableTickers: () => ['VTBR', 'IRAO'] };
    const config = loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: '42,-9', TELEGRAM_BOT_TOKEN: 'test',
      TELEGRAM_MINI_APP_ENABLED: 'true', TELEGRAM_MINI_APP_URL: 'https://bot.brewnote.net' });
    await new TelegramTradingBot(config, client, scanner, createJournal(), () => undefined).pollOnce();
    expect(client.sendMessage).toHaveBeenNthCalledWith(1, '42', expect.stringContaining('Текущие активы: VTBR'), {
      replyMarkup: { inline_keyboard: [[{ text: 'Выбрать активы в панели', web_app: { url: 'https://bot.brewnote.net' } }]] },
    });
    expect(client.sendMessage).toHaveBeenNthCalledWith(2, '-9', expect.any(String), { replyMarkup: expect.objectContaining({ is_persistent: true }) });
  });

  it('explains recommendation states and costs and hides a report after selection changes', async () => {
    let revision = 2;
    const recommendations: AssetRecommendation[] = (['signal', 'wait', 'blocked', 'error'] as const).map((status, index) => ({
      ticker: ['VTBR', 'IRAO', 'SBER', 'GAZP'][index]!, instrumentId: 'hidden-instrument', status, score: 80 - index,
      reasons: ['Проверяемая причина'], lotCostRub: 52, roundTripCostsRub: 0.37, totalRiskRub: 3, netRewardRub: 7,
      entryPrice: 52, stopPrice: 51, targetPrice: 55,
    }));
    const scanner = { isPaused: () => false, pause: vi.fn(), resume: vi.fn(),
      getTradingSelection: () => ({ strategyId: 'trend-momentum-v1' as const, revision, tickers: ['VTBR', 'IRAO'] }),
      getLatestReport: () => ({ strategyId: 'trend-momentum-v1' as const, selectionRevision: 2, recommendations,
        observedAt: '2026-10-03T07:00:00Z', universe: { source: 'moex-liquid' as const, refreshedAt: '2026-10-03T07:00:00Z', requested: 2, active: 2, missingTickers: [] },
        scanned: 2, liquid: 2, trendUp: 1, volumeConfirmed: 1, readyForMarketCheck: 1, marketCandidates: 1, recordedCandidates: 1, errors: 0, topRanked: [] }) };
    const client: TelegramClient = { getUpdates: async () => [{ update_id: revision, message: { chat: { id: 42 }, text: '/recommendations' } }], sendMessage: vi.fn(), sendPhoto: vi.fn() };
    const bot = new TelegramTradingBot(loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: '42' }), client, scanner, createJournal(), () => undefined);
    await bot.pollOnce();
    const first = vi.mocked(client.sendMessage).mock.calls[0]![1];
    expect(first).toContain('Тренд и объём');
    expect(first).toContain('сигнал для проверки'); expect(first).toContain('наблюдать');
    expect(first).toContain('пропустить'); expect(first).toContain('ошибка данных');
    expect(first).toContain('затраты круга: 0.37 ₽'); expect(first).toContain('Расчётный риск: 3 ₽');
    expect(first).toContain('Проверяемая причина');
    expect(first).not.toContain('hidden-instrument');
    revision = 3;
    await bot.pollOnce();
    expect(client.sendMessage).toHaveBeenLastCalledWith('42', expect.stringContaining('Дождитесь нового прохода рынка'));
  });

  it('explains a lot that does not fit the daily risk limit in Russian', async () => {
    const recommendations: AssetRecommendation[] = [{
      ticker: 'SBER', instrumentId: 'hidden-instrument', status: 'blocked', score: 40,
      reasons: ['No whole lot fits the configured risk and position limits'],
      lotCostRub: 3200, roundTripCostsRub: 20, totalRiskRub: 21, netRewardRub: 10,
      entryPrice: 320, stopPrice: 310, targetPrice: 340,
    }];
    const scanner = { isPaused: () => false, pause: vi.fn(), resume: vi.fn(),
      getTradingSelection: () => ({ strategyId: 'trend-momentum-v1' as const, revision: 1, tickers: ['SBER'] }),
      getLatestReport: () => ({ strategyId: 'trend-momentum-v1' as const, selectionRevision: 1, recommendations,
        observedAt: '2026-10-12T07:00:00Z', universe: { source: 'moex-liquid' as const, refreshedAt: '2026-10-12T07:00:00Z', requested: 1, active: 1, missingTickers: [] },
        scanned: 1, liquid: 1, trendUp: 1, volumeConfirmed: 1, readyForMarketCheck: 0, marketCandidates: 0, recordedCandidates: 0, errors: 0, topRanked: [] }) };
    const client: TelegramClient = { getUpdates: async () => [{ update_id: 1, message: { chat: { id: 42 }, text: '/recommendations' } }], sendMessage: vi.fn(), sendPhoto: vi.fn() };
    await new TelegramTradingBot(loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: '42' }), client, scanner, createJournal(), () => undefined).pollOnce();
    const text = vi.mocked(client.sendMessage).mock.calls[0]![1];
    expect(text).toContain('ни один целый лот не помещается');
    expect(text).not.toContain('No whole lot');
    expect(text).not.toContain('hidden-instrument');
  });

  it('says the entry window is closed before the Moscow session', () => {
    expect(entryHoursNote('trend-momentum-v1', 9 * 60 + 10, new Date('2026-10-12T05:00:00.000Z'))).toContain('09:10');
    expect(entryHoursNote('trend-momentum-v1', 9 * 60 + 10, new Date('2026-10-12T05:00:00.000Z'))).toContain('окно закрыто');
    expect(entryHoursNote('trend-momentum-v1', 9 * 60 + 10, new Date('2026-10-12T07:00:00.000Z'))).toBe('');
    expect(entryHoursNote('opening-range-breakout-v1', 9 * 60 + 10, new Date('2026-10-12T06:20:00.000Z'))).toContain('09:40');
  });

  it('includes selected strategy and assets in the market overview before the first scan', async () => {
    const client: TelegramClient = { getUpdates: async () => [{ update_id: 1, message: { chat: { id: 42 }, text: '/market' } }], sendMessage: vi.fn(), sendPhoto: vi.fn() };
    const scanner = { isPaused: () => false, pause: vi.fn(), resume: vi.fn(), getLatestReport: () => null,
      getTradingSelection: () => ({ strategyId: 'vwap-reclaim-v1' as const, revision: 6, tickers: ['VTBR'] }) };
    await new TelegramTradingBot(loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: '42' }), client, scanner, createJournal(), () => undefined).pollOnce();
    expect(client.sendMessage).toHaveBeenCalledWith('42', expect.stringContaining('Стратегия: Возврат выше VWAP · ревизия 6'));
    expect(client.sendMessage).toHaveBeenCalledWith('42', expect.stringContaining('Активы: VTBR'));
  });
  it.each([['-9000000000', '−9,00 ₽'], [null, 'не подтверждён']])('shows scoped sandbox sale result without arming or submitting: %s', async (netPnlNano, displayed) => {
    const client: TelegramClient = { getUpdates: async () => [
      { update_id: 1, message: { chat: { id: 42 }, text: '/reconcile 17' } },
    ], sendMessage: vi.fn(), sendPhoto: vi.fn() };
    const execution = { mode: () => 'sandbox', isConfigured: () => true, isReady: () => true, isKilled: () => true,
      armSandbox: vi.fn(), kill: vi.fn(), queueScenario: vi.fn(), rejectScenario: vi.fn(), listRecent: () => [], submitScenario: vi.fn(),
      reconcileScenario: vi.fn().mockResolvedValue({ executionStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsExecuted: 5, order: { lots: 5, status: 'accepted' },
        sandboxExit: { soldLots: netPnlNano === null ? 2 : 5, remainingLots: netPnlNano === null ? 3 : 0,
          netPnlNano, flatConfirmedAt: netPnlNano === null ? null : '2026-10-01T08:00:00Z' } }) };
    const bot = new TelegramTradingBot(loadConfig({ TELEGRAM_ALLOWED_CHAT_IDS: '42' }), client,
      { isPaused: () => false, pause: vi.fn(), resume: vi.fn() }, createJournal(), () => undefined, undefined, execution);
    await bot.pollOnce();
    expect(client.sendMessage).toHaveBeenLastCalledWith('42', expect.stringContaining(String(displayed)));
    expect(client.sendMessage).toHaveBeenLastCalledWith('42', expect.stringContaining('не реальная доходность'));
    expect(client.sendMessage).toHaveBeenLastCalledWith('42', expect.stringContaining('Резерв риска сохранён'));
    expect(execution.submitScenario).not.toHaveBeenCalled(); expect(execution.armSandbox).not.toHaveBeenCalled();
  });
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
    expect(journal.getRuntimeState('telegram.menu.v2.miniapp.42')).toBeNull();
    await app.announceMenu(); await app.announceMenu();
    expect(client.sendMessage).toHaveBeenCalledTimes(3);
    expect(client.setChatMenuButton).toHaveBeenCalledTimes(2);
    expect(client.setChatMenuButton).toHaveBeenLastCalledWith('42', 'https://bot.brewnote.net');
    expect(journal.getRuntimeState('telegram.menu.v2.miniapp.-9')).toBeNull();
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

  it('says why a candidate did not become an order while execution is disabled', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_EXECUTION_MODE: 'disabled',
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
    });
    const scenario = journal.record({
      observedAt: '2026-09-14T13:00:00.000Z',
      strategy: 'intraday',
      instrumentId: 'sber',
      input: { side: 'long', entryPrice: 100, stopPrice: 99, targetPrice: 102.5, lotSize: 1, slippageRate: 0.0005 },
      decision: 'candidate', blockers: [], warnings: [],
      snapshot: { tradePlan: { lots: 5, positionRub: 500, totalRiskRub: 7 } },
    });
    const queueScenario = vi.fn();
    const photos: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [],
      sendMessage: async () => undefined,
      sendPhoto: async ({ caption, replyMarkup }) => {
        photos.push(caption);
        expect(replyMarkup).toBeUndefined();
      },
    };
    const bot = new TelegramTradingBot(config, client, { isPaused: () => false, pause: () => undefined, resume: () => undefined },
      journal, () => undefined, async () => new Uint8Array([137, 80, 78, 71]),
      { mode: () => 'disabled', isConfigured: () => false, isReady: () => false, isKilled: () => true,
        armSandbox: vi.fn(), kill: vi.fn(), queueScenario, rejectScenario: vi.fn(), listRecent: () => [],
        submitScenario: vi.fn(), reconcileScenario: vi.fn() });
    await bot.notifyScannerEvent({ instrumentId: 'sber', observedAt: scenario.observedAt, status: 'candidate-recorded', scenarioId: scenario.id, reasons: [] });
    expect(queueScenario).not.toHaveBeenCalled();
    expect(photos[0]).toContain('Исполнение выключено');
    expect(photos[0]).toContain('Заявка не готовилась');
  });

  it('shows the next live step and a confirm button on a stored candidate', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_TOKEN: 'read-token',
      T_INVEST_SANDBOX_TOKEN: 'sandbox-token',
      T_INVEST_LIVE_TOKEN: 'live-token',
      T_INVEST_LIVE_ACCOUNT_ID: 'daily-account',
      T_INVEST_EXECUTION_MODE: 'live',
      T_INVEST_INTRADAY_WATCHLIST: '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
    });
    const scenario = journal.record({
      observedAt: new Date().toISOString(), strategy: 'intraday', instrumentId: 'sber',
      input: { side: 'long', entryPrice: 100, stopPrice: 99, targetPrice: 105, lotSize: 1, slippageRate: 0.0005 },
      decision: 'candidate', blockers: [], warnings: [],
      snapshot: { tradePlan: { lots: 5, positionRub: 500, totalRiskRub: 8.49 } },
    });
    const sent: string[] = [];
    const buttons: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [
        { update_id: 1, message: { chat: { id: 42 }, text: '/status' } },
        { update_id: 2, message: { chat: { id: 42 }, text: '/candidates' } },
      ],
      sendMessage: async (_chatId, text) => { sent.push(text); },
      sendPhoto: async ({ caption, replyMarkup }) => {
        sent.push(caption);
        const data = replyMarkup?.inline_keyboard?.[0]?.[0]?.callback_data;
        if (data) buttons.push(data);
      },
    };
    const execution = {
      mode: () => 'live', isConfigured: () => true, isReady: () => true, isKilled: () => true,
      armSandbox: vi.fn(), armLive: vi.fn(), kill: vi.fn(),
      queueScenario: vi.fn().mockReturnValue({ scenarioId: scenario.id }),
      rejectScenario: vi.fn(), listRecent: () => [], submitScenario: vi.fn(), reconcileScenario: vi.fn(),
    };
    const bot = new TelegramTradingBot(config, client, { isPaused: () => false, pause: () => undefined, resume: () => undefined },
      journal, () => undefined, async () => new Uint8Array([137, 80, 78, 71]), execution);
    await bot.pollOnce();
    expect(sent[0]).toContain('/execution_arm LIVE');
    expect(sent[1]).toContain(`/approve ${scenario.id} CONFIRM`);
    expect(buttons).toEqual([`exec:approve:${scenario.id}:confirm`]);
  });

  it('explains a blocked live order in Russian and does not pretend a stopped button sends it', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_TOKEN: 'read-token',
      T_INVEST_SANDBOX_TOKEN: 'sandbox-token',
      T_INVEST_LIVE_TOKEN: 'live-token',
      T_INVEST_LIVE_ACCOUNT_ID: 'daily-account',
      T_INVEST_EXECUTION_MODE: 'live',
    });
    const scenario = journal.record({
      observedAt: new Date().toISOString(), strategy: 'intraday', instrumentId: 'sber',
      input: { side: 'long', entryPrice: 100, stopPrice: 99, targetPrice: 102, lotSize: 1, slippageRate: 0.0005 },
      decision: 'candidate', blockers: [], warnings: [], snapshot: {},
    });
    const captions: string[] = [];
    const answers: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [
        { update_id: 1, message: { chat: { id: 42 }, text: '/candidates' } },
        { update_id: 2, callback_query: { id: 'cb-1', data: `exec:approve:${scenario.id}:confirm`, message: { chat: { id: 42 } } } },
      ],
      sendMessage: async () => undefined,
      sendPhoto: async ({ caption }) => { captions.push(caption); },
      answerCallbackQuery: async (_id, text) => { answers.push(text); },
    };
    const execution = {
      mode: () => 'live', isConfigured: () => true, isReady: () => true, isKilled: () => true,
      armSandbox: vi.fn(), armLive: vi.fn(), kill: vi.fn(),
      queueScenario: vi.fn().mockImplementation(() => { throw new Error('Net reward-to-risk is below 2.0'); }),
      rejectScenario: vi.fn(), listRecent: () => [],
      submitScenario: vi.fn().mockRejectedValue(new Error('Execution kill switch is active')),
      reconcileScenario: vi.fn(),
    };
    const bot = new TelegramTradingBot(config, client, { isPaused: () => false, pause: () => undefined, resume: () => undefined },
      journal, () => undefined, async () => new Uint8Array([137, 80, 78, 71]), execution);
    await bot.pollOnce();
    expect(captions[0]).toContain('потенциал меньше двух рисков');
    expect(captions[0]).not.toContain('reward-to-risk');
    expect(answers).toEqual(['Стоп включён, заявка не уйдёт']);
    expect(execution.submitScenario).toHaveBeenCalledOnce();
  });

  it('translates a stopped confirmation into the next Russian step', async () => {
    const journal = createJournal();
    const config = loadConfig({ TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_ALLOWED_CHAT_IDS: '42' });
    const sent: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [{ update_id: 1, message: { chat: { id: 42 }, text: '/approve 7 CONFIRM' } }],
      sendMessage: async (_chatId, text) => { sent.push(text); },
      sendPhoto: async () => undefined,
    };
    const execution = {
      mode: () => 'live', isConfigured: () => true, isReady: () => true, isKilled: () => true,
      armSandbox: vi.fn(), armLive: vi.fn(), kill: vi.fn(), queueScenario: vi.fn(),
      rejectScenario: vi.fn(), listRecent: () => [],
      submitScenario: vi.fn().mockRejectedValue(new Error('Execution kill switch is active')),
      reconcileScenario: vi.fn(),
    };
    const bot = new TelegramTradingBot(config, client, { isPaused: () => false, pause: () => undefined, resume: () => undefined }, journal, () => undefined, undefined, execution);
    await bot.pollOnce();
    expect(sent[0]).toContain('стоп включён, новая заявка не уйдёт');
    expect(sent[0]).not.toContain('kill switch');
  });

  it('arms live, then kill blocks new submissions without claiming the position is closed', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_TOKEN: 'read-token',
      T_INVEST_SANDBOX_TOKEN: 'sandbox-token',
      T_INVEST_LIVE_TOKEN: 'live-token',
      T_INVEST_LIVE_ACCOUNT_ID: 'daily-account',
      T_INVEST_EXECUTION_MODE: 'live',
    });
    const sent: string[] = [];
    const client: TelegramClient = {
      getUpdates: async () => [
        { update_id: 1, message: { chat: { id: 42 }, text: '/execution_arm LIVE' } },
        { update_id: 2, message: { chat: { id: 42 }, text: '/kill' } },
      ],
      sendMessage: async (_chatId, text) => { sent.push(text); },
      sendPhoto: async () => undefined,
    };
    const armLive = vi.fn().mockResolvedValue(undefined);
    const kill = vi.fn();
    const execution = {
      mode: () => 'live', isConfigured: () => true, isReady: () => true, isKilled: () => false,
      armSandbox: vi.fn(), armLive, kill,
      queueScenario: vi.fn(), rejectScenario: vi.fn(), listRecent: () => [],
      submitScenario: vi.fn(), reconcileScenario: vi.fn(),
    };
    const bot = new TelegramTradingBot(config, client, { isPaused: () => false, pause: () => undefined, resume: () => undefined },
      journal, () => undefined, undefined, execution);
    await bot.pollOnce();
    expect(armLive).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledOnce();
    expect(sent[0]).toContain('Реальный счёт разрешён');
    expect(sent[0]).toContain('/approve');
    expect(sent[1]).toContain('Kill switch включён');
    expect(sent[1]).toContain('не закрываются');
  });

  it('does not offer a second confirmation for an order the broker already accepted', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_EXECUTION_MODE: 'sandbox', T_INVEST_TRADING_TOKEN: 'trade-token',
    });
    const scenario = journal.record({
      observedAt: new Date().toISOString(), strategy: 'intraday', instrumentId: 'sber',
      input: { side: 'long', entryPrice: 100, stopPrice: 99, targetPrice: 105, lotSize: 1, slippageRate: 0.0005 },
      decision: 'candidate', blockers: [], warnings: [], snapshot: { tradePlan: { lots: 1, positionRub: 100, totalRiskRub: 2 } },
    });
    let markup: unknown;
    const client: TelegramClient = {
      getUpdates: async () => [],
      sendMessage: async () => undefined,
      sendPhoto: async ({ caption, replyMarkup }) => {
        expect(caption).toContain('уже принята');
        markup = replyMarkup;
      },
    };
    const execution = {
      mode: () => 'sandbox', isConfigured: () => true, isReady: () => true, isKilled: () => false,
      armSandbox: vi.fn(), kill: vi.fn(),
      queueScenario: vi.fn().mockReturnValue({ scenarioId: scenario.id, status: 'accepted' }),
      rejectScenario: vi.fn(), listRecent: () => [], submitScenario: vi.fn(), reconcileScenario: vi.fn(),
    };
    const bot = new TelegramTradingBot(config, client, { isPaused: () => false, pause: () => undefined, resume: () => undefined },
      journal, () => undefined, async () => new Uint8Array([137, 80, 78, 71]), execution);
    await bot.notifyScannerEvent({ instrumentId: 'sber', observedAt: scenario.observedAt, status: 'candidate-recorded', scenarioId: scenario.id, reasons: [] });
    expect(markup).toBeUndefined();
    expect(execution.submitScenario).not.toHaveBeenCalled();
  });

  it('falls back to precise fractional trading prices when card rendering fails', async () => {
    const journal = createJournal();
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: '42',
      T_INVEST_EXECUTION_MODE: 'sandbox',
      T_INVEST_TRADING_TOKEN: 'trade-token',
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"irao","label":"IRAO","lotSize":100,"priceStep":0.0005}]',
    });
    const scenario = journal.record({
      observedAt: '2026-09-14T13:00:00.000Z',
      strategy: 'intraday',
      instrumentId: 'irao',
      input: {
        side: 'long',
        entryPrice: 4.1235,
        stopPrice: 4.10,
        targetPrice: 4.2345,
        lotSize: 100,
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
      instrumentId: 'irao',
      observedAt: scenario.observedAt,
      status: 'candidate-recorded',
      scenarioId: scenario.id,
      reasons: [],
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Карточка не сформировалась');
    expect(sent[0]).toContain('Вход: 4.1235 ₽ · стоп: 4.10 ₽ · цель: 4.2345 ₽');
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

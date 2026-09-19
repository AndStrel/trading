import type { AppConfig } from '../config.js';
import type { ExecutionService } from '../execution/execution-service.js';
import {
  type JournalScenarioRecord,
  ScenarioJournal,
} from '../journal/scenario-journal.js';
import type {
  IntradayScanEvent,
  IntradayScanner,
  IntradayScanReport,
} from '../scanner/intraday-scanner.js';
import { buildCandidateCardSvg, renderCandidateCardPng } from './candidate-card.js';
import type { TelegramClient, TelegramUpdate } from './client.js';

type ScannerControl = Pick<IntradayScanner, 'isPaused' | 'pause' | 'resume'> &
  Partial<Pick<IntradayScanner, 'getLatestReport'>>;
type ExecutionControl = Pick<
  ExecutionService,
  | 'mode'
  | 'isConfigured'
  | 'isReady'
  | 'isKilled'
  | 'armSandbox'
  | 'kill'
  | 'queueScenario'
  | 'rejectScenario'
  | 'listRecent'
  | 'submitScenario'
>;
type TelegramBotLog = (message: string) => void;
type CardRenderer = (svg: string) => Promise<Uint8Array>;

function normalizeCommand(text: string): string {
  const firstWord = text.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  return firstWord.replace(/@[a-z0-9_]+$/i, '');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

function formatTurnover(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1_000_000) return `${formatNumber(value / 1_000_000)} млн ₽`;
  if (value >= 1_000) return `${formatNumber(value / 1_000)} тыс. ₽`;
  return `${formatNumber(value)} ₽`;
}

function snapshotInstrumentLabel(record: JournalScenarioRecord): string | null {
  if (typeof record.snapshot !== 'object' || record.snapshot === null) return null;
  const snapshot = record.snapshot as Record<string, unknown>;
  if (typeof snapshot.instrument !== 'object' || snapshot.instrument === null) return null;
  const instrument = snapshot.instrument as Record<string, unknown>;
  const label = instrument.label ?? instrument.ticker;
  return typeof label === 'string' && label.trim() ? label.trim() : null;
}

function formatMarketReport(report: IntradayScanReport): string {
  const top = report.topRanked.length
    ? report.topRanked.map((item, index) => {
        const state = item.candidateReady ? 'готов к проверке рынка' : 'наблюдение';
        const trend = item.trend === 'up' ? '↑' : item.trend === 'down' ? '↓' : '→';
        const volume = item.relativeVolume === null ? '—' : `${formatNumber(item.relativeVolume)}x`;
        return `${index + 1}. ${item.ticker} — ${item.score}/100 · ${trend} · объём ${volume} · оборот ${formatTurnover(item.averageCandleTurnoverRub)} · ${state}`;
      })
    : ['нет данных для ранжирования'];
  const missing = report.universe.missingTickers.length
    ? `\nНе найдены/недоступны: ${report.universe.missingTickers.join(', ')}`
    : '';

  return [
    `Рынок · ${formatDate(report.observedAt)}`,
    `Вселенная: ${report.universe.active}/${report.universe.requested} акций (${report.universe.source})`,
    `Проверено: ${report.scanned} · ликвидны: ${report.liquid} · тренд ↑: ${report.trendUp} · объём ≥1.0: ${report.volumeConfirmed}`,
    `До стакана допущено: ${report.readyForMarketCheck} · кандидатов рынка: ${report.marketCandidates} · сохранено: ${report.recordedCandidates}`,
    report.errors ? `Ошибки запросов: ${report.errors}` : 'Ошибки запросов: нет',
    '',
    'Топ ситуаций:',
    ...top,
  ].join('\n') + missing;
}

function instrumentLabel(record: JournalScenarioRecord, config: AppConfig): string {
  return (
    snapshotInstrumentLabel(record) ??
    config.scanner.intradayWatchlist.find((item) => item.instrumentId === record.instrumentId)?.label ??
    record.instrumentId
  );
}

function formatCandidateFallback(
  record: JournalScenarioRecord,
  config: AppConfig,
  executionHint = '',
): string {
  return [
    `Кандидат #${record.id} · ${instrumentLabel(record, config)}`,
    `Вход: ${formatNumber(record.input.entryPrice)} ₽ · стоп: ${formatNumber(record.input.stopPrice)} ₽ · цель: ${formatNumber(record.input.targetPrice)} ₽`,
    `Время: ${formatDate(record.observedAt)}`,
    `Карточка не сформировалась; брокерская заявка не отправлена.${executionHint}`,
  ].join('\n');
}

function previewScenario(config: AppConfig): JournalScenarioRecord {
  const watchlistItem = config.scanner.intradayWatchlist[0];
  const instrumentId = watchlistItem?.instrumentId ?? 'preview';
  const lotSize = watchlistItem?.lotSize ?? 1;

  return {
    id: 0,
    recordedAt: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    strategy: 'intraday',
    instrumentId,
    input: {
      side: 'long',
      entryPrice: 100,
      stopPrice: 99,
      targetPrice: 102.5,
      lotSize,
      slippageRate: config.scanner.slippageRate,
    },
    decision: 'candidate',
    blockers: [],
    warnings: [],
    snapshot: {
      tradePlan: {
        lots: 5,
        units: 5 * lotSize,
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
  };
}

function helpText(): string {
  return [
    'Команды:',
    '/status — состояние сканера',
    '/market — последний проход, фильтры и лучшие ситуации',
    '/candidates — последние кандидаты',
    '/preview — тестовая карточка без запроса рынка',
    '/pause — поставить сканер на паузу',
    '/resume — продолжить проходы',
    '/execution — состояние исполнения',
    '/orders — последние подготовленные поручения',
    '/execution_arm SANDBOX — разрешить подтверждённые заявки в песочнице',
    '/approve ID CONFIRM — подтвердить одну sandbox-заявку',
    '/reject ID — отклонить подготовленную заявку',
    '/kill — немедленно запретить новые отправки заявок',
    '',
    'Реальный счёт недоступен: реализовано только подтверждаемое исполнение в песочнице.',
  ].join('\n');
}

export class TelegramTradingBot {
  private initialized = false;
  private offset = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly client: TelegramClient,
    private readonly scanner: ScannerControl,
    private readonly journal: ScenarioJournal,
    private readonly log: TelegramBotLog = (message) => process.stdout.write(`${message}\n`),
    private readonly renderCard: CardRenderer = renderCandidateCardPng,
    private readonly execution?: ExecutionControl,
  ) {}

  async start(): Promise<never> {
    for (;;) {
      try {
        await this.pollOnce();
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Unknown Telegram polling error';
        this.log(`Telegram polling failed: ${detail}`);
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }

  async pollOnce(): Promise<void> {
    this.initialize();
    const updates = await this.client.getUpdates({
      offset: this.offset,
      timeoutSeconds: this.config.telegram.pollingTimeoutSeconds,
    });

    for (const update of updates) {
      await this.handleUpdate(update);

      if (Number.isSafeInteger(update.update_id) && update.update_id >= 0) {
        this.offset = update.update_id + 1;
        this.journal.setTelegramUpdateOffset(this.offset);
      }
    }
  }

  async notifyScannerEvent(event: IntradayScanEvent): Promise<void> {
    if (event.status !== 'candidate-recorded' || !event.scenarioId) return;

    const scenario = this.journal.getScenario(event.scenarioId);
    if (!scenario) {
      this.log(`Candidate notification skipped: scenario ${event.scenarioId} was not found`);
      return;
    }

    let executionHint = '';
    let executionScenarioId: number | undefined;
    if (this.execution?.mode() === 'sandbox') {
      try {
        const order = this.execution.queueScenario(scenario);
        if (order) {
          executionHint = `\nПесочница: /approve ${scenario.id} CONFIRM или /reject ${scenario.id}`;
          executionScenarioId = scenario.id;
        }
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Unknown execution queue error';
        this.log(`Execution queue failed for scenario ${scenario.id}: ${detail}`);
      }
    }

    for (const chatId of this.config.telegram.allowedChatIds) {
      await this.sendCandidateCard(
        chatId,
        scenario,
        'Новый кандидат для проверки',
        executionHint,
        executionScenarioId,
      );
    }
  }

  private initialize(): void {
    if (this.initialized) return;
    this.offset = this.journal.getTelegramUpdateOffset();
    this.initialized = true;
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallbackQuery(update);
      return;
    }

    const chatId = update.message?.chat?.id;
    const text = update.message?.text;
    if (!Number.isSafeInteger(chatId) || typeof text !== 'string') return;

    const normalizedChatId = String(chatId);
    const command = normalizeCommand(text);
    if (!this.config.telegram.allowedChatIds.includes(normalizedChatId)) {
      if (command === '/start') {
        await this.client.sendMessage(
          normalizedChatId,
          `Этот чат ещё не авторизован. Добавьте его ID в TELEGRAM_ALLOWED_CHAT_IDS: ${normalizedChatId}`,
        );
      }
      this.log(`Ignored Telegram command from an unauthorized chat: ${normalizedChatId}`);
      return;
    }

    if (command === '/candidates') {
      await this.sendRecentCandidates(normalizedChatId);
      return;
    }
    if (command === '/market') {
      await this.client.sendMessage(normalizedChatId, this.marketText());
      return;
    }
    if (command === '/preview') {
      await this.sendCandidateCard(
        normalizedChatId,
        previewScenario(this.config),
        'Тестовая карточка — это не данные рынка',
      );
      return;
    }
    if (command === '/approve') {
      await this.approveExecution(normalizedChatId, text);
      return;
    }
    if (command === '/reject') {
      await this.rejectExecution(normalizedChatId, text);
      return;
    }
    if (command === '/orders') {
      await this.client.sendMessage(normalizedChatId, this.ordersText());
      return;
    }
    if (command === '/execution_arm') {
      await this.armExecution(normalizedChatId, text);
      return;
    }
    if (command === '/kill') {
      this.execution?.kill();
      await this.client.sendMessage(
        normalizedChatId,
        this.execution
          ? 'Kill switch включён. Новые заявки не будут отправляться.'
          : 'Модуль исполнения не подключён.',
      );
      return;
    }

    const reply = this.commandReply(command);
    await this.client.sendMessage(normalizedChatId, reply);
  }

  private async sendCandidateCard(
    chatId: string,
    scenario: JournalScenarioRecord,
    captionPrefix: string,
    executionHint = '',
    executionScenarioId?: number,
  ): Promise<void> {
    const caption = `${captionPrefix}: #${scenario.id} · ${instrumentLabel(scenario, this.config)}. Ручная проверка обязательна; брокерская заявка не отправлена.${executionHint}`;

    try {
      const png = await this.renderCard(buildCandidateCardSvg(scenario, this.config));
      await this.client.sendPhoto({
        chatId,
        png,
        caption,
        ...(executionScenarioId
          ? {
              replyMarkup: {
                inline_keyboard: [
                  [
                    {
                      text: `✅ Подтвердить sandbox #${executionScenarioId}`,
                      callback_data: `exec:approve:${executionScenarioId}:confirm`,
                    },
                  ],
                  [
                    {
                      text: `❌ Отклонить #${executionScenarioId}`,
                      callback_data: `exec:reject:${executionScenarioId}`,
                    },
                  ],
                ],
              },
            }
          : {}),
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Unknown candidate card error';
      this.log(`Candidate card delivery failed: ${detail}`);

      try {
        await this.client.sendMessage(
          chatId,
          formatCandidateFallback(scenario, this.config, executionHint),
        );
      } catch (fallbackError: unknown) {
        const fallbackDetail =
          fallbackError instanceof Error ? fallbackError.message : 'Unknown Telegram send error';
        this.log(`Candidate fallback delivery failed: ${fallbackDetail}`);
      }
    }
  }

  private async sendRecentCandidates(chatId: string): Promise<void> {
    const candidates = this.journal
      .list(30, 'intraday')
      .filter((record) => record.decision === 'candidate')
      .slice(0, 5);

    if (candidates.length === 0) {
      await this.client.sendMessage(chatId, 'В журнале пока нет intraday-кандидатов.');
      return;
    }

    for (const candidate of candidates) {
      await this.sendCandidateCard(chatId, candidate, 'Кандидат из журнала');
    }
  }

  private commandReply(command: string): string {
    switch (command) {
      case '/start':
      case '/help':
        return helpText();
      case '/status':
        return this.statusText();
      case '/execution':
        return this.executionText();
      case '/pause':
        this.scanner.pause();
        return 'Сканер поставлен на паузу. Новые проходы не будут запрашивать данные рынка.';
      case '/resume':
        this.scanner.resume();
        return 'Сканер снова активен. Следующий проход состоится на ближайшей границе интервала.';
      default:
        return `Неизвестная команда.\n\n${helpText()}`;
    }
  }

  private statusText(): string {
    const universe =
      this.config.scanner.universeMode === 'moex-liquid'
        ? `MOEX liquid, до ${this.config.scanner.maxInstruments} акций`
        : this.config.scanner.intradayWatchlist.map((item) => item.label ?? item.instrumentId).join(', ') ||
          'не задан';
    const report = this.scanner.getLatestReport?.();

    return [
      `Сканер: ${this.scanner.isPaused() ? 'пауза' : 'активен'}`,
      `Интервал: ${this.config.scanner.intervalSeconds / 60} мин.`,
      `Вселенная: ${universe}`,
      report ? `Последний проход: ${formatDate(report.observedAt)}` : 'Последний проход: ещё не завершён',
      `Cooldown кандидатов: ${this.config.scanner.candidateCooldownMinutes} мин.`,
      this.executionText(),
    ].join('\n');
  }

  private marketText(): string {
    const report = this.scanner.getLatestReport?.();
    if (!report) {
      return 'Первый проход рынка ещё не завершён. Повторите /market через 1–2 минуты.';
    }
    return formatMarketReport(report);
  }

  private executionText(): string {
    if (!this.execution) return 'Исполнение: модуль не подключён';
    return [
      `Исполнение: ${this.execution.mode()}`,
      `Токен: ${this.execution.isConfigured() ? 'задан' : 'не задан'}`,
      `Sandbox-счёт: ${this.execution.isReady() ? 'готов' : 'будет создан при включении'}`,
      `Kill switch: ${this.execution.isKilled() ? 'включён' : 'выключен'}`,
      'Live-режим отсутствует; доступна только песочница с подтверждением каждой заявки.',
    ].join('\n');
  }

  private ordersText(): string {
    if (!this.execution) return 'Модуль исполнения не подключён.';
    const orders = this.execution.listRecent(5);
    if (orders.length === 0) return 'Подготовленных поручений пока нет.';
    return [
      'Последние sandbox-поручения:',
      ...orders.map(
        (order) =>
          `#${order.scenarioId}: ${order.status}, ${order.lots} лот. по ${formatNumber(order.limitPrice)} ₽, риск ${formatNumber(order.estimatedRiskRub)} ₽`,
      ),
    ].join('\n');
  }

  private async armExecution(chatId: string, text: string): Promise<void> {
    if (!this.execution) {
      await this.client.sendMessage(chatId, 'Модуль исполнения не подключён.');
      return;
    }
    const confirmation = text.trim().split(/\s+/)[1];
    if (confirmation !== 'SANDBOX') {
      await this.client.sendMessage(chatId, 'Для включения отправьте точно: /execution_arm SANDBOX');
      return;
    }
    try {
      await this.execution.armSandbox();
      await this.client.sendMessage(
        chatId,
        'Sandbox-исполнение разрешено. Каждая заявка всё равно требует /approve ID CONFIRM.',
      );
    } catch (error: unknown) {
      await this.client.sendMessage(chatId, `Не включено: ${this.errorMessage(error)}`);
    }
  }

  private async approveExecution(chatId: string, text: string): Promise<void> {
    if (!this.execution) {
      await this.client.sendMessage(chatId, 'Модуль исполнения не подключён.');
      return;
    }
    const [, rawId, confirmation] = text.trim().split(/\s+/);
    const scenarioId = Number(rawId);
    if (!Number.isSafeInteger(scenarioId) || scenarioId <= 0 || confirmation !== 'CONFIRM') {
      await this.client.sendMessage(chatId, 'Формат подтверждения: /approve ID CONFIRM');
      return;
    }
    await this.submitExecution(chatId, scenarioId);
  }

  private async submitExecution(chatId: string, scenarioId: number): Promise<void> {
    if (!this.execution) {
      await this.client.sendMessage(chatId, 'Модуль исполнения не подключён.');
      return;
    }
    try {
      const result = await this.execution.submitScenario(scenarioId, chatId);
      await this.client.sendMessage(
        chatId,
        `Sandbox-заявка #${scenarioId}: ${result.executionStatus}; исполнено ${result.lotsExecuted}/${result.order.lots} лот.`,
      );
    } catch (error: unknown) {
      await this.client.sendMessage(chatId, `Заявка #${scenarioId} не отправлена: ${this.errorMessage(error)}`);
    }
  }

  private async rejectExecution(chatId: string, text: string): Promise<void> {
    if (!this.execution) {
      await this.client.sendMessage(chatId, 'Модуль исполнения не подключён.');
      return;
    }
    const rawId = text.trim().split(/\s+/)[1];
    const scenarioId = Number(rawId);
    if (!Number.isSafeInteger(scenarioId) || scenarioId <= 0) {
      await this.client.sendMessage(chatId, 'Формат отказа: /reject ID');
      return;
    }
    await this.rejectExecutionById(chatId, scenarioId);
  }

  private async rejectExecutionById(chatId: string, scenarioId: number): Promise<void> {
    if (!this.execution) {
      await this.client.sendMessage(chatId, 'Модуль исполнения не подключён.');
      return;
    }
    try {
      this.execution.rejectScenario(scenarioId, chatId);
      await this.client.sendMessage(chatId, `Sandbox-заявка #${scenarioId} отклонена.`);
    } catch (error: unknown) {
      await this.client.sendMessage(chatId, `Не отклонено: ${this.errorMessage(error)}`);
    }
  }

  private async handleCallbackQuery(update: TelegramUpdate): Promise<void> {
    const callback = update.callback_query;
    const callbackId = callback?.id;
    const chatId = callback?.message?.chat?.id;
    const data = callback?.data;
    if (!callbackId || !Number.isSafeInteger(chatId) || typeof data !== 'string') return;

    const normalizedChatId = String(chatId);
    if (!this.config.telegram.allowedChatIds.includes(normalizedChatId)) {
      await this.client.answerCallbackQuery?.(callbackId, 'Нет доступа');
      this.log(`Ignored Telegram callback from an unauthorized chat: ${normalizedChatId}`);
      return;
    }

    const approveMatch = /^exec:approve:(\d+):confirm$/.exec(data);
    const rejectMatch = /^exec:reject:(\d+)$/.exec(data);
    const scenarioId = Number(approveMatch?.[1] ?? rejectMatch?.[1]);
    if (!Number.isSafeInteger(scenarioId) || scenarioId <= 0) {
      await this.client.answerCallbackQuery?.(callbackId, 'Некорректная команда');
      return;
    }

    await this.client.answerCallbackQuery?.(
      callbackId,
      approveMatch ? 'Проверяю и отправляю…' : 'Отклоняю…',
    );
    if (approveMatch) await this.submitExecution(normalizedChatId, scenarioId);
    else await this.rejectExecutionById(normalizedChatId, scenarioId);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'неизвестная ошибка';
  }
}

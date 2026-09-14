import type { AppConfig } from '../config.js';
import {
  type JournalScenarioRecord,
  ScenarioJournal,
} from '../journal/scenario-journal.js';
import type { IntradayScanEvent, IntradayScanner } from '../scanner/intraday-scanner.js';
import { buildCandidateCardSvg, renderCandidateCardPng } from './candidate-card.js';
import type { TelegramClient, TelegramUpdate } from './client.js';

type ScannerControl = Pick<IntradayScanner, 'isPaused' | 'pause' | 'resume'>;
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

function instrumentLabel(record: JournalScenarioRecord, config: AppConfig): string {
  return (
    config.scanner.intradayWatchlist.find((item) => item.instrumentId === record.instrumentId)?.label ??
    record.instrumentId
  );
}

function formatCandidateFallback(record: JournalScenarioRecord, config: AppConfig): string {
  return [
    `Кандидат #${record.id} · ${instrumentLabel(record, config)}`,
    `Вход: ${formatNumber(record.input.entryPrice)} ₽ · стоп: ${formatNumber(record.input.stopPrice)} ₽ · цель: ${formatNumber(record.input.targetPrice)} ₽`,
    `Время: ${formatDate(record.observedAt)}`,
    'Карточка не сформировалась; заявка не создана.',
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
    '/candidates — последние кандидаты',
    '/preview — тестовая карточка без запроса рынка',
    '/pause — поставить сканер на паузу',
    '/resume — продолжить проходы',
    '',
    'Бот не открывает paper-сделки и не выставляет брокерские заявки.',
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

    for (const chatId of this.config.telegram.allowedChatIds) {
      await this.sendCandidateCard(chatId, scenario, 'Новый кандидат для проверки');
    }
  }

  private initialize(): void {
    if (this.initialized) return;
    this.offset = this.journal.getTelegramUpdateOffset();
    this.initialized = true;
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
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
    if (command === '/preview') {
      await this.sendCandidateCard(
        normalizedChatId,
        previewScenario(this.config),
        'Тестовая карточка — это не данные рынка',
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
  ): Promise<void> {
    const caption = `${captionPrefix}: #${scenario.id} · ${instrumentLabel(scenario, this.config)}. Ручная проверка обязательна; заявка не создана.`;

    try {
      const png = await this.renderCard(buildCandidateCardSvg(scenario, this.config));
      await this.client.sendPhoto({ chatId, png, caption });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Unknown candidate card error';
      this.log(`Candidate card delivery failed: ${detail}`);

      try {
        await this.client.sendMessage(chatId, formatCandidateFallback(scenario, this.config));
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
    const watchlist = this.config.scanner.intradayWatchlist
      .map((item) => item.label ?? item.instrumentId)
      .join(', ');

    return [
      `Сканер: ${this.scanner.isPaused() ? 'пауза' : 'активен'}`,
      `Интервал: ${this.config.scanner.intervalSeconds / 60} мин.`,
      `Watchlist: ${watchlist || 'не задан'}`,
      `Cooldown кандидатов: ${this.config.scanner.candidateCooldownMinutes} мин.`,
      'Брокерские и paper-заявки бот не создаёт.',
    ].join('\n');
  }
}

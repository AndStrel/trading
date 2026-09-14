import type { AppConfig } from '../config.js';
import {
  type JournalScenarioRecord,
  ScenarioJournal,
} from '../journal/scenario-journal.js';
import type { IntradayScanEvent, IntradayScanner } from '../scanner/intraday-scanner.js';
import type { TelegramClient, TelegramUpdate } from './client.js';

type ScannerControl = Pick<IntradayScanner, 'isPaused' | 'pause' | 'resume'>;

type TelegramBotLog = (message: string) => void;

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

function formatScenario(record: JournalScenarioRecord, config: AppConfig): string {
  const instrument =
    config.scanner.intradayWatchlist.find((item) => item.instrumentId === record.instrumentId)?.label ??
    record.instrumentId;

  return [
    `#${record.id} · ${instrument}`,
    `Вход: ${formatNumber(record.input.entryPrice)} ₽ · стоп: ${formatNumber(record.input.stopPrice)} ₽ · цель: ${formatNumber(record.input.targetPrice)} ₽`,
    `Лот: ${record.input.lotSize} · время: ${formatDate(record.observedAt)}`,
  ].join('\n');
}

function helpText(): string {
  return [
    'Команды:',
    '/status — состояние сканера',
    '/candidates — последние кандидаты',
    '/pause — поставить сканер на паузу',
    '/resume — продолжить сканирование',
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

    const text = ['Новый кандидат для проверки', formatScenario(scenario, this.config)].join('\n\n');
    for (const chatId of this.config.telegram.allowedChatIds) {
      try {
        await this.client.sendMessage(chatId, text);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Unknown Telegram send error';
        this.log(`Candidate notification to an authorized chat failed: ${detail}`);
      }
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

    const reply = this.commandReply(command);
    await this.client.sendMessage(normalizedChatId, reply);
  }

  private commandReply(command: string): string {
    switch (command) {
      case '/start':
      case '/help':
        return helpText();
      case '/status':
        return this.statusText();
      case '/candidates':
        return this.candidatesText();
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

  private candidatesText(): string {
    const candidates = this.journal
      .list(30, 'intraday')
      .filter((record) => record.decision === 'candidate')
      .slice(0, 5);

    if (candidates.length === 0) {
      return 'В журнале пока нет intraday-кандидатов.';
    }

    return ['Последние кандидаты:', ...candidates.map((record) => formatScenario(record, this.config))].join(
      '\n\n',
    );
  }
}
